import { Worker, MainnetRpc } from 'near-workspaces'
import anyTest, { TestFn } from 'ava'
import { TokenListProvider, TokenInfo } from '@tonic-foundation/token-list'
import { InMemoryProvider, Arbitoor } from '../../sdk'

export const test = anyTest as TestFn<{
  worker: Worker
  arbitoor: Arbitoor
  inMemoryProvider: InMemoryProvider
}>

test.before(async t => {
  // Init the worker and start a Sandbox server
  const worker = await Worker.init()

  const user = 'test.near'

  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  const inMemoryProvider = new InMemoryProvider(MainnetRpc, tokenMap)
  await inMemoryProvider.fetchPools()

  const arbitoor = new Arbitoor({
    accountProvider: inMemoryProvider,
    user
  })

  // Save state for test runs, it is unique for each test
  t.context.worker = worker
  t.context.arbitoor = arbitoor
  t.context.inMemoryProvider = inMemoryProvider
})
