import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
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
    user,
    routeCacheDuration: 1000
  })

  const inputToken = 'wrap.near'
  const outputToken = 'usn'
  const inputAmount = '100000000000000000000000000'
  const slippageTolerance = 5

  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.ftFetchStorageBalance(outputToken, user)
  await inMemoryProvider.fetchPools()

  // just returns actions for one swap
  const routes = await arbitoor.computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippageTolerance
  })

  t.log('outputs', routes.map(route => {
    const path = getRoutePath(route.view)

    return {
      output: route.output.toString(),
      path: JSON.stringify(path.map(p => p.tokens), undefined, 4),
      // pools: JSON.stringify(path[0]?.pools, undefined, 4),
      // pools2: JSON.stringify(path[1]?.pools, undefined, 4),
    }
  }))

})
