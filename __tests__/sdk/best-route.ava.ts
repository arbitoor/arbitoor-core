import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
import Big from 'big.js'
import { MainnetRpc } from 'near-workspaces'
import { Arbitoor, getRoutePath } from '../../sdk'
import { InMemoryProvider } from '../../sdk/AccountProvider'

test('best route', async t => {
  const user = 'test.near'

  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  const inMemoryProvider = new InMemoryProvider(MainnetRpc, tokenMap)

  const arbitoor = new Arbitoor({
    accountProvider: inMemoryProvider,
    user
  })

  // USDT->USN is being routed as USDT->USDC->USN on Ref, giving worse rate
  const inputToken = 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near'
  // 'aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near'
  const outputToken = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'
  const inputAmount = new Big(10).pow(tokenMap.get(inputToken)!.decimals).mul(150).toString()

  const slippageTolerance = 5

  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.ftFetchStorageBalance(outputToken, user)
  await inMemoryProvider.fetchPools()

  // just returns actions for one swap
  const routes = await arbitoor.computeRoutes({
    inputToken,
    outputToken,
    inputAmount
  })

  for (const route of routes) {
    console.log('dex', route.dex, 'output', route.output.toString())
    const txs = await arbitoor.generateTransactions({
      routeInfo: route,
      slippageTolerance
    })
    console.log('txs', JSON.stringify(txs, undefined, 4))

    const path = getRoutePath(route)
    console.log('path', JSON.stringify(path, undefined, 4))
  }
})
