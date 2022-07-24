import { test } from './helper'
import Big from 'big.js'
import { getRoutePath, Currency } from '../../sdk'
import { WRAPPED_NEAR } from '../../sdk/constants'

test('wrap NEAR', async t => {
  const { inMemoryProvider, arbitoor } = t.context

  const inputToken: Currency = {
    type: 'near'
  }
  const outputToken: Currency = {
    type: 'ft',
    accountId: 'wrap.near'
  }

  const inputAmount = new Big(10).pow(24).mul(100).toString()
  const slippageTolerance = 5
  // Poll for pools and storage. If storage is set, then storage polling can be stopped.
  await inMemoryProvider.ftFetchStorageBalance(outputToken.accountId, arbitoor.user)

  const routes = await arbitoor.computeRoutes({
    inputToken,
    outputToken,
    inputAmount
  })

  t.is(routes.length, 1)

  const wrapRoute = routes[0]!
  t.deepEqual(wrapRoute, {
    dex: WRAPPED_NEAR,
    wrap: true,
    output: new Big(inputAmount)
  })

  const path = getRoutePath(wrapRoute)
  t.deepEqual(path, [{
    dex: WRAPPED_NEAR,
    tokens: [{
      type: 'near'
    }, {
      type: 'ft',
      accountId: WRAPPED_NEAR
    }],
    percentage: '100'
  }])

  const txs = await arbitoor.generateTransactions({
    routeInfo: wrapRoute,
    slippageTolerance
  })

  t.is(txs.length, 2)
})

test('unwrap NEAR', async t => {
  const { arbitoor } = t.context

  const inputToken: Currency = {
    type: 'ft',
    accountId: 'wrap.near'
  }
  const outputToken: Currency = {
    type: 'near'
  }

  const inputAmount = new Big(10).pow(24).mul(100).toString()
  const slippageTolerance = 5

  // Not possible to fetch storage balance of native NEAR, so skip this step
  // await inMemoryProvider.ftFetchStorageBalance(outputToken.accountId, arbitoor.user)

  const routes = await arbitoor.computeRoutes({
    inputToken,
    outputToken,
    inputAmount
  })

  t.is(routes.length, 1)

  const unwrapRoute = routes[0]!
  t.deepEqual(unwrapRoute, {
    dex: WRAPPED_NEAR,
    wrap: false,
    output: new Big(inputAmount)
  })

  const path = getRoutePath(unwrapRoute)
  t.deepEqual(path, [{
    dex: WRAPPED_NEAR,
    tokens: [{
      type: 'ft',
      accountId: WRAPPED_NEAR
    }, {
      type: 'near'
    }],
    percentage: '100'
  }])

  const txs = await arbitoor.generateTransactions({
    routeInfo: unwrapRoute,
    slippageTolerance
  })

  t.is(txs.length, 1)
})

test('ft to ft trade', async t => {
  const { inMemoryProvider, arbitoor } = t.context

  const inputToken: Currency = {
    type: 'ft',
    accountId: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near'
  }
  const outputToken: Currency = {
    type: 'ft',
    accountId: 'meta-pool.near'
  }

  const inputAmount = new Big(10).pow(
    (await inMemoryProvider.getTokenMetadata(inputToken.accountId)
  )!.decimals).mul(10).toString()

  const slippageTolerance = 5

  await inMemoryProvider.ftFetchStorageBalance(outputToken.accountId, arbitoor.user)

  const routes = await arbitoor.computeRoutes({
    inputToken,
    outputToken,
    inputAmount
  })

  for (const route of routes) {
    console.log('dex', route.dex, 'output', route.output.toString())
    const txs = await arbitoor.generateTransactions({
      routeInfo: route,
      slippageTolerance
    })
    console.log('txs', JSON.stringify(txs, undefined, 4))

    const path = getRoutePath(route)
    console.log('path', JSON.stringify(path, undefined, 4))
  }
})
