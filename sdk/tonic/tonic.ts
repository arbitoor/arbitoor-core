import Big, { RoundingMode } from 'big.js'
import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { MEMO, SPIN, TONIC } from '../constants'
import { AccountProvider } from '../AccountProvider'
import { getPriceForExactOutputSwap, OrderbookEstimate, SpinRouteInfo } from '../spin'
import { TonicMarket } from './api'
import { registerToken } from '../ref-finance'

export interface FungibleTokenType {
  type: 'ft';
  account_id: string;
}

/**
 * Get the estimated swap output of a Tonic orderbook
 *
 * @param param0
 * @returns
 */
export function simulateTonicSwap ({
  market,
  isBid,
  amount
}: {
  market: TonicMarket,
  isBid: boolean,
  amount: Big,
}): OrderbookEstimate | undefined {
  const { orderbook, taker_fee_base_rate: takerFee } = market
  const baseLotSize = market.base_token.lot_size
  const quoteLotSize = market.quote_token.lot_size
  const ordersToTraverse = isBid ? orderbook.asks : orderbook.bids
  const decimalPlaces = new Big(10).pow(market.base_token.decimals)

  if (!ordersToTraverse || ordersToTraverse.length === 0) {
    return undefined
  }

  let price: Big

  let outputAmount = new Big(0)
  let remainingAmount = amount

  // Tonic charges taker fee on the quote asset
  if (isBid) {
    // subtract fee from input emount
    remainingAmount = remainingAmount.mul(10000 - takerFee).div(10000)
  }
  // else subtract from output amount

  for (const order of ordersToTraverse) {
    const quantity = new Big(order.open_quantity)
    price = new Big(order.limit_price)
    // For bids (buy orders), match against asks (sell orders)
    // Bids are made in quote currency (USDC). To get quantity at each step, divide amount by price
    if (isBid) {
      // output not rounded (USDC to USN)
      const orderQuantity = decimalPlaces.mul(remainingAmount).div(price).round()
      if (quantity.gte(orderQuantity)) {
        // order is filled, stop traversal
        const baseLotsFilled = orderQuantity.div(baseLotSize).round()
        const roundedQuantity = baseLotsFilled.mul(baseLotSize)

        outputAmount = outputAmount.add(roundedQuantity)
        remainingAmount = orderQuantity.mod(baseLotSize).mul(price).div(decimalPlaces).round()

        break
      } else {
        // use all available quanitity at this step, then move to the next
        remainingAmount = remainingAmount.sub(quantity.mul(price).div(decimalPlaces))
        outputAmount = outputAmount.add(quantity)
      }
    } else {
      // Asks are matched against bids. Both values are in base currency, but output needs to be in quote.
      // Multiply output with price at each level to get in terms of quote.
      if (quantity.gte(remainingAmount)) {
        outputAmount = outputAmount.add(remainingAmount.mul(price).div(decimalPlaces))
        remainingAmount = new Big(0)
        break
      } else {
        remainingAmount = remainingAmount.sub(quantity)
        outputAmount = outputAmount.add(quantity.mul(price).div(decimalPlaces))
      }
    }
  }

  if (!isBid) {
    // subtract fee from input emount
    outputAmount = outputAmount.mul(10000 - takerFee).div(10000)
  }

  // output amount for bids should be a multiple of lot size
  const lotSize = isBid ? baseLotSize : quoteLotSize
  outputAmount = outputAmount.div(lotSize).round().mul(lotSize)

  return { output: outputAmount, remainingAmount, price: price! }
}

export interface TonicSwapLeg {
  market: TonicMarket
  isBid: boolean
}

export interface TonicRouteInfo extends OrderbookEstimate {
  dex: string;
  legs: [TonicSwapLeg] | [TonicSwapLeg, TonicSwapLeg]
  inputAmount: Big;
}

