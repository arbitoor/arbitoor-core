import { NearAccount } from 'near-workspaces'
import { Transaction } from 'near-workspaces/dist/transaction'

/**
 * Convenience functions for NEP-141 fungible tokens
 */
export class Token {
  readonly token: NearAccount
  readonly owner: NearAccount

  private constructor (token: NearAccount, owner: NearAccount) {
    this.token = token
    this.owner = owner
  }

  /**
   * Deploys a new token and returns the class
   * @param tokenName
   * @param owner
   * @returns
   */
  static async deploy (tokenName: string, owner: NearAccount): Promise<Token> {
    const token = await owner.createAndDeploy(
      tokenName,
      'compiled_contracts/test_token.wasm',
      {
        method: 'new',
        args: {
          owner_id: owner.accountId,
          total_supply: '100000000000000',
          metadata: {}
        }
      }
    )
    return new Token(token, owner)
  }

  /**
   * Returns a TX to mint tokens
   * @param accountId Destination address receiving tokens
   * @param amount Amount to mint
   * @returns
   */
  mint (accountId: NearAccount, amount: bigint): Transaction {
    return this.owner.batch(this.token).functionCall('mint', {
      account_id: accountId,
      amount: amount.toString()
    })
  }
}
