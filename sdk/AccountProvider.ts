import { CodeResult, Provider } from 'near-workspaces'
import { FTStorageBalance, TokenMetadata } from './ft-contract'

export interface AccountProvider {
  /**
  * Return a token's cached metadata, if it exists
  * @param token Token contract address
  * @returns Token metadata or undefined
  */
  ftGetTokenMetadata(token: string): TokenMetadata | undefined

  /**
  * Returns the storage balance of an account in a token contract
  * @param token Token contract address
  * @param accountId The account to check
  * @returns Storage balance or undefined
  */
  ftGetStorageBalance(token: string, accountId: string): FTStorageBalance | undefined
}

/**
 * In-memory provider for accounts. Allows accounts to be pre-fetched for performance
 */
export class InMemoryProvider implements AccountProvider {
  // RPC provider
  provider: Provider

  // Fungible token metadata cache
  private tokenMetadataCache: Map<string, TokenMetadata>

  // Whether an address is registered on the token contract
  private tokenStorageCache: Map<[string, string], FTStorageBalance>

  constructor (provider: Provider) {
    this.provider = provider
    this.tokenMetadataCache = new Map()
    this.tokenStorageCache = new Map()
  }

  /**
   * Fetch and cache token metadata
   * @param token Token contract address
   */
  async ftFetchTokenMetadata (token: string) {
    const metadata = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: token,
      method_name: 'ft_metadata',
      args_base64: '',
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString()))

    this.tokenMetadataCache.set(token, {
      id: token,
      ...metadata
    })
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

  /**
   *
   */
  async fetchPools () {

  }

  ftGetTokenMetadata (token: string) {
    return this.tokenMetadataCache.get(token)
  }

  ftGetStorageBalance (
    tokenId: string,
    accountId: string
  ): FTStorageBalance | undefined {
    return this.tokenStorageCache.get([tokenId, accountId])
  }
}
