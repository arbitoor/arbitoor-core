import test from 'ava'
import { MainnetRpc } from 'near-workspaces'
import { Comet, ftGetTokenMetadata } from '../../sdk'
import { getExpectedOutputFromActions } from '../../sdk/smartRouteLogic'

test('best route', async () => {
  const comet = new Comet({
    provider: MainnetRpc,
    user: 'test.near',
    routeCacheDuration: 1000
  })

  const inputToken = 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near'
  const outputToken = 'wrap.near'
  const inputAmount = '100000000'

  // just returns actions for one swap
  const actions = await comet.computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
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
    outputToken,
    5
  )
  const jumboOutput = await getExpectedOutputFromActions(
    actions.jumbo,
    outputToken,
    5
  )

  console.log('output', refOutput.toString(), jumboOutput.toString())

  const tokenInMetadata = await ftGetTokenMetadata(MainnetRpc, inputToken)
  const tokenOutMetadata = await ftGetTokenMetadata(MainnetRpc, outputToken)

  const refTxs = await comet.nearInstantSwap({
    exchange: 'v2.ref-finance.near',
    tokenIn: tokenInMetadata,
    tokenOut: tokenOutMetadata,
    amountIn: inputAmount,
    swapsToDo: actions.ref,
    slippageTolerance: 5
  })
  const jumboTxs = await comet.nearInstantSwap({
    exchange: 'v1.jumbo-exchange.near',
    tokenIn: tokenInMetadata,
    tokenOut: tokenOutMetadata,
    amountIn: inputAmount,
    swapsToDo: actions.jumbo,
    slippageTolerance: 5
  })

  console.log('REF txs', JSON.stringify(refTxs))
  console.log('jumbo txs', JSON.stringify(jumboTxs))
})
