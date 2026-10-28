const assert = require('assert');

process.env.KINGPIN_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SMTP_USER = 'orders@example.com';
process.env.SMTP_PASS = 'test-password';

const stores = new Map();
const blobModulePath = require.resolve('@netlify/blobs');
const blobModule = {
  connectLambda() {},
  getStore(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name);
    return {
      async get(key) { return values.has(key) ? values.get(key) : null; },
      async setJSON(key, value) { values.set(key, value); }
    };
  }
};
require.cache[blobModulePath] = { id: blobModulePath, filename: blobModulePath, loaded: true, exports: blobModule };

let sentCount = 0;
let sentMessage;
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: { createTransport: () => ({ async sendMail(message) { sentCount += 1; sentMessage = message; } }) }
};

const { signAccessToken } = require('../netlify/functions/lib/auth.js');
const { handler } = require('../netlify/functions/production-email-background.js');
const { handler: statusHandler } = require('../netlify/functions/production-email-status.js');
const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });

async function run() {
  const orderStore = blobModule.getStore('kingpin-order-index');
  await orderStore.setJSON('order-450', {
    id: 450,
    customerEmail: 'customer@example.com',
    estimatedCompletionDate: '2026-12-30',
    paymentMethod: 'gcash', paymentStatus: 'verified', gcashDownpaymentAmount: 400, totalAmount: 800,
    items: [{ id: 5, name: 'Jersey <Team>', quantity: 2 }],
    productionNotifications: [{
      id: 'event-1',
      type: 'stage-update',
      status: 'printing',
      statusLabel: 'Printing / Production',
      remarks: 'Queued <b>securely</b>.'
    }]
  });

  await blobModule.getStore('kingpin-products').setJSON('catalog', [{ id: 5, thumbnailImage: '/.netlify/functions/product-image?key=' + 'a'.repeat(64) }]);

  const event = {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ orderId: 450, eventId: 'event-1' })
  };
  assert.strictEqual((await handler({ ...event, headers: {} })).statusCode, 401);
  assert.strictEqual((await handler(event)).statusCode, 200);
  assert.strictEqual((await handler(event)).statusCode, 200);
  assert.strictEqual(sentCount, 1);
  assert.match(sentMessage.html, /Order number:<\/strong> #450/);
  assert.match(sentMessage.html, /Printing \/ Production/);
  assert.match(sentMessage.html, /2026-12-30/);
  assert.match(sentMessage.html, /PHP 800\.00/);
  assert.match(sentMessage.html, /Verified downpayment:<\/strong> PHP 400\.00/);
  assert.match(sentMessage.html, /Estimated remaining balance:<\/strong> PHP 400\.00/);
  assert.match(sentMessage.html, /https:\/\/mnlkingpin\.netlify\.app\/\.netlify\/functions\/product-image/);
  assert.match(sentMessage.html, /Jersey &lt;Team&gt;/);
  assert.match(sentMessage.html, /Queued &lt;b&gt;securely&lt;\/b&gt;/);
  const { renderOrderUpdateEmail, imageUrl } = require('../netlify/functions/lib/order-email');
  assert.strictEqual(imageUrl('javascript:alert(1)', 'https://mnlkingpin.netlify.app'), '');
  assert.strictEqual(imageUrl('/.netlify/functions/order-design?media=gcash-proof', 'https://mnlkingpin.netlify.app'), '');
  const pending = await renderOrderUpdateEmail({ id: 451, paymentMethod: 'gcash', paymentStatus: 'downpayment-received', totalAmount: 800, gcashDownpaymentAmount: 400, items: [{ name: 'Custom', image: 'data:image/png;base64,AA==' }] }, { status: 'payment-verification' });
  assert.match(pending, /awaiting verification/);
  assert.doesNotMatch(pending, /Verified downpayment|Estimated remaining balance/);
  assert.match(pending, /Not set by the shop yet/);
  assert.match(pending, /Image unavailable/);
  let resendPayload;
  const originalFetch = global.fetch;
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  process.env.RESEND_API_KEY = 'test-api-key'; process.env.RESEND_FROM_EMAIL = 'orders@example.com';
  global.fetch = async (url, options) => { resendPayload = JSON.parse(options.body); return { ok: true }; };
  const order = await orderStore.get('order-450');
  order.productionNotifications.push({ id: 'event-2', type: 'stage-update', status: 'quality-checking', statusLabel: 'Quality Checking' });
  await orderStore.setJSON('order-450', order);
  assert.strictEqual((await handler({ ...event, body: JSON.stringify({ orderId: 450, eventId: 'event-2' }) })).statusCode, 200);
  assert.match(resendPayload.html, /Quality Checking/);
  assert.match(resendPayload.html, /PHP 800\.00/);
  assert.match(resendPayload.html, /product-image/);
  global.fetch = originalFetch;
  delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL;
  order.productionNotifications.push({ id: 'event-3', type: 'stage-update', status: 'printing', statusLabel: 'Printing' });
  await orderStore.setJSON('order-450', order);
  const missing = await handler({ ...event, body: JSON.stringify({ orderId: 450, eventId: 'event-3' }) });
  assert.strictEqual(missing.statusCode, 503);
  const statusEvent = { httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { orderId: '450' } };
  assert.strictEqual((await statusHandler({ ...statusEvent, headers: {} })).statusCode, 401);
  const customerToken = signAccessToken({ sub: 'customer@example.com', role: 'customer' });
  assert.strictEqual((await statusHandler({ ...statusEvent, headers: { authorization: `Bearer ${customerToken}` } })).statusCode, 403);
  const status = JSON.parse((await statusHandler(statusEvent)).body);
  assert.strictEqual(status.configured, false);
  assert.strictEqual(status.deliveries.find(item => item.eventId === 'event-1').state, 'provider_accepted');
  assert.strictEqual(status.deliveries.find(item => item.eventId === 'event-3').reason, 'email_not_configured');
  assert.ok(!JSON.stringify(status).includes('customer@example.com'));
  process.env.RESEND_API_KEY = 'test-api-key'; process.env.RESEND_FROM_EMAIL = 'orders@example.com';
  global.fetch = async () => ({ ok: false, status: 500 });
  order.productionNotifications.push({ id: 'event-4', type: 'stage-update', status: 'printing' });
  await orderStore.setJSON('order-450', order);
  await assert.rejects(() => handler({ ...event, body: JSON.stringify({ orderId: 450, eventId: 'event-4' }) }), /Email provider returned 500/);
  const failed = JSON.parse((await statusHandler(statusEvent)).body).deliveries.find(item => item.eventId === 'event-4');
  assert.strictEqual(failed.reason, 'provider_or_processing_error');
  global.fetch = originalFetch;
  console.log('production email background tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});