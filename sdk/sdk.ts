import Big from 'big.js'
import { Provider } from 'near-api-js/lib/providers'
import { Action, CodeResult } from 'near-workspaces'
import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { STORAGE_TO_REGISTER_WITH_MFT } from './constants'
import { ftGetStorageBalance, ftGetTokenMetadata, round, TokenMetadata } from './ft-contract'
import { FunctionCallOptions } from './near'
import { percentLess, toReadableNumber, scientificNotationToString, toNonDivisibleNumber } from './numbers'
import { FormattedPool, RefPool } from './ref-utils'
import { stableSmart } from './smartRouteLogic.js'
import { EstimateSwapView, Pool, PoolMode } from './swap-service'

export interface ComputeRoutes {
  inputToken: string,
  outputToken: string,
  inputAmount: string,
}

export interface SwapOptions {
  exchange: string,
  useNearBalance?: boolean;
  swapsToDo: EstimateSwapView[];
  tokenIn: string;
  tokenOut: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountIn: string;
  slippageTolerance: number;
}

export class Comet {
  // NEAR provider to fetch data
  provider: Provider
  // User address for swaps
  user: string
  // Data is refreshed priodically after this many milliseconds elapse
  routeCacheDuration: number

  constructor({ provider, user, routeCacheDuration }: {
    provider: Provider,
    user: string,
    routeCacheDuration: number,
  }) {
    this.provider = provider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
  }

  /**
   * Fetch a number of REF pools
   * @param index Start index for pagination
   * @param limit Number of pools to fetch
   * @returns
   */
  async getPools(exchange: string, index: number, limit: number) {
    // TODO filter out illiquid pools. There are only 20 liquid pools out of 3k total

    const pools = await this.provider.query<CodeResult>({
      request_type: 'call_function',
      account_id: exchange,
      method_name: 'get_pools',
      args_base64: Buffer.from(JSON.stringify({ from_index: index, limit })).toString('base64'),
      finality: 'optimistic'
    }).then((res) => JSON.parse(Buffer.from(res.result).toString()) as RefPool[])

    // TODO remove redundant fields
    const formattedPools = pools.map(refPool => {
      const formattedPool = {
        id: index,
        token1Id: refPool.token_account_ids[0]!,
        token2Id: refPool.token_account_ids[1]!,
        token1Supply: refPool.amounts[0]!,
        token2Supply: refPool.amounts[1]!,
        fee: refPool.total_fee,
        shares: refPool.shares_total_supply,
        update_time: 100,
        token0_price: '0',
        Dex: exchange,
        amounts: refPool.amounts,
        reserves: {
          [refPool.token_account_ids[0]!]: refPool.amounts[0]!,
          [refPool.token_account_ids[1]!]: refPool.amounts[1]!
        }
      } as FormattedPool
      ++index

      return formattedPool
    })

    return formattedPools
  }

  /**
   * Get REF pools having one of the tokens
   * @param token1
   * @param token2
   * @returns
   */
  async getPoolsWithEitherToken(exchange: string, token1: string, token2: string) {
    // TODO
    const pools = [
      ...await this.getPools(exchange, 0, 500),
      ...await this.getPools(exchange, 500, 500),
      ...await this.getPools(exchange, 1000, 500),
      // stableswap unsupported for now
      // ...await this.getPools(exchange, 1500, 500),
      // ...await this.getPools(exchange, 2000, 500),
      // ...await this.getPools(exchange, 2500, 500)
    ]

    return pools.filter(pool => {
      return pool.token1Id === token1 || pool.token1Id === token2 ||
        pool.token2Id === token1 || pool.token2Id === token2
    })
  }

