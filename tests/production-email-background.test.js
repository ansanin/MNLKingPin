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
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: { createTransport: () => ({ async sendMail() { sentCount += 1; } }) }
};

const { signAccessToken } = require('../netlify/functions/lib/auth.js');
const { handler } = require('../netlify/functions/production-email-background.js');
const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });

async function run() {
  const orderStore = blobModule.getStore('kingpin-order-index');
  await orderStore.setJSON('order-450', {
    id: 450,
    customerEmail: 'customer@example.com',
    estimatedCompletionDate: '2026-12-30',
    productionNotifications: [{
      id: 'event-1',
      type: 'stage-update',
      status: 'printing',
      statusLabel: 'Printing / Production',
      remarks: 'Queued <b>securely</b>.'
    }]
  });

  const event = {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ orderId: 450, eventId: 'event-1' })
  };
  assert.strictEqual((await handler({ ...event, headers: {} })).statusCode, 401);
  assert.strictEqual((await handler(event)).statusCode, 200);
  assert.strictEqual((await handler(event)).statusCode, 200);
  assert.strictEqual(sentCount, 1);
  console.log('production email background tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});