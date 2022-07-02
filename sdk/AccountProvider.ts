import { TokenInfo } from '@tonic-foundation/token-list'
import _ from 'lodash'
import { CodeResult, MainnetRpc, Provider } from 'near-workspaces'
import { Market as SpinMarket, GetOrderbookResponse as SpinOrderbook } from '@spinfi/core'
import { JUMBO, REF } from './constants'
import { FTStorageBalance } from './ft-contract'
import { getPools, STABLE_POOL_IDS, FormattedPool, isStablePool, getStablePool, StablePool, isRatedPool, RATED_POOL_IDS, getRatedPool } from './ref-finance'
import { Account, connect, Connection, WalletConnection } from 'near-api-js'
import { getSpinMarkets, getSpinOrderbook } from './spin/spin-api'

export interface AccountProvider {
  /**
  * Returns the storage balance of an account in a token contract
  * @param token Token contract address
  * @param accountId The account to check
  * @returns Storage balance or undefined
  */
  ftGetStorageBalance(token: string, accountId: string): FTStorageBalance | undefined

  getRefPools(): FormattedPool[]

  getRefStablePools(): StablePool[]

  getJumboPools(): FormattedPool[]

  getSpinMarkets(): SpinMarket[]

  getSpinOrderbooks(): Map<number, SpinOrderbook>

  /**
   * Return token metadata. Fallback to RPC call if it's not stored in the token list.
   * @param token Token address
   */
  getTokenMetadata(token: string): Promise<TokenInfo | undefined>
}

/**
 * In-memory provider for accounts. Allows accounts to be pre-fetched for performance
 */
export class InMemoryProvider implements AccountProvider {
  // RPC provider
  private provider: Provider

  // Whether an address is registered on the token contract
  private tokenStorageCache: Map<string, Map<string, FTStorageBalance>>

  private refPools: FormattedPool[]
  private refStablePools: StablePool[]
  private jumboPools: FormattedPool[]
  private spinOrderbooks: Map<number, SpinOrderbook>

  // IndexedDB is more suitable for spin markets and token map
  private spinMarkets: SpinMarket[]
  private tokenMap: Map<string, TokenInfo>

  constructor (provider: Provider, tokenMap: Map<string, TokenInfo>, spinMarkets: SpinMarket[]) {
    this.provider = provider
    this.tokenStorageCache = new Map()
    this.refPools = []
    this.refStablePools = []
    this.jumboPools = []
    this.spinOrderbooks = new Map()
    this.spinMarkets = spinMarkets
    this.tokenMap = tokenMap
  }

  async fetchPools () {
    const pools = _.flatten(await Promise.all([
      getPools(this.provider, REF, 0, 500),
      getPools(this.provider, REF, 500, 500),
      getPools(this.provider, REF, 1000, 500),
      getPools(this.provider, REF, 1500, 500),
      getPools(this.provider, REF, 2000, 500),
      getPools(this.provider, REF, 2500, 500),
      getPools(this.provider, REF, 3000, 500),
      getPools(this.provider, REF, 3500, 500)
    ]))

    this.refPools = pools
      .filter(pool => !isStablePool(pool.id) && !isRatedPool(pool.id))

    this.refStablePools = await Promise.all([
      ...STABLE_POOL_IDS.map(stablePoolId => getStablePool(this.provider, stablePoolId))
      // TODO research rated pool
      // ...RATED_SWAP_POOL_IDS.map(ratedPoolId => getRatedPool(this.provider, ratedPoolId)),
    ])

    this.jumboPools = _.flatten(await Promise.all([
      getPools(this.provider, JUMBO, 0, 500),
      getPools(this.provider, JUMBO, 500, 500),
      getPools(this.provider, JUMBO, 1000, 500)
    ]))

    await Promise.all(this.getSpinMarkets().map(
      market => getSpinOrderbook(this.provider, market.id)
        .then(orderbook => {
          this.spinOrderbooks.set(market.id, orderbook)
        })
    ))
  }

  /**
   * Fetch and cache storage balance of an account in the given token contract
   * @param token Token contract
   * @param accountId Account to check
   */
  async ftFetchStorageBalance (
    token: string,
    accountId: string
  ) {
    const res = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: token,
      method_name: 'storage_balance_of',
      args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64'),
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString())) as FTStorageBalance | undefined

    if (res) {
      const userTokens = this.tokenStorageCache.get(accountId)
      if (userTokens) {
        userTokens.set(token, res)
      } else {
        this.tokenStorageCache.set(accountId, new Map([[token, res]]))
      }
    }
  }

  getRefPools () {
    return this.refPools
  }

  getJumboPools () {
    return this.jumboPools
  }

  getRefStablePools () {
    return this.refStablePools
  }

  getSpinMarkets (): SpinMarket[] {
    return this.spinMarkets
  }

  getSpinOrderbooks () {
    return this.spinOrderbooks
  }

  ftGetStorageBalance (
    tokenId: string,
    accountId: string
  ): FTStorageBalance | undefined {
    return this.tokenStorageCache.get(accountId)?.get(tokenId)
  }

  async getTokenMetadata (token: string): Promise<TokenInfo | undefined> {
    const metadata = this.tokenMap.get(token)
    if (metadata) {
      return metadata
    }

    const fetchedMetadata = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: token,
      method_name: 'ft_metadata',
      args_base64: '',
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString())) as TokenInfo | undefined

    if (fetchedMetadata) {
      this.tokenMap.set(token, fetchedMetadata)
    }

    return fetchedMetadata
  }
}
