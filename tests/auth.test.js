const assert = require('assert');
const {
  authenticateEvent,
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword
} = require('../netlify/functions/lib/auth.js');
const blobModulePath = require.resolve('@netlify/blobs');
const blobStores = new Map();
const blobModule = {
  connectLambda() {},
  getStore(name) {
    if (!blobStores.has(name)) blobStores.set(name, new Map());
    const values = blobStores.get(name);
    return {
      async get(key) { return values.has(key) ? values.get(key) : null; },
      async set(key, value) { values.set(key, value); },
      async setJSON(key, value) { values.set(key, value); }
    };
  }
};
require.cache[blobModulePath] = { id: blobModulePath, filename: blobModulePath, loaded: true, exports: blobModule };
const nodemailerModulePath = require.resolve('nodemailer');
let sentVerificationHtml = '';
require.cache[nodemailerModulePath] = {
  id: nodemailerModulePath,
  filename: nodemailerModulePath,
  loaded: true,
  exports: {
    createTransport() {
      return { async sendMail(message) { sentVerificationHtml = message.html; } };
    }
  }
};
const { handler: productsHandler } = require('../netlify/functions/products.js');
const { handler: qrHandler } = require('../netlify/functions/gcash-qr.js');
const { handler: footerHandler } = require('../netlify/functions/shop-footer.js');
const { handler: authHandler } = require('../netlify/functions/auth.js');

async function run() {
  process.env.KINGPIN_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  process.env.KINGPIN_ADMIN_USERNAME = 'test-admin';
  process.env.KINGPIN_ADMIN_PASSWORD = 'test-admin-password';
  process.env.SMTP_USER = 'test@example.com';
  process.env.SMTP_PASS = 'test-smtp-password';
  const token = signAccessToken({ sub: 'customer@example.com', role: 'customer' });
  assert.strictEqual(verifyAccessToken(token).sub, 'customer@example.com');
  assert.strictEqual(verifyAccessToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null);
  assert.strictEqual(authenticateEvent({ headers: { authorization: `Bearer ${token}` } }).claims.role, 'customer');
  assert.strictEqual(authenticateEvent({ headers: {} }).ok, false);

  const passwordHash = await hashPassword('a-strong-test-password');
  assert.strictEqual(await verifyPassword('a-strong-test-password', passwordHash), true);
  assert.strictEqual(await verifyPassword('incorrect-password', passwordHash), false);

  const postEvent = (token, body) => ({
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body)
  });
  const customerToken = signAccessToken({ sub: 'customer@example.com', role: 'customer' });
  assert.strictEqual((await productsHandler(postEvent('', { products: [] }))).statusCode, 401);
  assert.strictEqual((await qrHandler(postEvent(customerToken, { gcashQRCode: 'data:image/png;base64,AA==' }))).statusCode, 403);
  assert.strictEqual((await footerHandler(postEvent(customerToken, {}))).statusCode, 403);
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  assert.strictEqual((await productsHandler(postEvent(adminToken, { products: [] }))).statusCode, 200);
  assert.strictEqual((await qrHandler(postEvent(adminToken, { gcashQRCode: 'data:image/png;base64,AA==' }))).statusCode, 200);
  assert.strictEqual((await footerHandler(postEvent(adminToken, { location: 'Naga', contactNumber: '', facebookUrl: '', instagramUrl: '' }))).statusCode, 200);

  const loginResponse = await authHandler(postEvent('', { action: 'admin-login', username: 'test-admin', password: 'test-admin-password' }));
  assert.strictEqual(loginResponse.statusCode, 200);
  const loggedInAdmin = JSON.parse(loginResponse.body);
  const changeResponse = await authHandler({
    ...postEvent(loggedInAdmin.token, { action: 'change-admin-credentials', currentPassword: 'test-admin-password', username: 'new-admin', password: 'updated-admin-password' })
  });
  assert.strictEqual(changeResponse.statusCode, 200);
  assert.strictEqual((await authHandler(postEvent('', { action: 'admin-login', username: 'test-admin', password: 'test-admin-password' }))).statusCode, 401);
  assert.strictEqual((await authHandler(postEvent('', { action: 'admin-login', username: 'new-admin', password: 'updated-admin-password' }))).statusCode, 200);

  const registration = await authHandler(postEvent('', {
    action: 'register',
    email: 'new-customer@example.com',
    username: 'new-customer',
    fullName: 'New Customer',
    phone: '',
    password: 'customer-password-123'
  }));
  assert.strictEqual(registration.statusCode, 200);
  const verificationCode = /<strong>(\d{6})<\/strong>/.exec(sentVerificationHtml)?.[1];
  assert.ok(verificationCode);
  const verified = await authHandler(postEvent('', { action: 'verify', email: 'new-customer@example.com', code: verificationCode }));
  assert.strictEqual(verified.statusCode, 200);
  assert.strictEqual(JSON.parse(verified.body).user.password, undefined);
  assert.strictEqual((await authHandler(postEvent('', { action: 'login', email: 'new-customer@example.com', password: 'customer-password-123' }))).statusCode, 200);
  console.log('authentication tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});