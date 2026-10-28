const assert = require('assert');
const {
  accountKey,
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
      async set(key, value, options = {}) { values.set(key, value); if (options.metadata) values.set(`${key}:metadata`, options.metadata); },
      async getMetadata(key) { return values.has(key) ? { metadata: values.get(`${key}:metadata`) || {} } : null; },
      async setJSON(key, value) { values.set(key, value); },
      async list({ prefix = '' } = {}) {
        return {
          blobs: [...values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })),
          cursor: null
        };
      }
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
const { handler: heroHandler } = require('../netlify/functions/shop-hero.js');
const { handler: orderStatusHandler } = require('../netlify/functions/order-status.js');
const { handler: ordersHandler } = require('../netlify/functions/orders.js');
const { handler: qrHandler } = require('../netlify/functions/gcash-qr.js');
const { handler: footerHandler } = require('../netlify/functions/shop-footer.js');
const { handler: cartHandler } = require('../netlify/functions/cart.js');
const { handler: customerServiceHandler } = require('../netlify/functions/customer-service.js');
const { handler: shopBrandingHandler } = require('../netlify/functions/shop-branding.js');
const { handler: authHandler } = require('../netlify/functions/auth.js');

async function run() {
  process.env.KINGPIN_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  process.env.KINGPIN_ADMIN_USERNAME = 'test-admin';
  process.env.KINGPIN_ADMIN_PASSWORD = 'test-admin-password';
  process.env.SMTP_USER = 'test@example.com';
  process.env.SMTP_PASS = 'test-smtp-password';
  const authWithMissingSecret = await authHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ action: 'login', email: 'test@example.com', password: 'not-a-real-password' })
  });
  const originalSecret = process.env.KINGPIN_AUTH_SECRET;
  delete process.env.KINGPIN_AUTH_SECRET;
  const missingSecretResponse = await authHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ action: 'login', email: 'test@example.com', password: 'not-a-real-password' })
  });
  assert.strictEqual(missingSecretResponse.statusCode, 503);
  assert.ok(JSON.parse(missingSecretResponse.body).error.includes('KINGPIN_AUTH_SECRET'));
  process.env.KINGPIN_AUTH_SECRET = 'too-short';
  const weakSecretResponse = await authHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ action: 'login', email: 'test@example.com', password: 'not-a-real-password' })
  });
  assert.strictEqual(weakSecretResponse.statusCode, 503);
  assert.ok(JSON.parse(weakSecretResponse.body).error.includes('at least 32 characters'));
  process.env.KINGPIN_AUTH_SECRET = originalSecret;
  assert.strictEqual(authWithMissingSecret.statusCode, 401);
  const token = signAccessToken({ sub: 'customer@example.com', role: 'customer' });
  const [tokenHeader, tokenPayload, tokenSignature] = token.split('.');
  const changedSignature = `${tokenSignature[0] === 'a' ? 'b' : 'a'}${tokenSignature.slice(1)}`;
  assert.strictEqual(verifyAccessToken(token).sub, 'customer@example.com');
  assert.strictEqual(verifyAccessToken(`${tokenHeader}.${tokenPayload}.${changedSignature}`), null);
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
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const getEvent = token => ({
    httpMethod: 'GET',
    headers: { authorization: ['Bearer', token].join(' ') }
  });
  assert.strictEqual((await productsHandler(postEvent('', { products: [] }))).statusCode, 401);
  assert.strictEqual((await productsHandler(postEvent(customerToken, { products: [] }))).statusCode, 403);
  assert.strictEqual((await heroHandler(postEvent(customerToken, {}))).statusCode, 403);
  assert.strictEqual((await orderStatusHandler(postEvent(customerToken, {}))).statusCode, 403);
  assert.strictEqual((await ordersHandler(postEvent(customerToken, { action: 'admin-update', orderId: '1', status: 'completed' }))).statusCode, 403);
  assert.strictEqual((await qrHandler(postEvent(customerToken, { gcashQRCode: 'data:image/png;base64,AA==' }))).statusCode, 403);
  assert.strictEqual((await footerHandler(postEvent(customerToken, {}))).statusCode, 403);
  assert.strictEqual((await shopBrandingHandler(postEvent(customerToken, {
    shopName: 'Shop',
    shopLogo: 'data:image/png;base64,AA=='
  }))).statusCode, 403);
  assert.strictEqual(JSON.parse((await shopBrandingHandler(getEvent(customerToken))).body).exists, false);
  const branding = { shopName: 'Shared Shop', shopLogo: 'data:image/png;base64,AA==' };
  assert.strictEqual((await shopBrandingHandler(postEvent(adminToken, branding))).statusCode, 200);
  assert.strictEqual(JSON.parse((await shopBrandingHandler(getEvent(customerToken))).body).exists, true);
  assert.deepStrictEqual(
    JSON.parse((await shopBrandingHandler(getEvent(customerToken))).body).branding,
    branding
  );
  assert.strictEqual((await shopBrandingHandler(postEvent(adminToken, {
    shopName: 'Shared Shop',
    shopLogo: 'data:text/html;base64,AA=='
  }))).statusCode, 400);
  const customerCart = [{ id: 1, name: 'Uploaded Design', price: 600, quantity: 1, details: { uploadedFiles: [{ uploadedFile: 'data:image/png;base64,AA==', fileName: 'design.png' }] } }];
  const saveCartResponse = await cartHandler(postEvent(customerToken, { cart: customerCart }));
  assert.strictEqual(saveCartResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse((await cartHandler(getEvent(customerToken))).body).cart, customerCart);
  const otherCustomerToken = signAccessToken({ sub: 'other-customer@example.com', role: 'customer' });
  assert.deepStrictEqual(JSON.parse((await cartHandler(getEvent(otherCustomerToken))).body).cart, []);
  assert.strictEqual((await cartHandler(postEvent(customerToken, { cart: [{ ...customerCart[0], details: { uploadedFiles: [{ uploadedFile: 'data:text/html;base64,AA==' }] } }] }))).statusCode, 400);
  const testCustomerAccount = {
    email: 'customer@example.com',
    username: 'customerlogin',
    fullName: 'Old Full Name',
    phone: '09170000000',
    address: 'Old address',
    verified: true
  };
  await blobModule.getStore('kingpin-auth').setJSON(accountKey(testCustomerAccount.email), testCustomerAccount);
  const earlierServiceMessageResponse = await customerServiceHandler(postEvent(customerToken, {
    action: 'create',
    subject: 'Order status',
    message: 'Checking an existing support thread.'
  }));
  assert.strictEqual(earlierServiceMessageResponse.statusCode, 201);
  const earlierServiceMessage = JSON.parse(earlierServiceMessageResponse.body).message;
  assert.strictEqual(earlierServiceMessage.customerUsername, 'customerlogin');
  const updateProfileResponse = await authHandler(postEvent(customerToken, {
    action: 'update-customer-profile',
    email: testCustomerAccount.email,
    username: 'newusername',
    fullName: 'Updated Full Name',
    phone: '09171112222',
    address: 'Updated address'
  }));
  assert.strictEqual(updateProfileResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(updateProfileResponse.body).user, {
    email: testCustomerAccount.email,
    username: 'newusername',
    fullName: 'Updated Full Name',
    phone: '09171112222',
    address: 'Updated address'
  });
  assert.strictEqual((await authHandler(getEvent(customerToken))).statusCode, 200);
  const refreshedProfileResponse = await authHandler(getEvent(customerToken));
  assert.strictEqual(JSON.parse(refreshedProfileResponse.body).profile.username, 'newusername');
  const refreshedAdminMessages = JSON.parse((await customerServiceHandler(getEvent(adminToken))).body).messages;
  assert.strictEqual(refreshedAdminMessages.find(message => message.id === earlierServiceMessage.id).customerUsername, 'newusername');
  assert.strictEqual((await authHandler(postEvent(customerToken, {
    action: 'update-customer-profile',
    email: 'changed@example.com',
    username: 'newusername',
    fullName: 'Updated Full Name',
    phone: '09171112222',
    address: 'Updated address'
  }))).statusCode, 400);
  assert.strictEqual((await authHandler(postEvent(adminToken, {
    action: 'update-customer-profile',
    email: 'admin@example.com',
    username: 'adminuser',
    fullName: 'Admin',
    phone: '09170000000',
    address: 'Admin address'
  }))).statusCode, 403);
  const customerServiceMessage = {
    action: 'create',
    customerName: 'Test Customer',
    orderId: 'order-123',
    subject: 'Order status',
    message: 'Can I get an update?'
  };
  assert.strictEqual((await customerServiceHandler(getEvent(''))).statusCode, 401);
  const createdServiceMessage = await customerServiceHandler(postEvent(customerToken, customerServiceMessage));
  assert.strictEqual(createdServiceMessage.statusCode, 201);
  const serviceMessage = JSON.parse(createdServiceMessage.body).message;
  assert.strictEqual(serviceMessage.customerUsername, 'newusername');
  assert.strictEqual(serviceMessage.customerEmail, 'customer@example.com');
  assert.strictEqual(serviceMessage.ownerSub, 'customer@example.com');
  assert.strictEqual((await customerServiceHandler(postEvent(adminToken, customerServiceMessage))).statusCode, 403);
  assert.strictEqual((await customerServiceHandler(postEvent(customerToken, { action: 'create', subject: 'Invalid', message: 'Hello' }))).statusCode, 400);
  const customerServiceMessages = await customerServiceHandler(getEvent(customerToken));
  assert.deepStrictEqual(
    JSON.parse(customerServiceMessages.body).messages.map(message => message.id).sort(),
    [serviceMessage.id, earlierServiceMessage.id].sort()
  );
  assert.deepStrictEqual(JSON.parse((await customerServiceHandler(getEvent(otherCustomerToken))).body).messages, []);
  const adminMessages = JSON.parse((await customerServiceHandler(getEvent(adminToken))).body).messages;
  assert.deepStrictEqual(
    adminMessages.map(message => message.id).sort(),
    [serviceMessage.id, earlierServiceMessage.id].sort()
  );
  assert.ok(adminMessages.every(message => message.customerUsername === 'newusername'));
  assert.strictEqual((await customerServiceHandler(postEvent(customerToken, { action: 'reply', messageId: serviceMessage.id, message: 'Not allowed' }))).statusCode, 403);
  assert.strictEqual((await customerServiceHandler(postEvent(adminToken, { action: 'read', messageId: serviceMessage.id }))).statusCode, 200);
  assert.strictEqual((await customerServiceHandler(postEvent(adminToken, { action: 'reply', messageId: serviceMessage.id, message: 'We are checking this.' }))).statusCode, 200);
  const customerServiceConversation = JSON.parse((await customerServiceHandler(getEvent(customerToken))).body).messages
    .find(message => message.id === serviceMessage.id);
  assert.strictEqual(customerServiceConversation.read, true);
  assert.strictEqual(customerServiceConversation.replies[0].message, 'We are checking this.');
  assert.strictEqual((await cartHandler(postEvent(adminToken, { cart: [] }))).statusCode, 403);
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
  assert.strictEqual((await authHandler(postEvent('', { action: 'admin-login', username: 'test-admin', password: 'wrong-password' }))).statusCode, 401);
  assert.strictEqual((await authHandler(postEvent('', { action: 'admin-login', username: 'new-admin', password: 'updated-admin-password' }))).statusCode, 200);
  const recoveredAdmin = await authHandler(postEvent('', { action: 'admin-login', username: 'test-admin', password: 'test-admin-password' }));
  assert.strictEqual(recoveredAdmin.statusCode, 200);
  assert.strictEqual(JSON.parse(recoveredAdmin.body).user.username, 'test-admin');
  assert.strictEqual((await authHandler(postEvent('', { action: 'admin-login', username: 'new-admin', password: 'updated-admin-password' }))).statusCode, 401);

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

  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const failedEmailRegistration = await authHandler(postEvent('', {
    action: 'register',
    email: 'mail-unavailable@example.com',
    username: 'mail-unavailable',
    fullName: 'Mail Unavailable',
    password: 'customer-password-123'
  }));
  assert.strictEqual(failedEmailRegistration.statusCode, 503);
  assert.ok(JSON.parse(failedEmailRegistration.body).error.includes('verification email'));
  assert.strictEqual(await blobModule.getStore('kingpin-auth').get(accountKey('mail-unavailable@example.com'), { type: 'json' }), null);
  console.log('authentication tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