  async nearInstantSwap({
    exchange,
    tokenIn,
    tokenOut,
    tokenInDecimals,
    tokenOutDecimals,
    amountIn,
    swapsToDo,
    slippageTolerance
  }: SwapOptions) {
    const transactions = new Array<Transaction>()
    const tokenInActions = new Array<FunctionCallAction>()
    const tokenOutActions = new Array<FunctionCallAction>()

    const registerToken = async (tokenId: string) => {
      console.log('registering', tokenId)
      const tokenRegistered = await ftGetStorageBalance(this.provider, tokenId, this.user).catch(() => {
        throw new Error(`${tokenId} doesn't exist.`)
      })

      if (tokenRegistered === null) {
        tokenOutActions.push({
          type: 'FunctionCall',
          params: {
            methodName: 'storage_deposit',
            args: {
              registration_only: true,
              account_id: this.user
            },
            gas: '30000000000000',
            deposit: STORAGE_TO_REGISTER_WITH_MFT
          }
        })

        transactions.push({
          receiverId: tokenId,
          signerId: this.user,
          actions: tokenOutActions
        })
      }
    }

    const isParallelSwap = swapsToDo.every(
      (estimate) => estimate.status === PoolMode.PARALLEL
    )
    const isSmartRouteV1Swap = swapsToDo.every(
      (estimate) => estimate.status === PoolMode.SMART
    )

    if (isParallelSwap) {
      const swapActions = swapsToDo.map((s2d) => {
        const minTokenOutAmount = s2d.estimate
          ? percentLess(slippageTolerance, s2d.estimate)
          : '0'
        const allocation = toReadableNumber(
          tokenInDecimals,
          scientificNotationToString(s2d.pool.partialAmountIn!)
        )

        return {
          pool_id: s2d.pool.id,
          token_in: tokenIn,
          token_out: tokenOut,
          amount_in: round(
            tokenInDecimals,
            toNonDivisibleNumber(tokenInDecimals, allocation)
          ),
          min_amount_out: round(
            tokenOutDecimals,
            toNonDivisibleNumber(tokenOutDecimals, minTokenOutAmount)
          )
        }
      })

      await registerToken(tokenOut)

      tokenInActions.push({
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: {
            receiver_id: exchange,
            amount: amountIn,
            msg: JSON.stringify({
              force: 0,
              actions: swapActions
            })
          },
          gas: '180000000000000',
          deposit: '1',
        }

      })

      transactions.push({
        receiverId: tokenIn,
        signerId: this.user,
        actions: tokenInActions
      })
    } else if (isSmartRouteV1Swap) {
      // making sure all actions get included for hybrid stable smart.
      await registerToken(tokenOut)
      var actionsList = []
      const swap1 = swapsToDo[0]!
      actionsList.push({
        pool_id: swap1.pool.id,
        token_in: swap1.inputToken,
        token_out: swap1.outputToken,
        amount_in: amountIn,
        min_amount_out: '0'
      })
      const swap2 = swapsToDo[1]!
      actionsList.push({
        pool_id: swap2.pool.id,
        token_in: swap2.inputToken,
        token_out: swap2.outputToken,
        min_amount_out: round(
          tokenOutDecimals,
          toNonDivisibleNumber(
            tokenOutDecimals,
            percentLess(slippageTolerance, swapsToDo[1]!.estimate)
          )
        )
      })

      transactions.push({
        receiverId: tokenIn,
        signerId: this.user,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'ft_transfer_call',
              args: {
                receiver_id: exchange,
                amount: amountIn,
                msg: JSON.stringify({
                  force: 0,
                  actions: actionsList
                })
              },
              gas: '180000000000000',
              deposit: '1'
            }

          }
        ]
      })
    } else {
      // making sure all actions get included.
      await registerToken(tokenOut)
      var actionsList = []
      const allSwapsTokens = swapsToDo.map((s) => [s.inputToken, s.outputToken]) // to get the hop tokens
      for (const i in allSwapsTokens) {
        const swapTokens = allSwapsTokens[i]
        if (swapTokens![0] == tokenIn && swapTokens![1] == tokenOut) {
          // parallel, direct hop route.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: tokenIn,
            token_out: tokenOut,
            amount_in: swapsToDo[i]!.pool.partialAmountIn,
            min_amount_out: round(
              tokenOutDecimals,
              toNonDivisibleNumber(
                tokenOutDecimals,
                percentLess(slippageTolerance, swapsToDo[i]!.estimate)
              )
            )
          })
        } else if (swapTokens![0] == tokenIn) {
          // first hop in double hop route
          // TODO -- put in a check to make sure this first hop matches with the next (i+1) hop as a second hop.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: swapTokens![0],
            token_out: swapTokens![1],
            amount_in: swapsToDo[i]!.pool.partialAmountIn,
            min_amount_out: '0'
          })
        } else {
          // second hop in double hop route.
          // TODO -- put in a check to make sure this second hop matches with the previous (i-1) hop as a first hop.
          actionsList.push({
            pool_id: swapsToDo[i]!.pool.id,
            token_in: swapTokens![0],
            token_out: swapTokens![1],
            min_amount_out: round(
              tokenOutDecimals,
              toNonDivisibleNumber(
                tokenOutDecimals,
                percentLess(slippageTolerance, swapsToDo[i]!.estimate)
              )
            )
          })
        }
      }

      transactions.push({
        receiverId: tokenIn,
        signerId: this.user,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'ft_transfer_call',
              args: {
                receiver_id: exchange,
                amount: amountIn,
                msg: JSON.stringify({
                  force: 0,
                  actions: actionsList
                })
              },
              gas: '180000000000000',
              deposit: '1'
            }

          }
        ]
      })
    }

    return transactions
  };

  /**
   * Find trade routes from the input to output token, ranked by output amount.
   * @param param0
   */
  async computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
  }: ComputeRoutes) {
    const refPools = await this.getPoolsWithEitherToken('v2.ref-finance.near', inputToken, outputToken)
    const jumboPools = await this.getPoolsWithEitherToken('v1.jumbo_exchange.near', inputToken, outputToken)

    const refActions = await stableSmart(
      this.provider,
      refPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    const jumboActions = await stableSmart(
      this.provider,
      jumboPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    return {
      ref: refActions,
      jumbo: jumboActions
    }
  }
}
