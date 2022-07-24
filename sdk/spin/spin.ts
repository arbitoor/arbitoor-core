import Big from 'big.js'
import {
  Market as SpinMarket,
  GetOrderbookResponse as SpinOrderbook
} from '@spinfi/core'
import { MEMO, SPIN } from '../constants'
import { AccountProvider } from '../AccountProvider'
import { FunctionCallAction, Transaction } from '@near-wallet-selector/core'
import { registerToken } from '../ref-finance'

export interface OrderbookEstimate {
  // Output token received
  output: Big;

  // Unused input amount
  remainingAmount: Big;

  // New price of the market after swapping
  price: Big;
}

export interface SpinRouteInfo extends OrderbookEstimate {
  dex: string;
  market: SpinMarket;
  orderbook: SpinOrderbook;
  inputToken: string;
  outputToken: string;
  inputAmount: Big;
  // To set slippage limit while generating transaction
  marketPrice: Big;
  isBid: boolean;
}

/**
 * Get the estimated swap output of a Spin orderbook
 *
 * TODO round off with lot sizes to improve accuracy
 * @param param0
 * @returns
 */
export function simulateSpinSwap ({
  market,
  orderbook,
  isBid,
  amount
}: {
  market: SpinMarket,
  orderbook: SpinOrderbook,
  isBid: boolean,
  amount: Big,
}): OrderbookEstimate | undefined {
  const ordersToTraverse = isBid ? orderbook.ask_orders : orderbook.bid_orders
  const decimalPlaces = new Big(10).pow(market.base.decimal)

  if (!ordersToTraverse || ordersToTraverse.length === 0) {
    return undefined
  }

  let price: Big

  let remainingAmount = amount
  let outputAmount = new Big(0)
  for (const order of ordersToTraverse) {
    const quantity = new Big(order.quantity)
    price = new Big(order.price)
    // For bids (buy orders), match against asks (sell orders)
    // Bids are made in quote currency (USDC). To get quantity at each step, divide amount by price
    if (isBid) {
      // Say that price of a SOL/USDC market is 100 and lot size is 1. If the user places a bid with 102 USDC,
      // then only 100 USDC (1 lot) should be consumed.
      const orderQuantity = decimalPlaces.mul(remainingAmount).div(price)
        // multiple of step size
        .div(market.limits.step_size!).round().mul(market.limits.step_size!)
      if (quantity.gte(orderQuantity)) {
        // order is filled, stop traversal
        const consumedQuoteAmount = orderQuantity.mul(price).div(decimalPlaces)
        remainingAmount = remainingAmount.sub(consumedQuoteAmount) // include dust
        outputAmount = outputAmount.add(orderQuantity)
        break
      } else {
        // use all available quanitity at this step, then move to the next
        const consumedQuoteAmount = quantity.mul(price).div(decimalPlaces)
        remainingAmount = remainingAmount.sub(consumedQuoteAmount)
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

  // subtract taker fee
  // In Spin- output minus fees need not be a multiple of lot size
  const { taker_fee: takerFee, decimals: feeDecimals } = market.fees
  const feeDecimalPlaces = new Big(10).pow(feeDecimals)
  outputAmount = outputAmount.mul(feeDecimalPlaces.sub(takerFee)).div(feeDecimalPlaces).round()
  return { output: outputAmount, remainingAmount, price: price! }
}

/**
 * Find the swap path and output amount for a spin swap
 *
 * @param param0
 * @returns
 */
export function getSpinOutput ({
  provider,
  inputToken,
  outputToken,
  amount
}: {
  provider: AccountProvider,
  inputToken: string,
  outputToken: string,
  amount: Big,
}): SpinRouteInfo | undefined {
  const markets = provider.getSpinMarkets()
  const orderbooks = provider.getSpinOrderbooks()
  const validMarkets = markets.filter(market => {
    return (market.base.address === inputToken && market.quote.address === outputToken) ||
      (market.base.address === outputToken && market.quote.address === inputToken)
  })

  let bestResult: SpinRouteInfo | undefined

  for (const market of validMarkets) {
    // estimate output from cached orderbooks
    const orderbook = orderbooks.get(market.id)!

    const isBid = market.base.address === outputToken // true

    const {
      min_base_quantity,
      max_base_quantity,
      min_quote_quantity,
      max_quote_quantity
    } = market.limits

    // Skip this market if input amount is out of bounds
    if (
      (isBid && (amount.gt(max_quote_quantity) || amount.lt(min_quote_quantity))) ||
      (!isBid && (amount.gt(max_base_quantity) || amount.lt(min_base_quantity)))
    ) {
      continue
    }

    const swapResult = simulateSpinSwap({
      market,
      orderbook,
      isBid,
      amount
    })
    if (swapResult && (!bestResult || swapResult.output.gt(bestResult.output))) {
      const marketPrice = isBid
        ? orderbook.ask_orders![0]!.price
        : orderbook.bid_orders![0]!.price

      const output = swapResult.output

      // Skip this market if output amount is out of bounds
      if (
        (isBid && (output.gt(max_base_quantity) || output.lt(min_base_quantity))) ||
        (!isBid && (output.gt(max_quote_quantity) || output.lt(min_quote_quantity)))
      ) {
        continue
      }

      bestResult = {
        ...swapResult,
        dex: SPIN,
        market,
        orderbook,
        inputToken,
        outputToken,
        inputAmount: amount.sub(swapResult.remainingAmount),
        marketPrice: new Big(marketPrice),
        isBid
      }
    }
  }

  // To construct transaction we need- market id, input token, amount, threshold price
  return bestResult
}

/**
 * The new price of a slab after an exact output swap
 */
export function getPriceForExactOutputSwap (
  orderbook: SpinOrderbook,
  output: Big,
  isBid: boolean
) {
  const ordersToTraverse = isBid ? orderbook.ask_orders : orderbook.bid_orders

  if (!ordersToTraverse || ordersToTraverse.length === 0) {
    throw Error('Cannot pass empty orderbook')
  }

  let price!: Big

  // No input order quantity. Instead check if this order can fill remaining output
  let remainingOutput = output
  for (const order of ordersToTraverse) {
    const quantity = new Big(order.quantity)
    price = new Big(order.price)
    if (isBid) {
      const ouputQuoteAmount = quantity.mul(price)
      if (ouputQuoteAmount.gte(remainingOutput)) {
        remainingOutput = new Big(0)
        break
      } else {
        remainingOutput.sub(ouputQuoteAmount)
      }
    } else {
      // Ask: base for quote swap. Match with bids, i.e. quote for base orders.
      // check if tick as enough lots to fill output
      if (quantity.gte(remainingOutput)) {
        remainingOutput = new Big(0)
        break
      } else {
        remainingOutput = remainingOutput.sub(quantity)
      }
    }
  }

  return price
}

/**
 * Get transactions to swap on Spin
 * @param param0
 * @returns
 */
export function getSpinTransactions ({
  accountProvider,
  user,
  routeInfo,
  slippageTolerance
} : {
  accountProvider: AccountProvider,
  user: string,
  routeInfo: SpinRouteInfo,
  slippageTolerance: number
}) {
  const transactions = new Array<Transaction>()

  // inputToken-outputToken are redundant, use isBid to read from market
  const { market, orderbook, inputAmount, output, inputToken, outputToken, isBid } = routeInfo

  const registerTx = registerToken(accountProvider, outputToken, user)
  if (registerTx) {
    transactions.push(registerTx)
  }

  const minimumOut = output.mul(100 - slippageTolerance).div(100)
  const limitPrice = getPriceForExactOutputSwap(
    orderbook,
    minimumOut,
    isBid
  )

  transactions.push({
    receiverId: inputToken,
    signerId: user,
    actions: [{
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
    }]
  })

  return transactions
}