export function getTonicOutput ({
  provider,
  inputToken,
  outputToken,
  amount
}: {
  provider: AccountProvider,
  inputToken: string,
  outputToken: string,
  amount: Big,
}): TonicRouteInfo | undefined {
  const markets = provider.getTonicMarkets()

  const singleHopMarkets: TonicMarket[] = []
  const inputTokenMarkets: TonicSwapLeg[] = []
  const outputTokenMarkets: TonicSwapLeg[] = []

  for (const market of markets) {
    const { base_token, quote_token } = market

    // Disable native NEAR markets until wrapping is resolved
    if (base_token.token_type.type === 'ft' && quote_token.token_type.type === 'ft') {
      const baseTokenId = base_token.token_type.account_id
      const quoteTokenId = quote_token.token_type.account_id

      if ((inputToken === baseTokenId && outputToken === quoteTokenId) ||
        (outputToken === baseTokenId && inputToken === quoteTokenId)) {
        singleHopMarkets.push(market)
      } else if (inputToken === baseTokenId) {
        inputTokenMarkets.push({ market, isBid: false })
      } else if (inputToken === quoteTokenId) {
        inputTokenMarkets.push({ market, isBid: true })
      } else if (outputToken === baseTokenId) {
        outputTokenMarkets.push({ market, isBid: true })
      } else if (outputToken === quoteTokenId) {
        outputTokenMarkets.push({ market, isBid: false })
      }
    }
  }

  let bestResult: TonicRouteInfo | undefined

  // Direct paths
  for (const market of singleHopMarkets) {
    // estimate output from cached orderbooks
    market.taker_fee_base_rate
    const baseToken = market.base_token.token_type as FungibleTokenType

    const isBid = baseToken.account_id === outputToken
    const swapResult = simulateTonicSwap({
      market,
      isBid,
      amount
    })
    if (swapResult && (!bestResult || swapResult.output.gt(bestResult.output))) {
      bestResult = {
        ...swapResult,
        dex: TONIC,
        legs: [{ market, isBid }],
        inputAmount: amount.sub(swapResult.remainingAmount)
      }
    }
  }

  // Two market paths
  for (const inputMarket of inputTokenMarkets) {
    for (const outputMarket of outputTokenMarkets) {
      const { base_token: inputBase, quote_token: inputQuote } = inputMarket.market
      const { base_token: outputBase, quote_token: outputQuote } = outputMarket.market

      // Native NEAR swaps disabled for now
      if (
        inputBase.token_type.type === 'ft' &&
        inputQuote.token_type.type === 'ft' &&
        outputBase.token_type.type === 'ft' &&
        outputQuote.token_type.type === 'ft'
      ) {
        if (
          (inputMarket.isBid && outputMarket.isBid && inputBase.token_type.account_id === outputQuote.token_type.account_id) ||
          (inputMarket.isBid && !outputMarket.isBid && inputBase.token_type.account_id === outputBase.token_type.account_id) ||
          (!inputMarket.isBid && outputMarket.isBid && inputQuote.token_type.account_id === outputQuote.token_type.account_id) ||
          (!inputMarket.isBid && !outputMarket.isBid && inputQuote.token_type.account_id === outputBase.token_type.account_id)
        ) {
          const inputSwap = simulateTonicSwap({
            ...inputMarket,
            amount
          })

          if (inputSwap) {
            const outputSwap = simulateTonicSwap({
              ...outputMarket,
              amount: inputSwap.output
            })

            if (outputSwap && (!bestResult || outputSwap.output.gt(bestResult.output))) {
              bestResult = {
                ...outputSwap!,
                dex: TONIC,
                legs: [inputMarket, outputMarket],
                inputAmount: amount.sub(inputSwap.remainingAmount)
              }
            }
          }
        }
      }
    }
  }

  return bestResult
}

/**
 * Get transactions to swap on Tonic
 * @param param0
 * @returns
 */
export function getTonicTransactions ({
  accountProvider,
  user,
  routeInfo,
  slippageTolerance
} : {
  accountProvider: AccountProvider,
  user: string,
  routeInfo: TonicRouteInfo,
  slippageTolerance: number
}) {
  const transactions = new Array<Transaction>()

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

  const registerTx = registerToken(accountProvider, outputToken.account_id, user)
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

  transactions.push({
    receiverId: inputToken.account_id,
    signerId: user,
    actions: [{
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
    }]
  })

  return transactions
}
