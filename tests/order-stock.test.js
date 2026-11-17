// Shop stock: orders take pieces out of the catalog on the server, cancelled
// orders put them back, and an admin catalog save cannot undo a sale.
// Also: the admin's notification read time is shared by every admin device.
const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { signAccessToken } = require('../netlify/functions/lib/auth');

// In-memory Netlify Blobs with etags, like the real store: a conditional write
// fails when someone saved the key after it was read.
const stores = {};
let interruptNextCatalogWrite = null;
const modulePath = require.resolve('@netlify/blobs');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
  connectLambda() {},
  getStore(name) {
    if (!stores[name]) stores[name] = { data: {}, etags: {} };
    const { data, etags } = stores[name];
    const copy = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
    const write = (key, value) => { data[key] = value; etags[key] = `e${Math.random()}`; };
    return {
      async get(key) { return copy(data[key]); },
      async getWithMetadata(key) { return data[key] === undefined ? null : { data: copy(data[key]), etag: etags[key], metadata: {} }; },
      async getMetadata(key) { return data[key] === undefined ? null : { etag: etags[key], metadata: {} }; },
      async set(key, value) { write(key, value); return { modified: true }; },
      async setJSON(key, value, options = {}) {
        if (name === 'kingpin-products' && key === 'catalog' && interruptNextCatalogWrite) {
          const interrupt = interruptNextCatalogWrite;
          interruptNextCatalogWrite = null;
          interrupt(data[key]);
          etags[key] = `e${Math.random()}`;
        }
        if (options.onlyIfMatch && options.onlyIfMatch !== etags[key]) return { modified: false };
        write(key, copy(value));
        return { modified: true, etag: etags[key] };
      },
      async delete(key) { delete data[key]; delete etags[key]; },
      async list({ prefix = '' } = {}) { return { blobs: Object.keys(data).filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
    };
  }
} };

const { handler: orders } = require('../netlify/functions/orders');
const { handler: products } = require('../netlify/functions/products');

