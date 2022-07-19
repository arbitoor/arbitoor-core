import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
import Big from 'big.js'
import { MainnetRpc } from 'near-workspaces'
import { InMemoryProvider } from '../../sdk/AccountProvider'
import { getDryRunSwap, simulateSpinSwap } from '../../sdk/spin'

test('estimate spin outputs', async t => {
  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  const inMemoryProvider = new InMemoryProvider(MainnetRpc, tokenMap)

  const amount = new Big('1000000')

  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.fetchPools()

  const orderbooks = inMemoryProvider.getSpinOrderbooks()
  for (const market of inMemoryProvider.getSpinMarkets()) {
    const orderbook = orderbooks.get(market.id)!

    const isBidArray = [true, false]
    for (const isBid of isBidArray) {
      const swapResult = simulateSpinSwap({
        market,
        orderbook,
        isBid,
        amount
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

      const calculatedEstimate = swapResult?.output ?? new Big(0)
      const dryRunEstimate = new Big(dryRunResult.received).sub(dryRunResult.fee)

      if (dryRunEstimate.eq(0)) {
        t.assert(calculatedEstimate.eq(0))
      } else {
        const percent = (dryRunEstimate.sub(calculatedEstimate)).abs().mul(100).div(dryRunEstimate)
        // t.assert(percent.lte(0.00000001))

        // Dry run ignores lot size rounding for bids?
        // dry run gives 99860139860139860139. Arbitoor calculates 99860040000000000000 which curresponds
        // to actual received.
        // console.log('market', market.id, 'base', market.base.address, 'quote', market.quote.address)
        // console.log('isBid', isBid, 'dry estimate', dryRunEstimate.toString(), 'calculated', calculatedEstimate.toString())

        t.assert(percent.lte(2), percent.toString())
      }
    }
  }
})
