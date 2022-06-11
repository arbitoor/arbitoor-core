import { Provider } from 'near-api-js/lib/providers'
import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { TokenListProvider, TokenInfo } from '@tonic-foundation/token-list'
import { STORAGE_TO_REGISTER_WITH_MFT } from './constants'
import { round } from './ft-contract'
import { percentLess, toReadableNumber, scientificNotationToString, toNonDivisibleNumber } from './numbers'
import { FormattedPool, getPools, RefPool } from './ref-utils'
import { stableSmart } from './smartRouteLogic.js'
import { EstimateSwapView, Pool, PoolMode } from './swap-service'
import { AccountProvider } from './AccountProvider'

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

  // To fetch accounts
  accountProvider: AccountProvider

  // User address for swaps
  user: string
  // Data is refreshed priodically after this many milliseconds elapse
  routeCacheDuration: number

  tokenMap: Map<string, TokenInfo>

  constructor ({ provider, accountProvider, user, routeCacheDuration, tokenMap }: {
    provider: Provider,
    accountProvider: AccountProvider,
    tokenMap: Map<string, TokenInfo>,
    user: string,
    routeCacheDuration: number,
  }) {
    this.provider = provider
    this.accountProvider = accountProvider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
    this.tokenMap = tokenMap
  }

  /**
   * Get REF pools having one of the tokens
   * @param token1
   * @param token2
   * @returns
   */
  async getPoolsWithEitherToken (exchange: string, token1: string, token2: string) {
    // TODO only fetch high liquidity pools
    const pools = [
      ...await getPools(this.provider, exchange, 0, 500),
      ...await getPools(this.provider, exchange, 500, 500),
      ...await getPools(this.provider, exchange, 1000, 500),
      // stable pool 1910 omitted
      ...await getPools(this.provider, exchange, 1500, 410),
      ...await getPools(this.provider, exchange, 1911, 500)
    ]

    return pools.filter(pool => {
      return pool.token1Id === token1 || pool.token1Id === token2 ||
        pool.token2Id === token1 || pool.token2Id === token2
    })
  }

  nearInstantSwap ({
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

    const registerToken = (tokenId: string) => {
      const tokenRegistered = this.accountProvider.ftGetStorageBalance(tokenId, this.user)

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

      registerToken(tokenOut)

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
          deposit: '1'
        }

      })

      transactions.push({
        receiverId: tokenIn,
        signerId: this.user,
        actions: tokenInActions
      })
    } else if (isSmartRouteV1Swap) {
      // making sure all actions get included for hybrid stable smart.
      registerToken(tokenOut)
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
      registerToken(tokenOut)
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
   *
   * This function should return array of transactions, with output amounts.
   *
   * @param param0
   */
  async computeRoutes ({
    inputToken,
    outputToken,
    inputAmount
  }: ComputeRoutes) {
    // Read from cache
    const refPools = await this.getPoolsWithEitherToken('v2.ref-finance.near', inputToken, outputToken)
    const jumboPools = await this.getPoolsWithEitherToken('v1.jumbo_exchange.near', inputToken, outputToken)

    // doesn't account for stable pool
    const refActions = await stableSmart(
      this.tokenMap,
      refPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    const jumboActions = await stableSmart(
      this.tokenMap,
      jumboPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    // Order by output amount
    return {
      ref: refActions,
      jumbo: jumboActions
    }
  }
}
