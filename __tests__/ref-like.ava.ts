// Tests for DEXes with REF-like API
import { test } from './helper'
import { RefExchange } from './ref-utils'
import { Token } from './token-utils'

test('One leg swap', async t => {
  const { alice } = t.context.accounts

  // Deploy token contracts
  const token0 = await Token.deploy('token0', alice)
  const token1 = await Token.deploy('token1', alice)

  // Mint tokens
  await token0.mint(alice, 10000n).transact()
  await token1.mint(alice, 10000n).transact()

  // Deploy REF
  const ref = await RefExchange.deploy('ref', alice)

  // Create a pool and add liquidity
  await ref.setupPool(alice, token0, token1)
})

test('Two leg swap', async t => {
  const { alice } = t.context.accounts

  // Deploy token contracts
  const token0 = await Token.deploy('token0', alice)
  const token1 = await Token.deploy('token1', alice)
  const token2 = await Token.deploy('token2', alice)

  // Mint tokens
  await token0.mint(alice, 10000n).transact()
  await token1.mint(alice, 10000n).transact()
  await token2.mint(alice, 10000n).transact()

  // Deploy exchanges
  const ref = await RefExchange.deploy('ref', alice)
  const jumbo = await RefExchange.deploy('jumbo', alice)

  // Create pools and add liquidity
  await ref.setupPool(alice, token0, token1)
  await jumbo.setupPool(alice, token1, token2)
})
