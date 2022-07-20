import { CodeResult, Provider } from 'near-workspaces'
import Big from 'big.js'
import {
  Market as SpinMarket,
  GetOrderbookResponse as SpinOrderbook
} from '@spinfi/core'
import { SPIN } from '../constants'
import { AccountProvider } from '../AccountProvider'

export async function getSpinMarkets (provider: Provider): Promise<SpinMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'get_markets',
    args_base64: '',
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinMarket[]
}

export interface SpinDryRunResult {
  /**
   * Input tokens are refunded so that slippage limit is not crossed.
   */
  refund: string;
  /**
   * The output amount. It includes the exchange fees.
   */
  received: string;

  /**
   * The exchange fee. Subtract fees from received to get the output amount for the user.
   */
  fee: string;
}

/**
 * Get swap estimate from RPC
 * @param param0
 * @returns
 */
export async function getDryRunSwap ({
  provider,
  marketId,
  price,
  token,
  amount
}: {
  provider: Provider,
  marketId: number,
  price: string,
  // input token
  token: string,
  amount: string
}): Promise<SpinDryRunResult> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'dry_run_swap',
    args_base64: Buffer.from(JSON.stringify({
      swap: {
        market_id: marketId,
        price
      },
      token,
      amount
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinDryRunResult
}

/**
 * Fetch a Spin orderbook from RPC
 * @param provider
 * @param marketId
 * @param limit
 * @returns
 */
export async function getSpinOrderbook (
  provider: Provider,
  marketId: number,
  limit: number = 50
): Promise<SpinOrderbook> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'get_orderbook',
    args_base64: Buffer.from(JSON.stringify({
      market_id: marketId,
      limit
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinOrderbook
}

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
