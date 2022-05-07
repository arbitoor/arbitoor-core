import { NEAR, NearAccount } from 'near-workspaces'
import { Transaction } from 'near-workspaces/dist/transaction'
import { Token } from './token-utils'

// Default fee for tests
export const FEE = 25

export class RefExchange {
  readonly owner: NearAccount
  readonly address: NearAccount

  private constructor (address: NearAccount, owner: NearAccount) {
    this.owner = owner
    this.address = address
  }

  /**
   * Deploys an instance of REF exchange
   * @param name Exchange name
   * @param owner Exchange owner
   * @returns
   */
  static async deploy (name: string, owner: NearAccount): Promise<RefExchange> {
    const exchange = await owner.createAndDeploy(
      name,
      'compiled_contracts/ref_exchange_release.wasm',
      {
        method: 'new',
        args: {
          owner_id: owner.accountId,
          exchange_fee: 4,
          referral_fee: 1
        }
      }
    )
    return new RefExchange(exchange, owner)
  }

  /**
   * Returns a TX to whitelist tokens in the exchange
   * @param tokens Array of token addresses
   * @returns
   */
  whitelistTokens (tokens: NearAccount[]) {
    return this.owner.batch(this.address).functionCall('extend_whitelisted_tokens', {
      tokens
    }, {
      attachedDeposit: '1'
    })
  }

  /**
   * Returns a TX to create a simple pool
   * @param tokens Token tuple
   * @returns
   */
  createPool (tokens: [NearAccount, NearAccount], fee: number) {
    return this.owner.batch(this.address).functionCall('add_simple_pool', {
      tokens,
      fee
    }, {
      attachedDeposit: NEAR.parse('0.1').toString()
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
      attachedDeposit: NEAR.parse('0.1').toString()
    })
  }

  /**
   * Create an LP position
   * @param param0
   * @returns
   */
  async addLiquidity ({
    signer,
    poolId,
    token0,
    token1,
    amount0,
    amount1
  }: {
    signer: NearAccount,
    poolId: number,
    token0: string,
    token1: string,
    amount0: string,
    amount1: string
  }
  ) {
    // Deposit tokens
    await Promise.all([
      signer.call(token0, 'ft_transfer_call', {
        receiver_id: this.address,
        amount: amount0,
        msg: ''
      }, {
        attachedDeposit: NEAR.parse('0.000000000000000000000001').toString(),
        gas: '300000000000000'
      }),
      signer.call(token1, 'ft_transfer_call', {
        receiver_id: this.address,
        amount: amount1,
        msg: ''
      }, {
        attachedDeposit: NEAR.parse('0.000000000000000000000001').toString(),
        gas: '300000000000000'
      })
    ])

    // Create LP position
    return signer.call(this.address, 'add_liquidity', {
      pool_id: poolId,
      amounts: [amount0, amount1]
    }, {
      attachedDeposit: '800000000000000000000'
    })
  }

  /**
   * Helper function to setup a pool and create an LP position
   */
  async setupPool (signer: NearAccount, tokenA: Token, tokenB: Token) {
    await this.whitelistTokens([tokenA.address, tokenB.address]).transact()

    // Add token storage for the exchange, so it can hold LP tokens
    await tokenA.addStorage(this.address).transact()
    await tokenB.addStorage(this.address).transact()

    // Add exchange storage for Alice, so she can LP
    const tx = this.addStorage(signer)
    // Create a liquidity pool
    tx.actions.push(this.createPool([tokenA.address, tokenB.address], FEE).actions[0])
    await tx.transact()

    // Create LP position
    return this.addLiquidity({
      signer,
      poolId: 0,
      token0: tokenA.address.accountId,
      token1: tokenB.address.accountId,
      amount0: '1000',
      amount1: '1000'
    })
  }
}
