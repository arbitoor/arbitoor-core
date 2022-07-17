import { Provider, CodeResult } from 'near-workspaces'
import { SPIN, TONIC } from '../constants'
import { MarketViewV1, OrderbookViewV1 as TonicOrderbook } from '@tonic-foundation/tonic/lib/types/v1'
import Big from 'big.js'
import { AccountProvider } from '../AccountProvider'
import { OrderbookEstimate } from '../spin'

// Fields returned by RPC but missing in Tonic SDK
export interface TonicMarket extends MarketViewV1 {
  state: 'Active' | 'Uninitialized',
}

export async function getTonicMarkets (
  provider: Provider,
  fromIndex: number = 0,
  limit: number = 100
): Promise<TonicMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: TONIC,
    method_name: 'list_markets',
    args_base64: Buffer.from(JSON.stringify({
      from_index: fromIndex,
      limit
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

export interface TonicRouteInfo extends OrderbookEstimate {
  dex: string;
  market: TonicMarket;
  inputToken: string;
  outputToken: string;
  inputAmount: Big;
  marketPrice: Big;
  isBid: boolean;
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
  const validMarkets = markets.filter(({ base_token, quote_token }) => {
    // Disable native NEAR markets until wrapping is resolved
    return (base_token.token_type.type === 'ft' && quote_token.token_type.type === 'ft') && (
      (base_token.token_type.account_id === inputToken && quote_token.token_type.account_id === outputToken) ||
        (base_token.token_type.account_id === outputToken && quote_token.token_type.account_id === inputToken)
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
      market,
      isBid,
      amount
    })
    if (!bestResult || (swapResult && swapResult.output.gt(bestResult.output))) {
      const marketPrice = isBid
        ? orderbook.asks![0]!.limit_price
        : orderbook.bids![0]!.limit_price

      bestResult = {
        ...swapResult!,
        dex: TONIC,
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
