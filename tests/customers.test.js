const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { signAccessToken } = require('../netlify/functions/lib/auth');
const stores = {
  'kingpin-auth': {
    'customer-1': { verified: true, email: 'a@example.com', fullName: 'Alice', phone: '09123456789', passwordHash: 'private' },
    'customer-2': { verified: true, email: 'b@example.com', fullName: 'Bob' },
    'customer-3': { verified: false, email: 'c@example.com' }
  },
  'kingpin-orders': { orders: [{ id: 1, customerEmail: 'A@example.com' }] },
  'kingpin-order-index': { 'all-order-ids': [1, 2], 'order-1': { id: 1, customerEmail: 'a@example.com' }, 'order-2': { id: 2, customerEmail: 'a@example.com' } }
};
const modulePath = require.resolve('@netlify/blobs');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
  connectLambda() {},
  getStore(name) { const data = stores[name]; return {
    async get(key) { return data[key] || null; },
    async list({ prefix }) { return { blobs: Object.keys(data).filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
  }; }
} };
const { handler } = require('../netlify/functions/customers');
(async () => {
  const request = token => ({ httpMethod: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.strictEqual((await handler(request())).statusCode, 401);
  assert.strictEqual((await handler(request(signAccessToken({ sub: 'a@example.com', role: 'customer' })))).statusCode, 403);
  const result = await handler(request(signAccessToken({ sub: 'admin', role: 'admin' })));
  assert.strictEqual(result.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(result.body).customers, [
    { name: 'Alice', email: 'a@example.com', phone: '09123456789', totalOrders: 2 },
    { name: 'Bob', email: 'b@example.com', phone: '', totalOrders: 0 }
  ]);
  console.log('Customer list tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
