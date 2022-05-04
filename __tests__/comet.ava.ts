import { Worker, NEAR, NearAccount } from 'near-workspaces';
import anyTest, { TestFn } from 'ava'

const test = anyTest as TestFn<{
  worker: Worker;
  accounts: Record<string, NearAccount>;
}>;

test.beforeEach(async t => {
  // Init the worker and start a Sandbox server
  const worker = await Worker.init();

  // Prepare sandbox for tests, create accounts, deploy contracts, etx.
  const root = worker.rootAccount;
  const contract = await root.createAndDeploy(
    root.getSubAccount('status-message').accountId,
    'compiled_contracts/status_message.wasm',
    { initialBalance: NEAR.parse('3 N').toJSON() },
  );
  const ali = await root.createSubAccount('ali', { initialBalance: NEAR.parse('3 N').toJSON() });

  // Save state for test runs, it is unique for each test
  t.context.worker = worker;
  t.context.accounts = { root, contract, ali };
});

test.afterEach(async t => {
  // Stop Sandbox server
  await t.context.worker.tearDown().catch(error => {
    console.log('Failed to stop the Sandbox:', error);
  });
});

test('Root gets null status', async t => {
  const { root, contract } = t.context.accounts;
  const result = await contract.view('get_status', { account_id: root.accountId });
  t.is(result, null);
  t.log('gg')
});

test('Ali sets then gets status', async t => {
  const { ali, contract } = t.context.accounts;
  await ali.call(contract, 'set_status', { message: 'hello' });
  const result = await contract.view('get_status', { account_id: ali });
  t.is(result, 'hello');
});

test('Root and Ali have different statuses', async t => {
  const { root, contract, ali } = t.context.accounts;
  await root.call(contract, 'set_status', { message: 'world' });
  const rootStatus = await contract.view('get_status', { account_id: root });
  t.is(rootStatus, 'world');
  const aliStatus = await contract.view('get_status', { account_id: ali });
  t.is(aliStatus, null);
});
