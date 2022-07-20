import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import Big, { RoundingMode } from 'big.js'
import { JUMBO, MEMO, REF, REFERRAL_ID, SPIN, TONIC } from './constants'
import { round } from './ft-contract'
import {
  percentLess,
  toReadableNumber,
  scientificNotationToString,
  toNonDivisibleNumber
} from './numbers'
import {
  getExpectedOutputFromActions,
  stableSmart,
  EstimateSwapView,
  PoolMode,
  filterPoolsWithEitherToken,
  getHybridStableSmart,
  RefFork,
  RouteInfo,
  RefRouteInfo,
  registerToken
} from './ref-finance'
import { AccountProvider } from './AccountProvider'
import { getPriceForExactOutputSwap, getSpinOutput, SpinRouteInfo } from './spin/spin-api'
import { getTonicOutput, TonicRouteInfo } from './tonic'
import { index } from 'mathjs'

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

  // Address receiving referral fees
  referral: string

  constructor ({ accountProvider, user, referral = REFERRAL_ID }: {
    accountProvider: AccountProvider,
    user: string,
    referral?: string
  }) {
    this.accountProvider = accountProvider
    this.user = user
    this.referral = referral
  }

  /**
   * Generate NEAR transactions from a swap route
   * @param param0
   * @returns
   */
  async generateTransactions ({
    routeInfo,
    slippageTolerance
  }: {
    routeInfo: RouteInfo;
    slippageTolerance: number;
  }) {
    const transactions = new Array<Transaction>()
    const tokenInActions = new Array<FunctionCallAction>()

    if (routeInfo.dex === SPIN) {
      // inputToken-outputToken are redundant, use isBid to read from market
      const { market, orderbook, inputAmount, output, inputToken, outputToken, isBid } = routeInfo as SpinRouteInfo

      const registerTx = registerToken(this.accountProvider, outputToken, this.user)
      if (registerTx) {
        transactions.push(registerTx)
      }

      const minimumOut = output.mul(100 - slippageTolerance).div(100)
      const limitPrice = getPriceForExactOutputSwap(
        orderbook,
        minimumOut,
        isBid
      )
      tokenInActions.push({
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: {
            receiver_id: SPIN,
            amount: inputAmount.toString(),
            msg: JSON.stringify({
              market_id: market.id,
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
    } else if (routeInfo.dex === TONIC) {
      const { inputAmount, legs, output } = routeInfo as TonicRouteInfo
      const outputMarket = legs.at(-1)!

      const inputToken = (legs[0].isBid
        ? legs[0].market.quote_token.token_type
        : legs[0].market.base_token.token_type) as {
          type: 'ft';
          account_id: string;
        }

      const outputToken = (outputMarket.isBid
        ? outputMarket.market.base_token.token_type
        : outputMarket.market.quote_token.token_type) as {
          type: 'ft';
          account_id: string;
        }

      const outputAmountMachineFormat = new Big(10).pow(
        outputMarket.isBid
          ? outputMarket.market.base_token.decimals
          : outputMarket.market.quote_token.decimals
      ).mul(output)

      const registerTx = registerToken(this.accountProvider, outputToken.account_id, this.user)
      if (registerTx) {
        transactions.push(registerTx)
      }

      const tickSize = new Big(outputMarket.market.quote_token.lot_size)
      let limitPrice: Big
      if (outputMarket.isBid) {
        const marketPrice = new Big(outputMarket.market.orderbook.asks[0]!.limit_price)
        limitPrice = tickSize.mul(marketPrice.mul(100 + slippageTolerance).div(100).div(tickSize).round())
      } else {
        const marketPrice = new Big(outputMarket.market.orderbook.bids[0]!.limit_price)
        tickSize.mul(marketPrice.mul(100 - slippageTolerance).div(100).div(tickSize).round(undefined, RoundingMode.RoundUp))
      }

      const outputLotSize = outputMarket.isBid
        ? outputMarket.market.base_token.lot_size
        : outputMarket.market.quote_token.lot_size

      const minimumOut = outputAmountMachineFormat.mul(100 - slippageTolerance).div(100)
        .div(outputLotSize).round().mul(outputLotSize) // rounding

      const swapParams = legs.map((leg, i) => {
        return {
          type: 'Swap',
          market_id: leg.market.id,
          side: leg.isBid ? 'Buy' : 'Sell',
          min_output_token: legs.length == 2 && i === 0 ? '0' : minimumOut.toString()
        }
      })
      tokenInActions.push({
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer_call',
          args: {
            receiver_id: TONIC,
            amount: inputAmount.toString(),
            msg: JSON.stringify({
              action: 'Swap',
              params: swapParams
            }),
            memo: MEMO
          },
          gas: '180000000000000',
          deposit: '1'
        }
      })

      transactions.push({
        receiverId: inputToken.account_id,
        signerId: this.user,
        actions: tokenInActions
      })
    } else {
      const { dex, view: swapsToDo, inputAmount } = routeInfo as RefRouteInfo

      if (swapsToDo.length === 0) {
        return transactions
      }

      const inputToken = swapsToDo.at(0)!.inputToken!
      const outputToken = swapsToDo.at(-1)!.outputToken!

      const tokenInDecimals = (await this.accountProvider.getTokenMetadata(inputToken))!.decimals
      const tokenOutDecimals = (await this.accountProvider.getTokenMetadata(outputToken))!.decimals

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
            token_in: inputToken,
            token_out: outputToken,
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

        const registerTx = registerToken(this.accountProvider, outputToken, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }

        tokenInActions.push({
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: {
              receiver_id: dex,
              amount: inputAmount,
              msg: JSON.stringify({
                force: 0,
                actions: swapActions,
                referral_id: this.referral
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
      } else if (isSmartRouteV1Swap) {
        // making sure all actions get included for hybrid stable smart.
        const registerTx = registerToken(this.accountProvider, outputToken, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }
        var actionsList = []

        const swap1 = swapsToDo[0]!
        actionsList.push({
          pool_id: swap1.pool.id,
          token_in: swap1.inputToken,
          token_out: swap1.outputToken,
          amount_in: inputAmount,
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
          receiverId: inputToken,
          signerId: this.user,
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'ft_transfer_call',
                args: {
                  receiver_id: dex,
                  amount: inputAmount,
                  msg: JSON.stringify({
                    force: 0,
                    actions: actionsList,
                    referral_id: this.referral
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
        const registerTx = registerToken(this.accountProvider, outputToken, this.user)
        if (registerTx) {
          transactions.push(registerTx)
        }
        var actionsList = []
        const allSwapsTokens = swapsToDo.map((s) => [s.inputToken, s.outputToken]) // to get the hop tokens
        for (const i in allSwapsTokens) {
          const swapTokens = allSwapsTokens[i]
          if (swapTokens![0] == inputToken && swapTokens![1] == outputToken) {
            // parallel, direct hop route.
            actionsList.push({
              pool_id: swapsToDo[i]!.pool.id,
              token_in: inputToken,
              token_out: outputToken,
              amount_in: swapsToDo[i]!.pool.partialAmountIn,
              min_amount_out: round(
                tokenOutDecimals,
                toNonDivisibleNumber(
                  tokenOutDecimals,
                  percentLess(slippageTolerance, swapsToDo[i]!.estimate)
                )
              )
            })
          } else if (swapTokens![0] == inputToken) {
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
          receiverId: inputToken,
          signerId: this.user,
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'ft_transfer_call',
                args: {
                  receiver_id: dex,
                  amount: inputAmount,
                  msg: JSON.stringify({
                    force: 0,
                    actions: actionsList,
                    referral_id: this.referral
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

    if (spinOutput) {
      const outputDecimals = spinOutput.isBid ? spinOutput.market.base.decimal : spinOutput.market.quote.decimal
      const decimalPlaces = new Big(10).pow(outputDecimals)

      // Account for decimal places.
      // TODO return in raw form from all algorithms. Forced to convert Spin results because Ref does it.
      routes.push({
        ...spinOutput,
        output: spinOutput!.output.div(decimalPlaces)
      })
    }

    const tonicOutput = getTonicOutput({
      provider: this.accountProvider,
      inputToken,
      outputToken,
      amount: new Big(inputAmount)
    })
    if (tonicOutput) {
      const outputLeg = tonicOutput.legs.at(-1)!
      const outputDecimals = outputLeg.isBid
        ? outputLeg.market.base_token.decimals
        : outputLeg.market.quote_token.decimals
      const decimalPlaces = new Big(10).pow(outputDecimals)

      routes.push({
        ...tonicOutput,
        output: tonicOutput!.output.div(decimalPlaces)
      })
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
