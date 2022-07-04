import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { JUMBO, MEMO, REF, REFERRAL_ID, SPIN, STORAGE_TO_REGISTER_WITH_MFT } from './constants'
import { round } from './ft-contract'
import { percentLess, toReadableNumber, scientificNotationToString, toNonDivisibleNumber } from './numbers'
import { getExpectedOutputFromActions, stableSmart, EstimateSwapView, PoolMode, filterPoolsWithEitherToken, getHybridStableSmart, RefFork, RouteInfo, RefRouteInfo, registerToken } from './ref-finance'
import { AccountProvider } from './AccountProvider'
import Big from 'big.js'
import { getSpinOutput, SpinRouteInfo } from './spin/spin-api'

// Input parameters to generate routes
export interface RouteParameters {
  inputToken: string,
  outputToken: string,
  inputAmount: string,
}

export class Arbitoor {
  // To fetch accounts
  accountProvider: AccountProvider

  // User address for swaps
  user: string
  // Data is refreshed priodically after this many milliseconds elapse
  routeCacheDuration: number

  constructor ({ accountProvider, user, routeCacheDuration }: {
    accountProvider: AccountProvider,
    user: string,
    routeCacheDuration: number,
  }) {
    this.accountProvider = accountProvider
    this.user = user
    this.routeCacheDuration = routeCacheDuration
  }

  async generateTransactions ({
    routeInfo,
    slippageTolerance
  }: {
    routeInfo: RouteInfo;
    slippageTolerance: number;
  }) {
    const transactions = new Array<Transaction>()
    const tokenInActions = new Array<FunctionCallAction>()

    if ((routeInfo as SpinRouteInfo).marketId) {
      const { marketId, inputAmount, inputToken, isBid, marketPrice } = routeInfo as SpinRouteInfo

      const limitPrice = isBid
        ? marketPrice.mul(100 + slippageTolerance).div(100)
        : marketPrice.mul(100 - slippageTolerance).div(100)

      tokenInActions.push({
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: {
            receiver_id: SPIN,
            amount: inputAmount.toString(),
            msg: JSON.stringify({
              market_id: marketId,
              price: limitPrice.toString()
            }),
            memo: MEMO
          },
          gas: '180000000000000',
          deposit: '1'
        }
      })

      transactions.push({
        receiverId: inputToken,
        signerId: this.user,
        actions: tokenInActions
      })
    } else {
      const { dex: exchange, view: swapsToDo, inputAmount: amountIn } = routeInfo as RefRouteInfo

      if (swapsToDo.length === 0) {
        return transactions
      }

      const tokenIn = swapsToDo.at(0)!.inputToken!
      const tokenOut = swapsToDo.at(-1)!.outputToken!

      const tokenInDecimals = (await this.accountProvider.getTokenMetadata(tokenIn))!.decimals
      const tokenOutDecimals = (await this.accountProvider.getTokenMetadata(tokenOut))!.decimals

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

        const registerTx = registerToken(this.accountProvider, tokenOut, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }

        tokenInActions.push({
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: exchange,
              amount: amountIn,
              msg: JSON.stringify({
                force: 0,
                actions: swapActions,
                referral_id: REFERRAL_ID
              }),
              memo: MEMO
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
        const registerTx = registerToken(this.accountProvider, tokenOut, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }
        var actionsList = []

        const swap1 = swapsToDo[0]!
        actionsList.push({
          pool_id: swap1.pool.id,
          token_in: swap1.inputToken,
          token_out: swap1.outputToken,
          amount_in: amountIn,
          min_amount_out: '0'
        })
        const swap2 = swapsToDo[1]
        if (swap2) {
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
                    actions: actionsList,
                    referral_id: REFERRAL_ID
                  }),
                  memo: MEMO
                },
                gas: '180000000000000',
                deposit: '1'
              }

            }
          ]
        })
      } else {
        // making sure all actions get included.
        const registerTx = registerToken(this.accountProvider, tokenOut, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }
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
                    actions: actionsList,
                    referral_id: REFERRAL_ID
                  }),
                  memo: MEMO
                },
                gas: '180000000000000',
                deposit: '1'
              }

            }
          ]
        })
      }
    }

    return transactions
  };

  /**
   * Find trade routes from the input to output token, ranked by output amount.
   *
   * @param param0
   */
  async computeRoutes ({
    inputToken,
    outputToken,
    inputAmount
  }: RouteParameters): Promise<RouteInfo[]> {
    // Read from cache
    const refPools = filterPoolsWithEitherToken(this.accountProvider.getRefPools(), inputToken, outputToken)
    const jumboPools = filterPoolsWithEitherToken(this.accountProvider.getJumboPools(), inputToken, outputToken)

    // doesn't account for stable pool
    const refSwapView = await stableSmart(
      this.accountProvider,
      refPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    const refSwapOutput = getExpectedOutputFromActions(
      refSwapView,
      outputToken
    )

    // REF hybrid smart algorithm
    const refHybridSwapView = await getHybridStableSmart(
      this.accountProvider,
      RefFork.REF,
      inputToken,
      outputToken,
      inputAmount
    )

    const refRoute = new Big(refHybridSwapView.estimate).gt(refSwapOutput)
      ? {
          dex: REF,
          view: refHybridSwapView.actions,
          output: new Big(refHybridSwapView.estimate),
          inputAmount: new Big(inputAmount)
        }
      : {
          dex: REF,
          view: refSwapView,
          output: getExpectedOutputFromActions(
            refSwapView,
            outputToken
          ),
          inputAmount: new Big(inputAmount)
        }

    const jumboSwapView = await stableSmart(
      this.accountProvider,
      jumboPools,
      inputToken,
      outputToken,
      inputAmount,
      undefined
    ) as EstimateSwapView[]

    const jumboSwapOutput = getExpectedOutputFromActions(
      jumboSwapView,
      outputToken
    )

    const jumboHybridSwapView = await getHybridStableSmart(
      this.accountProvider,
      RefFork.JUMBO,
      inputToken,
      outputToken,
      inputAmount
    )

    const jumboRoute = new Big(jumboHybridSwapView.estimate).gt(jumboSwapOutput)
      ? {
          dex: JUMBO,
          view: jumboHybridSwapView.actions,
          output: new Big(jumboHybridSwapView.estimate),
          inputAmount: new Big(inputAmount)
        }
      : {
          dex: JUMBO,
          view: jumboSwapView,
          output: getExpectedOutputFromActions(
            jumboSwapView,
            outputToken
          ),
          inputAmount: new Big(inputAmount)
        }

    const routes: RouteInfo[] = [refRoute, jumboRoute]

    const spinOutput = getSpinOutput({
      provider: this.accountProvider,
      inputToken,
      outputToken,
      amount: new Big(inputAmount)
    })

    console.log('spin output', spinOutput)
    if (spinOutput) {
      routes.push(spinOutput)
    }

    return routes.sort((a, b) => {
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
