// Tests for DEXes with REF-like API
import { test } from './helper'
import { Token } from './token-utils'

test('One leg swap', async t => {
  const { alice } = t.context.accounts

  // Deploy token contracts
  const token0 = await Token.deploy('token0', alice)
  const token1 = await Token.deploy('token1', alice)

  // Mint tokens
  await token0.mint(alice, 10000n).transact()
  await token1.mint(alice, 10000n).transact()

  t.log('gg')
})

test('Two leg swap', async t => {
  t.log('gg')
})
