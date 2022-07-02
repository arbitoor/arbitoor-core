import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
import Big from 'big.js'
import { MainnetRpc } from 'near-workspaces'
import { InMemoryProvider } from '../../sdk/AccountProvider'
import { getDryRunSwap, getSpinMarkets, simulateSpinSwap } from '../../sdk/spin/spin-api'

test('estimate spin outputs', async t => {
  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  // Filter out NEAR based markets until a wrapping solution is found
  const spinMarkets = (await getSpinMarkets(MainnetRpc))

  const inMemoryProvider = new InMemoryProvider(MainnetRpc, tokenMap, spinMarkets)

  const amount = new Big('100000000')

  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.fetchPools()

  const orderbooks = inMemoryProvider.getSpinOrderbooks()
  for (const market of spinMarkets) {
    const orderbook = orderbooks.get(market.id)!

    const isBidArray = [true, false]
    for (const isBid of isBidArray) {
      const swapResult = simulateSpinSwap({
        orderbook,
        isBid,
        amount,
        baseDecimals: market.base.decimal
      })

      const priceLimit = isBid ? '4294967295' : '0'
      const token = isBid ? market.quote.address : market.base.address
      const dryRunResult = await getDryRunSwap({
        provider: MainnetRpc,
        marketId: market.id,
        price: priceLimit,
        token,
        amount: amount.toString()
      })

      const calculatedEstimate = swapResult?.outputAmount ?? new Big(0)
      const dryRunEstimate = new Big(dryRunResult.received)

      if (dryRunEstimate.eq(0)) {
        t.assert(calculatedEstimate.eq(0))
      } else {
        const percent = (dryRunEstimate.sub(calculatedEstimate)).abs().mul(100).div(dryRunEstimate)
        console.log('difference', percent.toString())
        t.assert(percent.lte(0.005))
      }
    }
  }
})
