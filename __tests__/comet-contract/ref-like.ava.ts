// Tests for DEXes with REF-like API
import { tGas } from 'near-workspaces'
import { test } from './helper'
import { RefExchange } from './ref-utils'
import { Token } from './token-utils'

test('One leg swap', async t => {
  // const alice = t.context.accounts.alice!
  // const comet = t.context.accounts.comet!

  // // Deploy token contracts
  // const token0 = await Token.deploy('token0', alice)
  // const token1 = await Token.deploy('token1', alice)

  // // Mint tokens
  // await token0.mint(alice, '10000').transact()
  // await token1.mint(alice, '10000').transact()

  // // Deploy REF
  // const ref = await RefExchange.deploy('ref', alice)

  // // Create a pool and add liquidity
  // await ref.setupPool(alice, token0, token1)

  // // Setup storage for Comet on token and DEX contracts
  // await token0.addStorage(comet).transact()
  // await token1.addStorage(comet).transact()
  // await ref.addStorage(comet).transact()

  // const swapResp = await alice.batch(token0.address).functionCall('ft_transfer_call', {
  //   receiver_id: comet.accountId,
  //   amount: '100',
  //   msg: JSON.stringify({
  //     referral_id: alice.accountId,
  //     routes: [{
  //       dex: ref.address.accountId,
  //       token_in: token0.address.accountId,
  //       actions: [{
  //         pool_id: 0,
  //         token_in: token0.address.accountId,
  //         token_out: token1.address.accountId,
  //         amount_in: '100',
  //         min_amount_out: '0'
  //       }]
  //     }]
  //   })
  // }, {
  //   attachedDeposit: '1',
  //   gas: tGas(300)
  // }).transact()

  // t.log('logs', swapResp.logs)
  // t.log('reciept failures', JSON.stringify(swapResp.receiptFailures))

  // t.deepEqual(await token0.balance(alice.accountId), String(10000 - 1000 - 100))
  // t.deepEqual(await token1.balance(alice.accountId), String(10000 - 1000 + 90))
  // t.deepEqual(await token0.balance(ref.address.accountId), String(1000 + 100))
  // t.deepEqual(await token1.balance(ref.address.accountId), String(1000 - 90))
})

// complete test
// test('tokens are returned in a failed one leg swap', async t => {
//   const alice = t.context.accounts.alice!
//   const comet = t.context.accounts.comet!

//   // Deploy token contracts
//   const token0 = await Token.deploy('token0', alice)
//   const token1 = await Token.deploy('token1', alice)

//   // Mint tokens
//   await token0.mint(alice, '10000').transact()
//   await token1.mint(alice, '10000').transact()

//   // Deploy REF
//   const ref = await RefExchange.deploy('ref', alice)

//   // Create a pool and add liquidity
//   await ref.setupPool(alice, token0, token1)

//   // Setup storage for Comet on token and DEX contracts
//   await token0.addStorage(comet).transact()
//   await token1.addStorage(comet).transact()
//   await ref.addStorage(comet).transact()

//   const swapResp = await alice.batch(token0.address).functionCall('ft_transfer_call', {
//     receiver_id: comet.accountId,
//     amount: '100',
//     msg: JSON.stringify({
//       referral_id: alice.accountId,
//       routes: [{
//         dex: ref.address.accountId,
//         token_in: token0.address.accountId,
//         actions: [{
//           pool_id: 0,
//           token_in: token0.address.accountId,
//           token_out: token1.address.accountId,
//           amount_in: '100',
//           min_amount_out: '110' // too high, makes tx fail
//         }]
//       }]
//     })
//   }, {
//     attachedDeposit: '1',
//     gas: tGas(300)
//   }).transact()

//   t.log('logs', swapResp.logs)
//   t.log('reciept failures', JSON.stringify(swapResp.receiptFailures))

//   t.deepEqual(await token0.balance(alice.accountId), String(10000 - 1000))
//   t.deepEqual(await token1.balance(alice.accountId), String(10000 - 1000))
//   t.deepEqual(await token0.balance(ref.address.accountId), String(1000))
//   t.deepEqual(await token1.balance(ref.address.accountId), String(1000))
// })

// test('Two leg swap', async t => {
//   const { alice } = t.context.accounts

//   // Deploy token contracts
//   const token0 = await Token.deploy('token0', alice)
//   const token1 = await Token.deploy('token1', alice)
//   const token2 = await Token.deploy('token2', alice)

//   // Mint tokens
//   await token0.mint(alice, 10000n).transact()
//   await token1.mint(alice, 10000n).transact()
//   await token2.mint(alice, 10000n).transact()

//   // Deploy exchanges
//   const ref = await RefExchange.deploy('ref', alice)
//   const jumbo = await RefExchange.deploy('jumbo', alice)

//   // Create pools and add liquidity
//   await ref.setupPool(alice, token0, token1)
//   await jumbo.setupPool(alice, token1, token2)
// })
