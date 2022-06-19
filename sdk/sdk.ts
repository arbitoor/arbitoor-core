import { Provider } from 'near-api-js/lib/providers'
import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { JUMBO, REF, STORAGE_TO_REGISTER_WITH_MFT } from './constants'
import { round } from './ft-contract'
import { percentLess, toReadableNumber, scientificNotationToString, toNonDivisibleNumber } from './numbers'
import { getExpectedOutputFromActions, stableSmart } from './smartRouteLogic.js'
import { SwapActions, PoolMode } from './swap-service'
import { AccountProvider } from './AccountProvider'
import Big from 'big.js'

export interface SwapRoute {
  dex: string;
  actions: SwapActions[];
  output: Big;
  txs: Transaction[];
}

export interface ComputeRoutes {
  inputToken: string,
  outputToken: string,
  inputAmount: string,
  slippageTolerance: number,
}

export interface SwapOptions {
  exchange: string,
  useNearBalance?: boolean;
  swapsToDo: SwapActions[];
  tokenIn: string;
  tokenOut: string;
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

  constructor ({ provider, accountProvider, user, routeCacheDuration }: {
    provider: Provider,
    accountProvider: AccountProvider,
    user: string,
    routeCacheDuration: number,
  }) {
    this.provider = provider
    this.accountProvider = accountProvider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
  }

  /**
   * Get REF pools having one of the tokens
   * @param exchange
   * @param token1
   * @param token2
   * @returns
   */
  getPoolsWithEitherToken (exchange: string, token1: string, token2: string) {
    // Read from cache
    const pools = exchange == REF
      ? this.accountProvider.getRefPools()
      : this.accountProvider.getJumboPools()

    // filter cached pools
    return pools.filter(pool => {
      return pool.token_account_ids.includes(token1) || pool.token_account_ids.includes(token2)
    })
  }

  async nearInstantSwap ({
    exchange,
    tokenIn,
    tokenOut,
    amountIn,
    swapsToDo,
    slippageTolerance
  }: SwapOptions) {
    const transactions = new Array<Transaction>()
    const tokenInActions = new Array<FunctionCallAction>()
    const tokenOutActions = new Array<FunctionCallAction>()

    const tokenInDecimals = (await this.accountProvider.getTokenMetadata(tokenIn))!.decimals
    const tokenOutDecimals = (await this.accountProvider.getTokenMetadata(tokenOut))!.decimals

    const registerToken = (tokenId: string) => {
      const tokenRegistered = this.accountProvider.ftGetStorageBalance(tokenId, this.user)

      if (!tokenRegistered) {
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
    inputAmount,
    slippageTolerance
  }: ComputeRoutes): Promise<SwapRoute[]> {
    // Read from cache
    const refPools = this.getPoolsWithEitherToken(REF, inputToken, outputToken)
    const jumboPools = this.getPoolsWithEitherToken(JUMBO, inputToken, outputToken)

    // doesn't account for stable pool
    const refActions = await stableSmart(
      this.accountProvider,
      refPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as SwapActions[]

    // REF hybrid smart algorithm

    const jumboActions = await stableSmart(
      this.accountProvider,
      jumboPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as SwapActions[]

    return [{
      dex: REF,
      actions: refActions,
      output: getExpectedOutputFromActions(
        refActions,
        outputToken,
        slippageTolerance
      ),
      txs: await this.nearInstantSwap({
        exchange: REF,
        tokenIn: inputToken,
        tokenOut: outputToken,
        amountIn: inputAmount,
        swapsToDo: refActions,
        slippageTolerance
      })
    }, {
      dex: JUMBO,
      actions: jumboActions,
      output: getExpectedOutputFromActions(
        jumboActions,
        outputToken,
        slippageTolerance
      ),
      txs: await this.nearInstantSwap({
        exchange: JUMBO,
        tokenIn: inputToken,
        tokenOut: outputToken,
        amountIn: inputAmount,
        swapsToDo: jumboActions,
        slippageTolerance
      })
    }].sort((a, b) => {
      if (a.output.gt(b.output)) {
        return -1
      }
      if (a.output.lt(b.output)) {
        return 1
      }
      return 0
    })
  }
}
