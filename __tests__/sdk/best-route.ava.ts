import { TokenInfo, TokenListProvider } from '@tonic-foundation/token-list'
import test from 'ava'
import { MainnetRpc } from 'near-workspaces'
import { Comet } from '../../sdk'
import { InMemoryProvider } from '../../sdk/AccountProvider'
import { getExpectedOutputFromActions } from '../../sdk/smartRouteLogic'

test('best route', async () => {
  const user = 'test.near'

  const tokens = await new TokenListProvider().resolve()
  const tokenList = tokens.filterByNearEnv('mainnet').getList()
  const tokenMap = tokenList.reduce((map, item) => {
    map.set(item.address, item)
    return map
  }, new Map<string, TokenInfo>())

  const inMemoryProvider = new InMemoryProvider(MainnetRpc)

  const comet = new Comet({
    provider: MainnetRpc,
    accountProvider: inMemoryProvider,
    tokenMap,
    user,
    routeCacheDuration: 1000
  })

  const inputToken = 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'
  const outputToken = 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near'
  const inputAmount = '1000000'
  const tokenInDecimals = 6
  const tokenOutDecimals = 6

  // Fetch storage details of output token
  await inMemoryProvider.ftFetchStorageBalance(outputToken, user)

  // Fetch all pools

  // just returns actions for one swap
  const actions = await comet.computeRoutes({
    inputToken,
    outputToken,
    inputAmount
  })

  const refOutput = getExpectedOutputFromActions(
    actions.ref,
    outputToken,
    5
  )
  const jumboOutput = getExpectedOutputFromActions(
    actions.jumbo,
    outputToken,
    5
  )
  console.log('output', refOutput.toString(), jumboOutput.toString())

  const refTxs = comet.nearInstantSwap({
    exchange: 'v2.ref-finance.near',
    tokenIn: inputToken,
    tokenOut: outputToken,

    // Decimals can be found inside the SDK via token list
    tokenInDecimals,
    tokenOutDecimals,
    amountIn: inputAmount,
    swapsToDo: actions.ref,
    slippageTolerance: 5
  })
  const jumboTxs = comet.nearInstantSwap({
    exchange: 'v1.jumbo_exchange.near',
    tokenIn: inputToken,
    tokenOut: outputToken,
    tokenInDecimals,
    tokenOutDecimals,
    amountIn: inputAmount,
    swapsToDo: actions.jumbo,
    slippageTolerance: 5
  })

  console.log('REF txs', JSON.stringify(refTxs))
  console.log('jumbo txs', JSON.stringify(jumboTxs))
})
