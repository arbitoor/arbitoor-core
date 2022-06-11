import { CodeResult, Provider } from 'near-workspaces'
import { FTStorageBalance } from './ft-contract'

export interface AccountProvider {
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

  // Whether an address is registered on the token contract
  private tokenStorageCache: Map<[string, string], FTStorageBalance>

  constructor (provider: Provider) {
    this.provider = provider
    this.tokenStorageCache = new Map()
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

  ftGetStorageBalance (
    tokenId: string,
    accountId: string
  ): FTStorageBalance | undefined {
    return this.tokenStorageCache.get([tokenId, accountId])
  }
}
