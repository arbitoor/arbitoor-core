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

  const inputToken = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'
  const outputToken = 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near'
  const inputAmount = "1000000"

  // just returns actions for one swap
  const actions = await comet.computeRoutes({
    inputToken,
    outputToken,
    inputAmount,
  })

  const refOutput = await getExpectedOutputFromActions(
    MainnetRpc,
    actions.ref,
    outputToken,
    5
  )
  const jumboOutput = await getExpectedOutputFromActions(
    MainnetRpc,
    actions.jumbo,
    outputToken,
    5
  )
  console.log('output', refOutput.toString(), jumboOutput.toString())

  const tokenInMetadata = await ftGetTokenMetadata(MainnetRpc, inputToken)
  const tokenOutMetadata = await ftGetTokenMetadata(MainnetRpc, outputToken)

  const refTxs = await comet.nearInstantSwap({
    exchange: 'v2.ref-finance.near',
    tokenIn: inputToken,
    tokenOut: outputToken,
    tokenInDecimals: tokenInMetadata.decimals,
    tokenOutDecimals: tokenOutMetadata.decimals,
    amountIn: inputAmount,
    swapsToDo: actions.ref,
    slippageTolerance: 5
  })
  const jumboTxs = await comet.nearInstantSwap({
    exchange: 'v1.jumbo_exchange.near',
    tokenIn: inputToken,
    tokenOut: outputToken,
    tokenInDecimals: tokenInMetadata.decimals,
    tokenOutDecimals: tokenOutMetadata.decimals,
    amountIn: inputAmount,
    swapsToDo: actions.jumbo,
    slippageTolerance: 5
  })

  console.log('REF txs', JSON.stringify(refTxs))
  console.log('jumbo txs', JSON.stringify(jumboTxs))
})
