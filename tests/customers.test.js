const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { accountKey, signAccessToken } = require('../netlify/functions/lib/auth');
const aliceAccount = { verified: true, email: 'a@example.com', fullName: 'Alice', username: 'alice', phone: '09123456789', address: 'Naga', passwordHash: 'private' };
const stores = {
  'kingpin-auth': {
    [accountKey('a@example.com')]: { ...aliceAccount },
    [accountKey('b@example.com')]: { verified: true, email: 'b@example.com', fullName: 'Bob' },
    [accountKey('c@example.com')]: { verified: false, email: 'c@example.com' },
    [accountKey('old@example.com')]: { verified: true, archived: true, email: 'old@example.com', fullName: 'Old Name', movedTo: 'b@example.com' }
  },
  'kingpin-orders': { orders: [{ id: 1, customerEmail: 'A@example.com' }] },
  'kingpin-order-index': { 'all-order-ids': [1, 2, 3], 'order-1': { id: 1, customerEmail: 'a@example.com' }, 'order-2': { id: 2, customerEmail: 'a@example.com', status: 'completed' }, 'order-3': { id: 3, customerEmail: 'b@example.com', placedByEmail: 'old@example.com' } },
  'kingpin-carts': { [accountKey('a@example.com')]: [{ id: 5, quantity: 1, price: 100 }] }
};
const modulePath = require.resolve('@netlify/blobs');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
  connectLambda() {},
  getStore(name) {
    if (!stores[name]) stores[name] = {};
    const data = stores[name];
    return {
      async get(key) { return data[key] || null; },
      async setJSON(key, value) { data[key] = value; },
      async delete(key) { delete data[key]; },
      async list({ prefix }) { return { blobs: Object.keys(data).filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
    };
  }
} };
const { handler } = require('../netlify/functions/customers');
(async () => {
  const request = token => ({ httpMethod: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} });
  const post = (token, body) => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const customerToken = signAccessToken({ sub: 'a@example.com', role: 'customer' });
  const list = async () => JSON.parse((await handler(request(adminToken))).body).customers;
  const find = async accountEmail => (await list()).find(customer => customer.accountEmail === accountEmail);

  assert.strictEqual((await handler(request())).statusCode, 401);
  assert.strictEqual((await handler(request(customerToken))).statusCode, 403);
  const result = await handler(request(adminToken));
  assert.strictEqual(result.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(result.body).customers, [
    { name: 'Alice', email: 'a@example.com', phone: '09123456789', username: 'alice', address: 'Naga', accountEmail: 'a@example.com', totalOrders: 2, status: 'active', movedTo: '', adminEdited: false },
    { name: 'Bob', email: 'b@example.com', phone: '', username: '', address: '', accountEmail: 'b@example.com', totalOrders: 0, status: 'active', movedTo: '', adminEdited: false },
    { name: 'Old Name', email: 'old@example.com', phone: '', username: '', address: '', accountEmail: 'old@example.com', totalOrders: 1, status: 'old-email', movedTo: 'b@example.com', adminEdited: false }
  ]);

  // Only an admin can edit, reset or delete.
  for (const action of ['update', 'reset', 'delete']) {
    assert.strictEqual((await handler(post(customerToken, { action, email: 'a@example.com', fullName: 'X' }))).statusCode, 403);
  }

  // Admin edits name and Gmail: saved for the admin list only.
  const edited = await handler(post(adminToken, { action: 'update', email: 'a@example.com', fullName: 'Alice (VIP)', newEmail: 'alice.label@gmail.com' }));
  assert.strictEqual(edited.statusCode, 200);
  assert.deepStrictEqual(await find('a@example.com'), {
    name: 'Alice (VIP)', email: 'alice.label@gmail.com', phone: '09123456789', username: 'alice', address: 'Naga',
    accountEmail: 'a@example.com', totalOrders: 2, status: 'active', movedTo: '', adminEdited: true,
    original: { name: 'Alice', email: 'a@example.com', phone: '09123456789', address: 'Naga' }
  });
  // The customer's account, orders and cart are untouched.
  assert.deepStrictEqual(stores['kingpin-auth'][accountKey('a@example.com')], aliceAccount);
  assert.strictEqual(stores['kingpin-auth'][accountKey('alice.label@gmail.com')], undefined);
  assert.strictEqual(stores['kingpin-order-index']['order-2'].customerEmail, 'a@example.com');
  assert.strictEqual(stores['kingpin-order-index']['order-2'].placedByEmail, undefined);
  assert.deepStrictEqual(stores['kingpin-carts'][accountKey('a@example.com')], [{ id: 5, quantity: 1, price: 100 }]);

  // Later edits keep earlier ones; phone and address can be labelled too.
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'a@example.com', phone: '0999' }))).statusCode, 200);
  const alice = await find('a@example.com');
  assert.strictEqual(alice.name, 'Alice (VIP)');
  assert.strictEqual(alice.phone, '0999');
  assert.deepStrictEqual(stores['kingpin-auth'][accountKey('a@example.com')], aliceAccount);

  // Validation.
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'a@example.com', fullName: '' }))).statusCode, 400);
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'a@example.com', newEmail: 'not-an-email' }))).statusCode, 400);
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'missing@example.com', fullName: 'M' }))).statusCode, 404);

  // Setting the values back to the account's own details clears the label.
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'b@example.com', fullName: 'Bobby' }))).statusCode, 200);
  assert.strictEqual((await find('b@example.com')).adminEdited, true);
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'b@example.com', fullName: 'Bob' }))).statusCode, 200);
  assert.strictEqual((await find('b@example.com')).adminEdited, false);

  // Reset shows the real account details again.
  assert.strictEqual((await handler(post(adminToken, { action: 'reset', email: 'a@example.com' }))).statusCode, 200);
  const resetAlice = await find('a@example.com');
  assert.strictEqual(resetAlice.name, 'Alice');
  assert.strictEqual(resetAlice.email, 'a@example.com');
  assert.strictEqual(resetAlice.adminEdited, false);

  // Delete: account, cart and admin label are removed; orders stay as sales records.
  await handler(post(adminToken, { action: 'update', email: 'a@example.com', fullName: 'Label' }));
  const deleted = await handler(post(adminToken, { action: 'delete', email: 'a@example.com' }));
  assert.strictEqual(deleted.statusCode, 200);
  assert.strictEqual(stores['kingpin-auth'][accountKey('a@example.com')], undefined);
  assert.strictEqual(stores['kingpin-carts'][accountKey('a@example.com')], undefined);
  assert.strictEqual(stores['kingpin-customer-admin-edits'][accountKey('a@example.com')], undefined);
  assert.strictEqual(stores['kingpin-order-index']['order-2'].customerEmail, 'a@example.com');
  assert.deepStrictEqual((await list()).map(customer => customer.accountEmail), ['b@example.com', 'old@example.com']);
  assert.strictEqual((await handler(post(adminToken, { action: 'delete', email: 'a@example.com' }))).statusCode, 404);
  assert.strictEqual((await handler(post(adminToken, { action: 'unknown' }))).statusCode, 400);
  console.log('Customer list tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
