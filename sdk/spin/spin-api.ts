import { CodeResult, Provider } from "near-workspaces"
import { Market as SpinMarket, GetOrderbookResponse as SpinOrderbook } from '@spinfi/core'
import { SPIN } from "../constants"
import { AccountProvider } from "../AccountProvider"
import Big from "big.js"

export async function getSpinMarkets(provider: Provider): Promise<SpinMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'get_markets',
    args_base64: '',
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinMarket[]
}

export async function getDryRunSwap({
  provider,
  marketId,
  price,
  token,
  amount,
} : {
  provider: Provider,
  marketId: number,
  price: string,
  token: string,
  amount: string
}): Promise<SpinMarket[]> {
  const res = await provider.query<CodeResult>({
    request_type: 'call_function',
    account_id: SPIN,
    method_name: 'dry_run_swap',
    args_base64: Buffer.from(JSON.stringify({
      swap: {
        market_id: marketId,
        price,
      },
      token,
      amount,
     })).toString('base64'),
    finality: 'optimistic'
  })
  return JSON.parse(Buffer.from(res.result).toString()) as SpinMarket[]
}

export async function getSpinOrderbook(
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

export async function getSpinOutput({
  provider,
  inputToken,
  outputToken,
  amount,
  slippageTolerance,
}: {
  provider: AccountProvider,
  inputToken: string,
  outputToken: string,
  amount: Big,
  slippageTolerance: number,
}) {
  const markets = provider.getSpinMarkets()
  const orderbooks = provider.getSpinOrderbooks()
  const validMarkets = markets.filter(market => {
    return (market.base.address === inputToken && market.quote.address === outputToken)
      || (market.base.address === outputToken && market.quote.address === inputToken)
  })

  for (const market of validMarkets) {
    // estimate output from cached orderbooks
    const orderbook = orderbooks.get(market.id)!
    const isBid = market.base.address === outputToken

    const swapResult = simulateSwap(orderbook, isBid, amount)
    console.log('swap result', swapResult?.outputAmount.toString())
  }
}

function simulateSwap(orderbook: SpinOrderbook, isBid: boolean, amount: Big) {
  const ordersToTraverse = isBid ? orderbook.ask_orders : orderbook.bid_orders

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
      const orderQuantity = remainingAmount.div(price)
      if (quantity.gte(orderQuantity)) {
        // order is filled, stop traversal
        remainingAmount = new Big(0)
        outputAmount = outputAmount.add(orderQuantity)
        break
      } else {
        // use all available quanitity at this step, then move to the next
        remainingAmount = remainingAmount.sub(quantity.mul(price))
        outputAmount = outputAmount.add(quantity)
      }
    } else {
      // Asks are matched against bids. Both values are in base currency, but output needs to be in quote.
      // Multiply output with price at each level to get in terms of quote.
      if (quantity.gte(remainingAmount)) {
        remainingAmount = new Big(0)
        outputAmount = outputAmount.add(remainingAmount.mul(price))
        break
      } else {
        remainingAmount = remainingAmount.sub(quantity)
        outputAmount = quantity.mul(price)
      }
    }
  }
  return { outputAmount, remainingAmount, price: price! }
}