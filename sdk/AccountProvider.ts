import { CodeResult, Provider } from 'near-workspaces'
import { JUMBO, REF } from './constants'
import { FTStorageBalance } from './ft-contract'
import { FormattedPool, getPools } from './ref-utils'

export interface AccountProvider {
  /**
  * Returns the storage balance of an account in a token contract
  * @param token Token contract address
  * @param accountId The account to check
  * @returns Storage balance or undefined
  */
  ftGetStorageBalance(token: string, accountId: string): FTStorageBalance | undefined

  getRefPools(): FormattedPool[]

  getJumboPools(): FormattedPool[]
}

/**
 * In-memory provider for accounts. Allows accounts to be pre-fetched for performance
 */
export class InMemoryProvider implements AccountProvider {
  // RPC provider
  private provider: Provider

  // Whether an address is registered on the token contract
  private tokenStorageCache: Map<[string, string], FTStorageBalance>

  private refPools: FormattedPool[]
  private jumboPools: FormattedPool[]

  constructor (provider: Provider) {
    this.provider = provider
    this.tokenStorageCache = new Map()
    this.refPools = []
    this.jumboPools = []
  }

  async fetchPools () {
    this.refPools = [
      ...await getPools(this.provider, REF, 0, 500),
      ...await getPools(this.provider, REF, 500, 500),
      ...await getPools(this.provider, REF, 1000, 500),
      // stable pool 1910 omitted
      ...await getPools(this.provider, REF, 1500, 410),
      ...await getPools(this.provider, REF, 1911, 500)
    ]

    this.jumboPools = [
      ...await getPools(this.provider, JUMBO, 0, 500),
      ...await getPools(this.provider, JUMBO, 500, 500),
      ...await getPools(this.provider, JUMBO, 1000, 500)
    ]

    // TODO store stable pool 1910 separately
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
      this.tokenStorageCache.set([token, accountId], res)
    }
  }

  getRefPools () {
    return this.refPools
  }

  getJumboPools () {
    return this.jumboPools
  }

  ftGetStorageBalance (
    tokenId: string,
    accountId: string
  ): FTStorageBalance | undefined {
    return this.tokenStorageCache.get([tokenId, accountId])
  }
}