(async () => {
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const anaToken = signAccessToken({ sub: 'ana@example.com', role: 'customer' });
  const post = (handler, token, body) => handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const getOrders = token => orders({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` }, queryStringParameters: {} });
  const body = response => JSON.parse(response.body);
  const catalog = () => stores['kingpin-products'].data.catalog;
  const stockOf = id => catalog().find(product => product.id === id).stock;
  let nextId = 1794700000000;
  const createOrder = (items, extra = {}) => post(orders, anaToken, { action: 'create', order: {
    id: nextId++, customerEmail: 'ana@example.com', customerName: 'Ana Reyes', paymentMethod: 'pickup',
    totalAmount: items.reduce((sum, item) => sum + item.price * item.quantity, 0), items, ...extra
  } });

  stores['kingpin-products'] = { data: {
    catalog: [
      { id: 1, name: 'Pro Basketball Jersey', price: 450, stock: 5, availableSizes: ['M', 'L'] },
      { id: 2, name: 'Volleyball Jersey', price: 600, stock: 0, availableSizes: ['M'] },
      { id: 3, name: 'Club Uniform', price: 500, stock: 10, availableSizes: ['M'] }
    ],
    'catalog-image-migration-v1': 'complete'
  }, etags: { catalog: 'e0' } };

  // An order takes its pieces out of stock and remembers what it took.
  const first = await createOrder([{ id: 1, name: 'Pro Basketball Jersey', price: 450, quantity: 2 }]);
  assert.strictEqual(first.statusCode, 201, first.body);
  assert.strictEqual(stockOf(1), 3);
  assert.deepStrictEqual(body(first).order.stockDeductions, [{ productId: 1, name: 'Pro Basketball Jersey', quantity: 2 }]);

  // Not enough left, or none at all: the order is refused and stock is unchanged.
  const tooMany = await createOrder([{ id: 1, name: 'Pro Basketball Jersey', price: 450, quantity: 4 }]);
  assert.strictEqual(tooMany.statusCode, 409);
  assert.match(body(tooMany).error, /Only 3 left of Pro Basketball Jersey\. Your order needs 4\./);
  const soldOut = await createOrder([{ id: 2, name: 'Volleyball Jersey', price: 600, quantity: 1 }]);
  assert.strictEqual(soldOut.statusCode, 409);
  assert.match(body(soldOut).error, /Volleyball Jersey is out of stock/);
  assert.strictEqual(stockOf(1), 3);

  // The browser cannot claim stock was already returned.
  const forged = await createOrder([{ id: 3, name: 'Club Uniform', price: 500, quantity: 1 }], { stockRestoredAt: '2026-01-01T00:00:00Z', stockDeductions: [] });
  assert.strictEqual(forged.statusCode, 201, forged.body);
  assert.strictEqual(body(forged).order.stockRestoredAt, undefined);
  assert.strictEqual(stockOf(3), 9);

  // A team order needs one piece per player.
  const teamSizes = [1, 2, 3, 4, 5].map(player => ({ player, surname: `Player${player}`, jerseyNumber: String(player), topSize: 'M', bottomSize: 'M' }));
  const team = await createOrder([{ id: 3, name: 'Club Uniform', price: 500, quantity: 1 }], { teamOrder: { isTeamOrder: true, teamName: 'Naga', teamType: 'Basketball', totalPlayers: 5, teamSizes } });
  assert.strictEqual(team.statusCode, 201, team.body);
  assert.strictEqual(stockOf(3), 4);

  // Products that are not in the catalog (custom designs, old items) do not touch stock.
  const custom = await createOrder([{ id: 'custom-1', type: 'custom-design', name: 'Custom Top', price: 800, quantity: 1 }, { id: 999, name: 'Old item', price: 100, quantity: 1 }]);
  assert.strictEqual(custom.statusCode, 201, custom.body);
  assert.deepStrictEqual(body(custom).order.stockDeductions, []);

  // Another order saved the catalog at the same moment: the stock change is
  // tried again on the newest catalog instead of overwriting it.
  interruptNextCatalogWrite = current => { current.find(product => product.id === 1).stock -= 1; };
  const racing = await createOrder([{ id: 1, name: 'Pro Basketball Jersey', price: 450, quantity: 1 }]);
  assert.strictEqual(racing.statusCode, 201, racing.body);
  assert.strictEqual(stockOf(1), 1, 'Both the other sale and this one are taken out.');

  // The customer cancels: the pieces go back, once.
  const cancelled = await post(orders, anaToken, { action: 'customer-update', order: { id: body(first).order.id, status: 'cancelled', requestReason: 'Changed my mind.' } });
  assert.strictEqual(cancelled.statusCode, 200, cancelled.body);
  assert.strictEqual(stockOf(1), 3);
  assert.ok(body(cancelled).order.stockRestoredAt);
  assert.strictEqual((await post(orders, anaToken, { action: 'customer-update', order: { id: body(first).order.id, status: 'cancelled', requestReason: 'Again.' } })).statusCode, 409);
  assert.strictEqual(stockOf(1), 3);

  // The admin cancels the team order: its five pieces go back.
  const adminCancel = await post(orders, adminToken, { action: 'admin-update', orderId: body(team).order.id, operation: 'production-stage', productionStatus: 'cancelled', remarks: 'Team cancelled.' });
  assert.strictEqual(adminCancel.statusCode, 200, adminCancel.body);
  assert.strictEqual(stockOf(3), 9);

  // An admin page loaded when stock was 5 saves the catalog without changing
  // that stock: the server keeps the current 3. A stock the admin changed is saved.
  const staleSave = await post(products, adminToken, { products: [
    { id: 1, name: 'Pro Basketball Jersey', price: 475, stock: 5, stockBase: 5, availableSizes: ['M', 'L'] },
    { id: 2, name: 'Volleyball Jersey', price: 600, stock: 20, stockBase: 0, availableSizes: ['M'] },
    { id: 3, name: 'Club Uniform', price: 500, stock: 10, stockBase: 10, availableSizes: ['M'] }
  ] });
  assert.strictEqual(staleSave.statusCode, 200, staleSave.body);
  assert.strictEqual(stockOf(1), 3, 'A sale made after the admin page loaded is kept.');
  assert.strictEqual(catalog().find(product => product.id === 1).price, 475, 'The admin\'s price change is saved.');
  assert.strictEqual(stockOf(2), 20, 'A restock is saved.');
  assert.strictEqual(stockOf(3), 9);
  assert.ok(catalog().every(product => !('stockBase' in product)), 'stockBase is not stored.');
  // Saves without stockBase (older pages, new products) keep working as before.
  const plainSave = await post(products, adminToken, { products: catalog().map(product => ({ ...product, stock: product.id === 3 ? 12 : product.stock })) });
  assert.strictEqual(plainSave.statusCode, 200, plainSave.body);
  assert.strictEqual(stockOf(3), 12);

  // An order missing from the "all-order-ids" list (two saves at the same
  // moment can drop it) is still found from its own record, for the admin and the customer.
  const index = stores['kingpin-order-index'].data;
  const hiddenId = body(racing).order.id;
  index['all-order-ids'] = index['all-order-ids'].filter(id => String(id) !== String(hiddenId));
  assert.ok(body(await getOrders(adminToken)).orders.some(order => order.id === hiddenId), 'The admin lost an order that was saved.');
  assert.ok(body(await getOrders(anaToken)).orders.some(order => order.id === hiddenId), 'The customer lost an order that was saved.');

  // The admin's notification read time is shared: it starts empty, moves
  // forward only, is never later than now, and only the admin can set it.
  assert.strictEqual(body(await getOrders(adminToken)).adminNotificationsReadAt, '');
  assert.strictEqual(body(await getOrders(anaToken)).adminNotificationsReadAt, undefined);
  assert.strictEqual((await post(orders, anaToken, { action: 'admin-notifications-read', upTo: new Date().toISOString() })).statusCode, 403);
  assert.strictEqual((await post(orders, adminToken, { action: 'admin-notifications-read', upTo: 'yesterday-ish' })).statusCode, 400);
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const marked = body(await post(orders, adminToken, { action: 'admin-notifications-read', upTo: anHourAgo }));
  assert.strictEqual(marked.adminNotificationsReadAt, anHourAgo);
  const older = body(await post(orders, adminToken, { action: 'admin-notifications-read', upTo: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }));
  assert.strictEqual(older.adminNotificationsReadAt, anHourAgo, 'It never moves back.');
  const future = body(await post(orders, adminToken, { action: 'admin-notifications-read', upTo: '2999-01-01T00:00:00.000Z' }));
  assert.ok(Date.parse(future.adminNotificationsReadAt) <= Date.now(), 'Never later than now.');
  assert.strictEqual(body(await getOrders(adminToken)).adminNotificationsReadAt, future.adminNotificationsReadAt, 'Every admin device gets it.');

  console.log('order stock and admin notification tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
