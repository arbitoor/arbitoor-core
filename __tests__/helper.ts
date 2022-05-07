import { Worker, NEAR, NearAccount } from 'near-workspaces'
import anyTest, { TestFn } from 'ava'

export const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>

test.beforeEach(async t => {
  // Init the worker and start a Sandbox server
  const worker = await Worker.init()

  // Prepare sandbox for tests, create accounts, deploy contracts, etx.
  const root = worker.rootAccount
  const comet = await root.createAndDeploy(
    root.getSubAccount('comet').accountId,
    'compiled_contracts/comet.wasm'
  )
  const alice = await root.createSubAccount('alice', { initialBalance: NEAR.parse('10000 N').toJSON() })

  // Save state for test runs, it is unique for each test
  t.context.worker = worker
  t.context.accounts = { root, comet, alice }
})

test.afterEach(async t => {
  // Stop Sandbox server
  await t.context.worker.tearDown().catch(error => {
    console.log('Failed to stop the Sandbox:', error)
  })
})
