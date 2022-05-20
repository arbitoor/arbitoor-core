import test from 'ava'
import { MainnetRpc, TestnetRpc } from 'near-workspaces'
import { WalletConnection, Near } from 'near-api-js'
import { Comet } from '../../sdk/index'

test('best route', async () => {
  const comet = new Comet({
    provider: MainnetRpc,
    user: 'test.near',
    routeCacheDuration: 1000
  })


  await comet.computeRoutes({
    inputToken: 'token.skyward.near',
    outputToken: 'wrap.near',
    inputAmount: '10000',
    slippage: 5
  })
})
