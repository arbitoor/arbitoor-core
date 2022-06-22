import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
import { MainnetRpc } from 'near-workspaces'
import { Comet, getRoutePath } from '../../sdk'
import { InMemoryProvider } from '../../sdk/AccountProvider'

test('best route', async () => {
  const user = 'test.near'

  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  const inMemoryProvider = new InMemoryProvider(MainnetRpc, tokenMap)

  const comet = new Comet({
    accountProvider: inMemoryProvider,
    user,
    routeCacheDuration: 1000
  })

  const inputToken = 'wrap.near'
  const outputToken = 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near'
  const inputAmount = '100000000000000000000000000'
  const slippageTolerance = 5

  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.ftFetchStorageBalance(outputToken, user)
  await inMemoryProvider.fetchPools()

  // just returns actions for one swap
  const routes = await comet.computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
    slippageTolerance
  })

  // console.log('outputs', routes.map(route => {
  //   return {
  //     output: route.output.toString(),
  //     path: getRoutePath(route.actions, tokenList)
  //   }
  // }))
})
