import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import Big, { RoundingMode } from 'big.js'
import { JUMBO, MEMO, REF, REFERRAL_ID, SPIN, TONIC, WRAPPED_NEAR } from './constants'
import {
  percentLess,
  toReadableNumber,
  scientificNotationToString,
  toNonDivisibleNumber,
  round
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
  registerToken,
  getRefTransactions
} from './ref-finance'
import { AccountProvider } from './AccountProvider'
import { getPriceForExactOutputSwap, getSpinOutput, getSpinTransactions, SpinRouteInfo } from './spin/spin'
import { getTonicOutput, getTonicTransactions, TonicRouteInfo } from './tonic'
import { getWrappedNearTransactions, WNearRouteInfo } from './wrapped-near'

export type Near = {
  type: 'near'
}

export type FungibleToken = {
  type: 'ft'
  accountId: string
}

export type WrappedNearToken = {
  type: 'ft'
  accountId: typeof WRAPPED_NEAR
}

export type Currency = Near | FungibleToken

// Input parameters to generate routes
export interface RouteParameters {
  inputToken: Currency,
  outputToken: Currency,
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
    switch (routeInfo.dex) {
      case WRAPPED_NEAR: return getWrappedNearTransactions({
        accountProvider: this.accountProvider,
        user: this.user,
        routeInfo: routeInfo as WNearRouteInfo,
      })
      case SPIN: return getSpinTransactions({
        accountProvider: this.accountProvider,
        user: this.user,
        routeInfo: routeInfo as SpinRouteInfo,
        slippageTolerance
      })

      case TONIC: return getTonicTransactions({
        accountProvider: this.accountProvider,
        user: this.user,
        routeInfo: routeInfo as TonicRouteInfo,
        slippageTolerance
      })

      case REF:
      case JUMBO: return getRefTransactions({
        accountProvider: this.accountProvider,
        user: this.user,
        routeInfo: routeInfo as RefRouteInfo,
        slippageTolerance,
        referral: this.referral
      })

      default: throw Error('Unsupported DEX')
    }
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
    const routes: RouteInfo[] = []

    if (
      inputToken.type === 'near' &&
      outputToken.type === 'ft' &&
      outputToken.accountId === 'wrap.near'
    ) {
      routes.push({
        dex: WRAPPED_NEAR,
        wrap: true,
        output: new Big(inputAmount)
      })
    } else if (
      inputToken.type === 'ft' &&
      inputToken.accountId === 'wrap.near' &&
      outputToken.type === 'near'
    ) {
      routes.push({
        dex: WRAPPED_NEAR,
        wrap: false,
        output: new Big(inputAmount)
      })
    } else if (inputToken.type === 'ft' && outputToken.type === 'ft') {
      // doesn't account for stable pool
      const refSwapView = await stableSmart(
        this.accountProvider,
        RefFork.REF,
        inputToken.accountId,
        outputToken.accountId,
        inputAmount,
        undefined
      ) as EstimateSwapView[]

      const refSwapOutput = getExpectedOutputFromActions(
        refSwapView,
        outputToken.accountId
      )

      // REF hybrid smart algorithm
      const refHybridSwapView = await getHybridStableSmart(
        this.accountProvider,
        RefFork.REF,
        inputToken.accountId,
        outputToken.accountId,
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
            output: refSwapOutput,
            inputAmount: new Big(inputAmount)
          }

      const jumboSwapView = await stableSmart(
        this.accountProvider,
        RefFork.JUMBO,
        inputToken.accountId,
        outputToken.accountId,
        inputAmount,
        undefined
      ) as EstimateSwapView[]

      const jumboSwapOutput = getExpectedOutputFromActions(
        jumboSwapView,
        outputToken.accountId
      )

      const jumboHybridSwapView = await getHybridStableSmart(
        this.accountProvider,
        RefFork.JUMBO,
        inputToken.accountId,
        outputToken.accountId,
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
            output: jumboSwapOutput,
            inputAmount: new Big(inputAmount)
          }

      routes.push(refRoute, jumboRoute)

      const spinOutput = getSpinOutput({
        provider: this.accountProvider,
        inputToken: inputToken.accountId,
        outputToken: outputToken.accountId,
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
        inputToken: inputToken.accountId,
        outputToken: outputToken.accountId,
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
          output: tonicOutput.output.div(decimalPlaces)
        })
      }
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
