import test from 'ava'
import { MainnetRpc, TestnetRpc } from 'near-workspaces'
import { WalletConnection, Near } from 'near-api-js'
import { Comet } from '../../sdk/index'
import { getExpectedOutputFromActions } from '../../sdk/smartRouteLogic'

test('best route', async () => {
  const comet = new Comet({
    provider: MainnetRpc,
    user: 'test.near',
    routeCacheDuration: 1000
  })

  const actions = await comet.computeRoutes({
    inputToken: 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near',
    outputToken: 'wrap.near',
    inputAmount: '100000000',
    slippage: 5
  })
  console.log('actions', actions.map(route => {
    return {
      estimate: route.estimate,
      inputToken: route.inputToken,
      outputToken: route.outputToken
    }
  }))

  const output = await getExpectedOutputFromActions(
    actions,
    'wrap.near',
    5
  )
  console.log('output', output.toString())
})
