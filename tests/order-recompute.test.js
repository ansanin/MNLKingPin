const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { signAccessToken } = require('../netlify/functions/lib/auth');

const stores = {
  'kingpin-products': { catalog: [{ id: 10, name: 'Jersey', price: 500 }, { id: 11, name: 'Shorts', price: 300 }] },
  'kingpin-orders': {},
  'kingpin-order-index': {
    'all-order-ids': [1, 2, 3, 4, 5],
    'order-1': { id: 1, customerName: 'Juan', status: 'pending', productionStatus: 'order-placed', items: [{ id: 10, name: 'Jersey', price: 400, quantity: 2 }], totalAmount: 800, productionHistory: [] },
    'order-2': { id: 2, customerName: 'Team', status: 'delivered', productionStatus: 'completed', items: [{ id: 10, name: 'Jersey', price: 400, quantity: 1 }], teamOrder: { isTeamOrder: true, totalPlayers: 5 }, totalAmount: 2000, productionHistory: [] },
    'order-3': { id: 3, customerName: 'Custom', status: 'pending', productionStatus: 'order-placed', items: [{ id: 10, name: 'Custom Upload', price: 600, quantity: 1, designType: 'uploaded' }], totalAmount: 600, productionHistory: [] },
    'order-4': { id: 4, customerName: 'Mixed', status: 'pending', productionStatus: 'order-placed', items: [{ id: 99, name: 'Custom', price: 600, quantity: 1, designType: 'custom' }, { id: 11, name: 'Shorts', price: 250, quantity: 2 }], totalAmount: 1100, productionHistory: [] },
    'order-5': { id: 5, customerName: 'Same', status: 'pending', productionStatus: 'order-placed', items: [{ id: 11, name: 'Shorts', price: 300, quantity: 1 }], totalAmount: 300, productionHistory: [] }
  },
  'kingpin-order-designs': {}
};
const modulePath = require.resolve('@netlify/blobs');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
  connectLambda() {},
  getStore(name) {
    if (!stores[name]) stores[name] = {};
    const data = stores[name];
    return {
      async get(key) { return data[key] === undefined ? null : JSON.parse(JSON.stringify(data[key])); },
      async set(key, value) { data[key] = value; },
      async setJSON(key, value) { data[key] = JSON.parse(JSON.stringify(value)); },
      async delete(key) { delete data[key]; },
      async list({ prefix = '' } = {}) { return { blobs: Object.keys(data).filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
    };
  }
} };
const { handler } = require('../netlify/functions/orders');

(async () => {
  const post = (token, body) => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const customerToken = signAccessToken({ sub: 'juan@example.com', role: 'customer' });
  const order = id => stores['kingpin-order-index'][`order-${id}`];

  assert.strictEqual((await handler(post(customerToken, { action: 'recompute-prices' }))).statusCode, 403);

  // Preview does not save anything.
  const preview = JSON.parse((await handler(post(adminToken, { action: 'recompute-prices' }))).body);
  assert.strictEqual(preview.applied, false);
  assert.strictEqual(preview.ordersChecked, 5);
  assert.strictEqual(preview.ordersChanged, 3);
  assert.strictEqual(preview.totalBefore, 4800);
  assert.strictEqual(preview.totalAfter, 5600);
  assert.deepStrictEqual(preview.changes.map(change => [change.orderId, change.totalBefore, change.totalAfter]), [[1, 800, 1000], [2, 2000, 2500], [4, 1100, 1200]]);
  assert.strictEqual(order(1).totalAmount, 800);

  // Apply saves new item prices and totals; custom designs and unchanged orders stay.
  const applied = JSON.parse((await handler(post(adminToken, { action: 'recompute-prices', apply: true }))).body);
  assert.strictEqual(applied.applied, true);
  assert.strictEqual(order(1).totalAmount, 1000);
  assert.strictEqual(order(1).items[0].price, 500);
  assert.strictEqual(order(2).totalAmount, 2500);
  assert.strictEqual(order(3).totalAmount, 600);
  assert.strictEqual(order(3).items[0].price, 600);
  assert.strictEqual(order(4).totalAmount, 1200);
  assert.strictEqual(order(4).items[0].price, 600);
  assert.strictEqual(order(4).items[1].price, 300);
  assert.strictEqual(order(5).totalAmount, 300);
  assert.deepStrictEqual(order(1).priceAdjustments[0].items, [{ name: 'Jersey', oldPrice: 400, newPrice: 500 }]);

  // Running it again finds nothing to change.
  const again = JSON.parse((await handler(post(adminToken, { action: 'recompute-prices' }))).body);
  assert.strictEqual(again.ordersChanged, 0);
  console.log('order price recompute tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
