const assert = require('assert');
const path = require('path');

process.env.KINGPIN_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const stores = new Map();
const blobModulePath = require.resolve('@netlify/blobs');
const blobModule = {
  connectLambda() {},
  getStore(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async get(key) { return entries.has(key) ? entries.get(key) : null; },
      async set(key, value) { entries.set(key, value); },
      async setJSON(key, value) { entries.set(key, value); },
      async delete(key) { entries.delete(key); }
    };
  }
};
require.cache[blobModulePath] = {
  id: blobModulePath,
  filename: blobModulePath,
  loaded: true,
  exports: blobModule
};

const { signAccessToken } = require('../netlify/functions/lib/auth.js');
const { handler: ordersHandler } = require('../netlify/functions/orders.js');
const { handler: orderDesignHandler } = require('../netlify/functions/order-design.js');
const adminToken = signAccessToken({ sub: 'shop-admin', role: 'admin' });
const customerToken = signAccessToken({ sub: 'jersey.customer@example.com', role: 'customer' });
const otherCustomerToken = signAccessToken({ sub: 'other@example.com', role: 'customer' });

function request(method, token, body, queryStringParameters = {}) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body ? JSON.stringify(body) : '',
    queryStringParameters
  };
}

async function post(token, body) {
  return ordersHandler(request('POST', token, body));
}

async function run() {
  const unauthorized = await ordersHandler(request('GET', '', null));
  assert.strictEqual(unauthorized.statusCode, 401);

  const orderPayload = email => ({
    id: email === 'jersey.customer@example.com' ? 3001 : 3002,
    customerEmail: email,
    customerName: 'Test Customer',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'pending',
    totalAmount: 1500,
    items: [{ name: 'Custom jersey', quantity: 1, price: 1500 }]
  });
  assert.strictEqual((await post(customerToken, { action: 'create', order: orderPayload('jersey.customer@example.com') })).statusCode, 201);
  assert.strictEqual((await post(otherCustomerToken, { action: 'create', order: orderPayload('other@example.com') })).statusCode, 201);

  const customerOrders = await ordersHandler(request('GET', customerToken, null));
  assert.deepStrictEqual(JSON.parse(customerOrders.body).orders.map(order => order.id), [3001]);
  const forbiddenUpdate = await post(customerToken, { action: 'admin-update', operation: 'verify-payment', orderId: 3002 });
  assert.strictEqual(forbiddenUpdate.statusCode, 403);
  const forbiddenRead = await post(otherCustomerToken, { action: 'customer-approval', orderId: 3001, decision: 'approved' });
  assert.strictEqual(forbiddenRead.statusCode, 403);

  const originalFetch = global.fetch;
  process.env.RESEND_API_KEY = 'test-email-key';
  process.env.RESEND_FROM_EMAIL = 'orders@example.com';
  global.fetch = async () => ({ ok: false, text: async () => 'test email outage' });

  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'printing' })).statusCode, 409);
  const paymentStage = await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'payment-verification', estimatedCompletionDate: '2026-12-31', remarks: 'Proof received.' });
  assert.strictEqual(paymentStage.statusCode, 200);
  assert.strictEqual(JSON.parse(paymentStage.body).order.productionStatus, 'payment-verification');
  assert.ok(JSON.parse(paymentStage.body).order.productionNotifications.some(event => event.message.includes('Remarks: Proof received.')));
  const firstHistoryLength = JSON.parse(paymentStage.body).order.productionHistory.length;
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'payment-verification' })).statusCode, 409);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-details', orderId: 3001, estimatedCompletionDate: '2026-12-31', remarks: 'Proof received.' })).statusCode, 409);
  assert.strictEqual(JSON.parse((await ordersHandler(request('GET', adminToken, null))).body).orders.find(order => order.id === 3001).productionHistory.length, firstHistoryLength);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'verify-payment', orderId: 3001 })).statusCode, 200);

  const design = `data:image/png;base64,${Buffer.from('final design').toString('base64')}`;
  const upload = await post(adminToken, { action: 'admin-update', operation: 'design-upload', orderId: 3001, design, fileName: 'final.png', fileType: 'image/png' });
  assert.strictEqual(upload.statusCode, 200);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'design-approval' })).statusCode, 200);
  assert.strictEqual((await post(customerToken, { action: 'customer-approval', orderId: 3001, decision: 'approved' })).statusCode, 200);
  assert.strictEqual((await post(customerToken, { action: 'customer-approval', orderId: 3001, decision: 'approved' })).statusCode, 409);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'printing' })).statusCode, 200);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'quality-checking' })).statusCode, 200);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'ready-for-release' })).statusCode, 200);
  assert.strictEqual((await post(adminToken, { action: 'admin-update', operation: 'production-stage', orderId: 3001, productionStatus: 'completed' })).statusCode, 200);

  const adminOrders = await ordersHandler(request('GET', adminToken, null));
  const savedOrder = JSON.parse(adminOrders.body).orders.find(order => order.id === 3001);
  assert.strictEqual(savedOrder.productionStatus, 'completed');
  assert.strictEqual(savedOrder.status, 'delivered');
  assert.ok(savedOrder.productionHistory.some(entry => entry.event === 'approved'));
  assert.ok(savedOrder.productionHistory.some(entry => entry.event === 'stage-change' && entry.status === 'quality-checking'));

  const customerFinalOrder = JSON.parse((await ordersHandler(request('GET', customerToken, null))).body).orders[0];
  assert.strictEqual(customerFinalOrder.productionStatus, 'completed');
  assert.ok(customerFinalOrder.productionNotifications.some(event => event.message.includes('verified your payment')));
  assert.ok(customerFinalOrder.productionNotifications.some(event => event.message.includes('Completed')));
  const customerFinalDesign = customerFinalOrder.finalDesignUrl;
  const designUrl = new URL(customerFinalDesign, 'https://kingpin.example');
  const mediaResponse = await orderDesignHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: Object.fromEntries(designUrl.searchParams) });
  assert.strictEqual(mediaResponse.statusCode, 200);
  assert.strictEqual(Buffer.from(mediaResponse.body, 'base64').toString(), 'final design');

  const otherMedia = await orderDesignHandler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { orderId: '3001', media: 'final-design', access: signAccessToken({ sub: 'other@example.com', role: 'customer', mediaOrderId: '3001', media: 'final-design', itemIndex: '' }) }
  });
  assert.strictEqual(otherMedia.statusCode, 403);
  global.fetch = originalFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  console.log('order production tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});