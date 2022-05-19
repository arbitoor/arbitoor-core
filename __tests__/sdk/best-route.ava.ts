import test from 'ava'
import { MainnetRpc, TestnetRpc } from 'near-workspaces'

import { Comet } from '../../sdk/index'

test('best route', async () => {
  const comet = new Comet({
    provider: MainnetRpc,
    user: 'test.near',
    routeCacheDuration: 1000
  })


  await comet.computeRoutes({
    inputToken: 'wrap.near',
    outputToken: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near',
    inputAmount: '10000',
    slippage: 5
  })
})
