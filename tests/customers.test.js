const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { accountKey, signAccessToken } = require('../netlify/functions/lib/auth');
const stores = {
  'kingpin-auth': {
    [accountKey('a@example.com')]: { verified: true, email: 'a@example.com', fullName: 'Alice', phone: '09123456789', passwordHash: 'private' },
    [accountKey('b@example.com')]: { verified: true, email: 'b@example.com', fullName: 'Bob' },
    [accountKey('c@example.com')]: { verified: false, email: 'c@example.com' }
  },
  'kingpin-orders': { orders: [{ id: 1, customerEmail: 'A@example.com' }] },
  'kingpin-order-index': { 'all-order-ids': [1, 2], 'order-1': { id: 1, customerEmail: 'a@example.com' }, 'order-2': { id: 2, customerEmail: 'a@example.com', status: 'completed' } },
  'kingpin-carts': { [accountKey('a@example.com')]: [{ id: 5, quantity: 1, price: 100 }] },
  'kingpin-customer-service': { 'message-1': { id: '1', ownerSub: 'a@example.com', customerEmail: 'a@example.com' } }
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

  assert.strictEqual((await handler(request())).statusCode, 401);
  assert.strictEqual((await handler(request(customerToken))).statusCode, 403);
  const result = await handler(request(adminToken));
  assert.strictEqual(result.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(result.body).customers, [
    { name: 'Alice', email: 'a@example.com', phone: '09123456789', username: '', address: '', totalOrders: 2, status: 'active', movedTo: '' },
    { name: 'Bob', email: 'b@example.com', phone: '', username: '', address: '', totalOrders: 0, status: 'active', movedTo: '' }
  ]);

  // Only an admin can edit or delete.
  assert.strictEqual((await handler(post(customerToken, { action: 'delete', email: 'b@example.com' }))).statusCode, 403);
  assert.strictEqual((await handler(post(customerToken, { action: 'update', email: 'a@example.com', fullName: 'X', username: 'xxx' }))).statusCode, 403);

  // Edit profile fields.
  const edited = await handler(post(adminToken, { action: 'update', email: 'b@example.com', fullName: 'Bob Santos', username: 'bobs', phone: '0917', address: 'Naga City' }));
  assert.strictEqual(edited.statusCode, 200);
  assert.deepStrictEqual((await list()).find(customer => customer.email === 'b@example.com'),
    { name: 'Bob Santos', email: 'b@example.com', phone: '0917', username: 'bobs', address: 'Naga City', totalOrders: 0, status: 'active', movedTo: '' });
  assert.strictEqual(stores['kingpin-auth'][accountKey('b@example.com')].passwordHash, undefined);
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'b@example.com', fullName: '', username: 'bobs' }))).statusCode, 400);
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'missing@example.com', fullName: 'M', username: 'mmm' }))).statusCode, 404);

  // Name-only edit from the list keeps the other details.
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'b@example.com', fullName: 'Roberto Santos' }))).statusCode, 200);
  assert.deepStrictEqual((await list()).find(customer => customer.email === 'b@example.com'),
    { name: 'Roberto Santos', email: 'b@example.com', phone: '0917', username: 'bobs', address: 'Naga City', totalOrders: 0, status: 'active', movedTo: '' });

  // Edit email: the old email stays in the list with its old name and orders;
  // the new email is a new entry with the edited details and the login.
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'a@example.com', newEmail: 'b@example.com', fullName: 'Alice', username: 'alice' }))).statusCode, 409);
  const moved = await handler(post(adminToken, { action: 'update', email: 'a@example.com', newEmail: 'Alice.New@Gmail.com', fullName: 'Alice Cruz', username: 'alice', phone: '09123456789', address: '' }));
  assert.strictEqual(moved.statusCode, 200);
  const alice = stores['kingpin-auth'][accountKey('alice.new@gmail.com')];
  assert.strictEqual(alice.email, 'alice.new@gmail.com');
  assert.strictEqual(alice.fullName, 'Alice Cruz');
  assert.strictEqual(alice.passwordHash, 'private');
  assert.deepStrictEqual(alice.previousEmails, ['a@example.com']);
  const oldAlice = stores['kingpin-auth'][accountKey('a@example.com')];
  assert.strictEqual(oldAlice.archived, true);
  assert.strictEqual(oldAlice.fullName, 'Alice');
  assert.strictEqual(oldAlice.passwordHash, undefined);
  assert.strictEqual(stores['kingpin-order-index']['order-2'].customerEmail, 'alice.new@gmail.com');
  assert.strictEqual(stores['kingpin-order-index']['order-2'].placedByEmail, 'a@example.com');
  assert.deepStrictEqual(stores['kingpin-carts'][accountKey('alice.new@gmail.com')], [{ id: 5, quantity: 1, price: 100 }]);
  assert.strictEqual(stores['kingpin-customer-service']['message-1'].ownerSub, 'alice.new@gmail.com');
  const afterMove = await list();
  assert.deepStrictEqual(afterMove.find(customer => customer.email === 'a@example.com'),
    { name: 'Alice', email: 'a@example.com', phone: '09123456789', username: '', address: '', totalOrders: 2, status: 'old-email', movedTo: 'alice.new@gmail.com' });
  assert.deepStrictEqual(afterMove.find(customer => customer.email === 'alice.new@gmail.com'),
    { name: 'Alice Cruz', email: 'alice.new@gmail.com', phone: '09123456789', username: 'alice', address: '', totalOrders: 0, status: 'active', movedTo: '' });
  assert.strictEqual((await handler(post(adminToken, { action: 'update', email: 'a@example.com', fullName: 'X', username: 'xxx' }))).statusCode, 409);

  // A new order after the change counts toward the new entry.
  stores['kingpin-order-index']['all-order-ids'].push(3);
  stores['kingpin-order-index']['order-3'] = { id: 3, customerEmail: 'alice.new@gmail.com' };
  assert.strictEqual((await list()).find(customer => customer.email === 'alice.new@gmail.com').totalOrders, 1);

  // Delete: account and cart are removed; orders stay as sales records.
  const deleted = await handler(post(adminToken, { action: 'delete', email: 'alice.new@gmail.com' }));
  assert.strictEqual(deleted.statusCode, 200);
  assert.strictEqual(stores['kingpin-auth'][accountKey('alice.new@gmail.com')], undefined);
  assert.strictEqual(stores['kingpin-carts'][accountKey('alice.new@gmail.com')], undefined);
  assert.strictEqual(stores['kingpin-order-index']['order-2'].customerEmail, 'alice.new@gmail.com');
  assert.deepStrictEqual((await list()).map(customer => customer.email).sort(), ['a@example.com', 'b@example.com']);
  assert.strictEqual((await handler(post(adminToken, { action: 'delete', email: 'alice.new@gmail.com' }))).statusCode, 404);
  assert.strictEqual((await handler(post(adminToken, { action: 'unknown' }))).statusCode, 400);
  console.log('Customer list tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
