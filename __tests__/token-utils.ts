import { NEAR, NearAccount } from 'near-workspaces'
import { Transaction } from 'near-workspaces/dist/transaction'

/**
 * Convenience functions for NEP-141 fungible tokens
 */
export class Token {
  readonly address: NearAccount
  readonly owner: NearAccount

  private constructor (address: NearAccount, owner: NearAccount) {
    this.address = address
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
    return this.owner.batch(this.address).functionCall('mint', {
      account_id: accountId,
      amount: amount.toString()
    })
  }

  /**
   * Returns a TX to add storage balance for an account
   * Further reading- https://nomicon.io/Standards/StorageManagement
   * @param accountId
   * @returns
   */
  addStorage (accountId: NearAccount): Transaction {
    return this.owner.batch(this.address).functionCall('storage_deposit', {
      account_id: accountId
    }, {
      attachedDeposit: NEAR.parse('0.00235').toString()
    })
  }

  async balance(accountId: string): Promise<string> {
    return this.address.view('ft_balance_of', {
      account_id: accountId,
    })
  }
}
