import { CodeResult, Provider } from 'near-workspaces'
import Big from 'big.js'
import {
  Market as SpinMarket,
  GetOrderbookResponse as SpinOrderbook,
  GetDryRunSwapResponse
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
} : {
  provider: Provider,
  marketId: number,
  price: string,
  token: string,
  amount: string
}): Promise<GetDryRunSwapResponse> {
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
  return JSON.parse(Buffer.from(res.result).toString()) as GetDryRunSwapResponse
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
  limit ?: number
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

export interface SpinEstimate {
  // Output token received
  output: Big;

  // Unused input amount
  remainingAmount: Big;

  // New price of the market after swapping
  price: Big;
}

export interface SpinRouteInfo extends SpinEstimate {
  dex: string;
  market: SpinMarket;
  inputToken: string;
  outputToken: string;
  inputAmount: Big;
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
  orderbook,
  isBid,
  amount,
  baseDecimals
} : {
  orderbook: SpinOrderbook,
  isBid: boolean,
  amount: Big,
  baseDecimals: number
}): SpinEstimate | undefined {
  const ordersToTraverse = isBid ? orderbook.ask_orders : orderbook.bid_orders
  const decimalPlaces = new Big(10).pow(baseDecimals)

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
      const orderQuantity = decimalPlaces.mul(remainingAmount).div(price)
      if (quantity.gte(orderQuantity)) {
        // order is filled, stop traversal
        remainingAmount = new Big(0)
        outputAmount = outputAmount.add(orderQuantity)
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
        outputAmount = quantity.mul(price).div(decimalPlaces)
      }
    }
  }
  // round down to remove decimal places
  return { output: outputAmount.round(), remainingAmount, price: price! }
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
    const swapResult = simulateSpinSwap({
      orderbook,
      isBid,
      amount,
      baseDecimals: market.base.decimal
    })

    if (!bestResult || (swapResult && swapResult.output.gt(bestResult.output))) {
      const marketPrice = isBid
        ? orderbook.ask_orders![0]!.price
        : orderbook.bid_orders![0]!.price

      bestResult = {
        ...swapResult!,
        dex: SPIN,
        market,
        inputToken,
        outputToken,
        inputAmount: amount.sub(swapResult!.remainingAmount),
        marketPrice: new Big(marketPrice),
        isBid
      }
    }
  }

  // To construct transaction we need- market id, input token, amount, threshold price
  return bestResult
}
