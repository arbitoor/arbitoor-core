import test from 'ava'
import { MainnetRpc } from 'near-workspaces'
import { Comet } from '../../sdk/index'
import { getExpectedOutputFromActions } from '../../sdk/smartRouteLogic'

test('best route', async () => {
  const comet = new Comet({
    provider: MainnetRpc,
    user: 'test.near',
    routeCacheDuration: 1000
  })

  // just returns actions for one swap
  const actions = await comet.computeRoutes({
    inputToken: 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near',
    outputToken: 'wrap.near',
    inputAmount: '100000000',
    slippage: 5
  })
  console.log('actions', actions.jumbo.map(route => {
    return {
      estimate: route.estimate,
      inputToken: route.inputToken,
      outputToken: route.outputToken,
      pool: route.pool
    }
  }))

  const refOutput = await getExpectedOutputFromActions(
    actions.ref,
    'wrap.near',
    5
  )
  const jumboOutput = await getExpectedOutputFromActions(
    actions.jumbo,
    'wrap.near',
    5
  )

  console.log('output', refOutput.toString(), jumboOutput.toString())
})
