// Design Studio orders (front/back photos, fabrics), admin Fabric Types,
// team order pricing and price adjustments, and the support chat.
const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { signAccessToken, accountKey } = require('../netlify/functions/lib/auth');

const stores = {};
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
const { handler: orders } = require('../netlify/functions/orders');
const { handler: orderDesign } = require('../netlify/functions/order-design');
const { handler: fabrics } = require('../netlify/functions/fabrics');
const { handler: support } = require('../netlify/functions/customer-service');
const { getDesignFileSources } = require('../js/order-media');

const png = text => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;
const body = response => JSON.parse(response.body);

(async () => {
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const customerToken = signAccessToken({ sub: 'ana@example.com', role: 'customer' });
  const otherToken = signAccessToken({ sub: 'ben@example.com', role: 'customer' });
  const request = (handler, token, payload, query) => handler({
    httpMethod: payload ? 'POST' : 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: query || {},
    body: payload ? JSON.stringify(payload) : undefined
  });
  stores['kingpin-auth'] = {
    [accountKey('ana@example.com')]: { email: 'ana@example.com', fullName: 'Ana Reyes', username: 'ana', verified: true },
    [accountKey('ben@example.com')]: { email: 'ben@example.com', fullName: 'Ben Cruz', username: 'ben', verified: true }
  };

  // ----- Fabric Types -----
  assert.strictEqual((await request(fabrics, customerToken, { action: 'save', fabric: { name: 'Dri-fit' } })).statusCode, 403);
  assert.strictEqual((await request(fabrics, adminToken, { action: 'save', fabric: { name: '' } })).statusCode, 400);
  assert.strictEqual((await request(fabrics, adminToken, { action: 'save', fabric: { name: 'Bad' }, image: 'data:text/html;base64,AA==' })).statusCode, 400);
  const saved = await request(fabrics, adminToken, { action: 'save', fabric: { name: 'Dri-fit', description: 'Light', usedFor: 'tops' }, image: png('drifit v1') });
  assert.strictEqual(saved.statusCode, 200, saved.body);
  const drifit = body(saved).fabric;
  assert.match(drifit.imageUrl, /^\/\.netlify\/functions\/fabrics\?image=[a-z0-9-]+&v=1$/);
  assert.strictEqual((await request(fabrics, adminToken, { action: 'save', fabric: { name: 'dri-FIT' } })).statusCode, 409);
  await request(fabrics, adminToken, { action: 'save', fabric: { name: 'Mesh', usedFor: 'both', available: false } });
  const list = body(await request(fabrics, '', null)).fabrics;
  assert.deepStrictEqual(list.map(fabric => fabric.name), ['Dri-fit', 'Mesh']);
  assert.strictEqual(list.find(fabric => fabric.name === 'Mesh').available, false);
  const photo = await request(fabrics, '', null, { image: drifit.id, v: '1' });
  assert.strictEqual(photo.statusCode, 200);
  assert.strictEqual(Buffer.from(photo.body, 'base64').toString(), 'drifit v1');
  // A new photo gets a new version; the old one stays for orders that used it.
  const updated = body(await request(fabrics, adminToken, { action: 'save', fabric: { id: drifit.id, name: 'Dri-fit', usedFor: 'tops' }, image: png('drifit v2') })).fabric;
  assert.match(updated.imageUrl, /&v=2$/);
  assert.strictEqual(Buffer.from((await request(fabrics, '', null, { image: drifit.id, v: '1' })).body, 'base64').toString(), 'drifit v1');
  assert.strictEqual((await request(fabrics, adminToken, { action: 'delete', id: drifit.id })).statusCode, 200);
  assert.strictEqual((await request(fabrics, '', null, { image: drifit.id, v: '2' })).statusCode, 200);
  assert.deepStrictEqual(body(await request(fabrics, '', null)).fabrics.map(fabric => fabric.name), ['Mesh']);

  // ----- A customized set with front and back photos -----
  const setItem = {
    id: 5001, name: 'Custom Set (Top & Bottom) - Red / Black', type: 'custom-design', designType: 'custom', quantity: 1, price: 950,
    customization: { size: 'M', bottomSize: 'L' },
    details: {
      clothingType: 'set',
      parts: [
        { part: 'top', label: 'Top', baseColor: 'Red', accentColor: 'Gold', size: 'M', fabricType: 'Dri-fit', fabricId: drifit.id, fabricImageUrl: updated.imageUrl },
        { part: 'bottom', label: 'Bottom', baseColor: 'Black', accentColor: '', size: 'L', sideStripe: 'Single Stripe', fabricType: 'Mesh' }
      ],
      notes: 'Team name on the chest',
      uploadedFiles: [
        { uploadedFile: png('top front'), fileName: 'tf.png', fileType: 'image/png', label: 'Top · Front', part: 'top', side: 'front' },
        { uploadedFile: png('top back'), fileName: 'tb.png', fileType: 'image/png', label: 'Top · Back', part: 'top', side: 'back' },
        { uploadedFile: png('bottom front'), fileName: 'bf.png', fileType: 'image/png', label: 'Bottom · Front', part: 'bottom', side: 'front' }
      ]
    }
  };
  // Team order: the server works out the total (price × quantity × players), not the browser.
  const teamSizes = Array.from({ length: 5 }, (_, index) => ({ player: index + 1, surname: `P${index + 1}`, jerseyNumber: String(index + 1), topSize: 'M', bottomSize: 'M' }));
  const created = await request(orders, customerToken, { action: 'create', order: {
    id: 1795000000001, customerEmail: 'ana@example.com', customerName: 'Ana Reyes', paymentMethod: 'pickup', totalAmount: 1,
    items: [setItem], teamOrder: { isTeamOrder: true, teamName: 'Alpha', teamType: 'Basketball', totalPlayers: 5, teamSizes }
  } });
  assert.strictEqual(created.statusCode, 201, created.body);
  const order = body(created).order;
  assert.strictEqual(order.totalAmount, 4750);
  assert.strictEqual(order.downpaymentAmount, 2375);
  const storedItem = order.items[0];
  assert.strictEqual(storedItem.details.parts.length, 2);
  assert.strictEqual(storedItem.details.notes, 'Team name on the chest');
  assert.deepStrictEqual(storedItem.details.uploadedFiles.map(file => file.label), ['Top · Front', 'Top · Back', 'Bottom · Front']);
  assert.ok(storedItem.details.uploadedFiles.every(file => !file.uploadedFile && file.uploadedFileUrl));
  // The admin can open every photo the customer sent.
  const adminOrder = body(await request(orders, adminToken, null)).orders.find(item => item.id === order.id);
  const sources = getDesignFileSources(adminOrder.items[0], adminOrder.id, 0);
  assert.deepStrictEqual(sources.map(file => file.label), ['Top · Front', 'Top · Back', 'Bottom · Front']);
  for (const [index, source] of sources.entries()) {
    const url = new URL(source.src, 'https://kingpin.example');
    const response = await orderDesign({ httpMethod: 'GET', headers: {}, queryStringParameters: Object.fromEntries(url.searchParams) });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(Buffer.from(response.body, 'base64').toString(), ['top front', 'top back', 'bottom front'][index]);
  }

  // ----- Price adjustment by the admin -----
  const adjust = fields => request(orders, adminToken, { action: 'admin-update', orderId: order.id, operation: 'adjust-price', ...fields });
  assert.strictEqual((await request(orders, customerToken, { action: 'admin-update', orderId: order.id, operation: 'adjust-price', totalAmount: 1, reason: 'x' })).statusCode, 403);
  assert.strictEqual((await adjust({ pricePerPlayer: 800 })).statusCode, 400);
  assert.strictEqual((await adjust({ pricePerPlayer: 0, reason: 'Discount' })).statusCode, 400);
  const adjusted = await adjust({ pricePerPlayer: 800, reason: 'Team discount' });
  assert.strictEqual(adjusted.statusCode, 200, adjusted.body);
  const adjustedOrder = body(adjusted).order;
  assert.strictEqual(adjustedOrder.totalAmount, 4000);
  assert.strictEqual(adjustedOrder.downpaymentAmount, 2000);
  assert.strictEqual(adjustedOrder.priceAdjustments.at(-1).pricePerPlayer, 800);
  assert.ok(adjustedOrder.productionNotifications.some(event => /updated the price/.test(event.message)));
  // Once the downpayment is paid, a higher price does not ask for more downpayment.
  assert.strictEqual((await request(orders, adminToken, { action: 'admin-update', orderId: order.id, operation: 'verify-payment', amount: 2000 })).statusCode, 200);
  const raised = body(await adjust({ pricePerPlayer: 900, reason: 'Added sleeves' })).order;
  assert.strictEqual(raised.totalAmount, 4500);
  assert.strictEqual(raised.paymentSummary.standing, 'with-balance');
  assert.strictEqual(raised.paymentSummary.balance, 2500);
  assert.strictEqual((await adjust({ pricePerPlayer: 300, reason: 'Too low' })).statusCode, 400);

  // ----- Support chat -----
  const created2 = body(await request(support, customerToken, { action: 'create', subject: 'Order status', message: 'Hello shop' })).message;
  assert.strictEqual((await request(support, otherToken, { action: 'customer-reply', messageId: created2.id, message: 'Not mine' })).statusCode, 404);
  assert.strictEqual((await request(support, adminToken, { action: 'customer-reply', messageId: created2.id, message: 'Admin' })).statusCode, 403);
  let thread = body(await request(support, adminToken, { action: 'reply', messageId: created2.id, message: 'We are on it' })).message;
  assert.strictEqual(thread.status, 'replied');
  assert.strictEqual(thread.customerUnread, true);
  thread = body(await request(support, customerToken, { action: 'customer-seen', messageId: created2.id })).message;
  assert.strictEqual(thread.customerUnread, false);
  thread = body(await request(support, customerToken, { action: 'customer-reply', messageId: created2.id, message: 'Thanks! One more thing' })).message;
  assert.strictEqual(thread.read, false);
  assert.strictEqual(thread.status, 'open');
  assert.deepStrictEqual(thread.replies.map(reply => reply.sender), ['admin', 'customer']);
  thread = body(await request(support, adminToken, { action: 'status', messageId: created2.id, status: 'resolved' })).message;
  assert.strictEqual(thread.status, 'resolved');
  assert.strictEqual((await request(support, adminToken, { action: 'status', messageId: created2.id, status: 'deleted' })).statusCode, 400);
  const customerView = body(await request(support, customerToken, null)).messages;
  assert.strictEqual(customerView.length, 1);
  assert.strictEqual(customerView[0].replies.length, 2);

  console.log('design studio, fabric, team price and chat tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
