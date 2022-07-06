import { Provider, CodeResult } from "near-workspaces"
import { Market } from '@tonic-foundation/tonic'
import { SPIN, TONIC } from "../constants"
import { MarketViewV1 as TonicMarket, TokenType, OrderbookViewV1 as TonicOrderbook } from "@tonic-foundation/tonic/lib/types/v1"
import Big from "big.js"
import { AccountProvider } from "../AccountProvider"
import { SpinRouteInfo, simulateSpinSwap, OrderbookEstimate } from "../spin"

export async function getTonicMarkets(
  provider: Provider,
  fromIndex: number = 0,
  limit: number = 100,
): Promise<TonicMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: TONIC,
    method_name: 'list_markets',
    args_base64: Buffer.from(JSON.stringify({
      from_index: fromIndex,
      limit,
    })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString())
}

export interface FungibleTokenType {
  type: 'ft';
  account_id: string;
}

/**
 * Get the estimated swap output of a Spin orderbook
 *
 * TODO round off with lot sizes to improve accuracy
 * @param param0
 * @returns
 */
 export function simulateTonicSwap({
  orderbook,
  isBid,
  amount,
  baseDecimals
}: {
  orderbook: TonicOrderbook,
  isBid: boolean,
  amount: Big,
  baseDecimals: number
}): OrderbookEstimate | undefined {
  const ordersToTraverse = isBid ? orderbook.asks : orderbook.bids
  const decimalPlaces = new Big(10).pow(baseDecimals)

  if (!ordersToTraverse || ordersToTraverse.length === 0) {
    return undefined
  }

  let price: Big

  let remainingAmount = amount
  let outputAmount = new Big(0)
  for (const order of ordersToTraverse) {
    const quantity = new Big(order.open_quantity)
    price = new Big(order.limit_price)
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
        outputAmount = outputAmount.add(quantity.mul(price).div(decimalPlaces))
      }
    }
  }
  // round down to remove decimal places
  return { output: outputAmount.round(), remainingAmount, price: price! }
}

export interface TonicRouteInfo extends OrderbookEstimate {
  dex: string;
  market: TonicMarket;
  inputToken: string;
  outputToken: string;
  inputAmount: Big;
  marketPrice: Big;
  isBid: boolean;
}

export function getTonicOutput({
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
    const validMarkets = markets.filter(({base_token, quote_token}) => {
      // Disable native NEAR markets until wrapping is resolved
      return (base_token.token_type.type === 'ft' && quote_token.token_type.type === 'ft') && (
        (base_token.token_type.account_id === inputToken && quote_token.token_type.account_id === outputToken)
        || (base_token.token_type.account_id === outputToken && quote_token.token_type.account_id === inputToken)
      )
    })

  let bestResult: TonicRouteInfo | undefined

  for (const market of validMarkets) {
    // estimate output from cached orderbooks
    const orderbook = market.orderbook
    market.taker_fee_base_rate
    const baseToken = market.base_token.token_type as FungibleTokenType

    const isBid = baseToken.account_id === outputToken
    const swapResult = simulateTonicSwap({
      orderbook,
      isBid,
      amount,
      baseDecimals: market.base_token.decimals
    })
    if (!bestResult || (swapResult && swapResult.output.gt(bestResult.output))) {
      const marketPrice = isBid
        ? orderbook.asks![0]!.limit_price
        : orderbook.bids![0]!.limit_price

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

  return bestResult
}