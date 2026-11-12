const assert = require('assert');
process.env.KINGPIN_AUTH_SECRET = 'test-secret-at-least-32-characters-long';
const { signAccessToken } = require('../netlify/functions/lib/auth');

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
const { handler: customers } = require('../netlify/functions/customers');
const { handler: reports } = require('../netlify/functions/reports');
const { getPaymentSummary, summarizeCustomerPayments } = require('../js/payment-summary');

const png = text => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;

(async () => {
  const adminToken = signAccessToken({ sub: 'admin', role: 'admin' });
  const customerToken = signAccessToken({ sub: 'ana@example.com', role: 'customer' });
  const otherToken = signAccessToken({ sub: 'ben@example.com', role: 'customer' });
  const post = (token, body) => orders({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const get = (handler, token, query = {}) => handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` }, queryStringParameters: query });
  const body = response => JSON.parse(response.body);
  const admin = (orderId, operation, extra = {}) => post(adminToken, { action: 'admin-update', orderId, operation, ...extra });
  const fetchProof = async url => {
    const parsed = new URL(url, 'https://kingpin.example');
    const response = await orderDesign({ httpMethod: 'GET', headers: {}, queryStringParameters: Object.fromEntries(parsed.searchParams) });
    assert.strictEqual(response.statusCode, 200, response.body);
    return Buffer.from(response.body, 'base64').toString();
  };

  stores['kingpin-auth'] = {
    [require('../netlify/functions/lib/auth').accountKey('ana@example.com')]: { email: 'ana@example.com', fullName: 'Ana Reyes', username: 'ana', phone: '0917', verified: true },
    [require('../netlify/functions/lib/auth').accountKey('ben@example.com')]: { email: 'ben@example.com', fullName: 'Ben Cruz', username: 'ben', verified: true }
  };

  // The browser cannot set the downpayment or payments.
  const created = await post(customerToken, { action: 'create', order: {
    id: 1794500000000, customerEmail: 'ana@example.com', customerName: 'Ana Reyes', paymentMethod: 'gcash', totalAmount: 10000,
    gcashDownpaymentAmount: 1, payments: [{ amount: 10000 }], items: [{ name: 'Jersey', price: 1000, quantity: 10 }], gcashPaymentProof: png('first proof')
  } });
  assert.strictEqual(created.statusCode, 201, created.body);
  const order = body(created).order;
  assert.strictEqual(order.gcashDownpaymentAmount, 5000);
  assert.deepStrictEqual(order.payments, []);
  assert.strictEqual(order.paymentSummary.standing, 'awaiting-verification');
  // A new order tells the admin, with who ordered, how much and how they pay.
  const newOrderNotices = order.productionNotifications.filter(event => event.type === 'new-order');
  assert.strictEqual(newOrderNotices.length, 1, JSON.stringify(order.productionNotifications));
  assert.strictEqual(newOrderNotices[0].message, 'New order from Ana Reyes: 10 pcs, PHP 10,000.00, GCash proof attached.');
  assert.strictEqual(newOrderNotices[0].read, false);
  assert.match(order.gcashPaymentProofUrl, /media=gcash-proof&v=1&access=/);
  assert.strictEqual(await fetchProof(order.gcashPaymentProofUrl), 'first proof');

  // Rejected, then the customer uploads a new proof: the admin must see the new image.
  assert.strictEqual((await admin(order.id, 'reject-payment', { reason: 'Blurry screenshot.' })).statusCode, 200);
  const resubmitted = await post(customerToken, { action: 'customer-update', order: { id: order.id, gcashPaymentProof: png('second proof') } });
  assert.strictEqual(resubmitted.statusCode, 200, resubmitted.body);
  const adminView = body(await get(orders, adminToken)).orders.find(item => item.id === order.id);
  assert.strictEqual(adminView.paymentStatus, 'downpayment-received');
  assert.match(adminView.gcashPaymentProofUrl, /v=2/);
  assert.strictEqual(await fetchProof(adminView.gcashPaymentProofUrl), 'second proof', 'Admin still sees the old proof.');
  assert.deepStrictEqual(adminView.paymentProofs.map(proof => [proof.version, proof.status, proof.reason]), [[1, 'rejected', 'Blurry screenshot.'], [2, 'pending', '']]);
  assert.strictEqual(await fetchProof(adminView.paymentProofs[0].url), 'first proof', 'The rejected proof is kept.');
  const adminNotice = adminView.productionNotifications.filter(event => event.type === 'payment-proof').pop();
  assert.match(adminNotice.message, /new GCash payment proof/);

  // Another customer cannot open this proof with their own token.
  const stolen = await orderDesign({ httpMethod: 'GET', headers: { authorization: `Bearer ${otherToken}` }, queryStringParameters: { orderId: String(order.id), media: 'gcash-proof', v: '1' } });
  assert.strictEqual(stolen.statusCode, 403);

  // A proof for the balance waits until the downpayment is verified.
  const earlyBalanceProof = await post(customerToken, { action: 'customer-update', order: { id: order.id, balancePaymentProof: png('too early') } });
  assert.strictEqual(earlyBalanceProof.statusCode, 409, earlyBalanceProof.body);

  // Verify the downpayment: 50% recorded, half still due.
  const verified = await admin(order.id, 'verify-payment', { remarks: 'Received.', reference: '1234 567 890' });
  assert.strictEqual(verified.statusCode, 200, verified.body);
  let summary = body(verified).order.paymentSummary;
  assert.deepStrictEqual([summary.amountPaid, summary.balance, summary.standing], [5000, 5000, 'with-balance']);
  assert.strictEqual(body(verified).order.paymentProofs[1].status, 'verified');
  assert.strictEqual(body(verified).order.productionNotifications.filter(event => event.type === 'stage-update').pop().remarks, 'Received.');
  assert.strictEqual((await post(customerToken, { action: 'customer-update', order: { id: order.id, gcashPaymentProof: png('late') } })).statusCode, 409, 'A verified payment cannot be reset by a new upload.');

  // The customer pays part of the balance by GCash and sends a proof; the admin is told.
  const balanceUpload = await post(customerToken, { action: 'customer-update', order: { id: order.id, balancePaymentProof: png('balance proof 1') } });
  assert.strictEqual(balanceUpload.statusCode, 200, balanceUpload.body);
  let balanceOrder = body(balanceUpload).order;
  assert.strictEqual(balanceOrder.balanceProofStatus, 'pending');
  assert.strictEqual(balanceOrder.paymentStatus, 'verified', 'The verified downpayment stays verified.');
  assert.strictEqual(balanceOrder.balanceProofs[0].amountDue, 5000);
  assert.match(balanceOrder.balanceProofUrl, /media=balance-proof&v=1&access=/);
  assert.strictEqual(await fetchProof(balanceOrder.balanceProofUrl), 'balance proof 1');
  assert.match(balanceOrder.productionNotifications.filter(event => event.type === 'payment-proof').pop().message, /remaining balance of PHP 5,000\.00/);
  const stolenBalance = await orderDesign({ httpMethod: 'GET', headers: { authorization: `Bearer ${otherToken}` }, queryStringParameters: { orderId: String(order.id), media: 'balance-proof', v: '1' } });
  assert.strictEqual(stolenBalance.statusCode, 403);

  // Rejected with a reason, then a new proof, then verified for the amount actually received.
  assert.strictEqual((await admin(order.id, 'reject-balance-proof', {})).statusCode, 400);
  const balanceRejected = await admin(order.id, 'reject-balance-proof', { reason: 'Amount does not match.' });
  assert.strictEqual(balanceRejected.statusCode, 200, balanceRejected.body);
  assert.strictEqual(body(balanceRejected).order.balanceProofStatus, 'rejected');
  assert.match(body(balanceRejected).order.productionNotifications.pop().message, /proof for the balance was rejected\. Reason: Amount does not match\./);
  assert.strictEqual((await admin(order.id, 'verify-balance-proof', {})).statusCode, 409, 'A rejected proof cannot be verified.');
  const balanceUpload2 = await post(customerToken, { action: 'customer-update', order: { id: order.id, balancePaymentProof: png('balance proof 2') } });
  assert.strictEqual(balanceUpload2.statusCode, 200, balanceUpload2.body);
  assert.strictEqual(body(balanceUpload2).order.balanceProofVersion, 2);
  assert.strictEqual((await admin(order.id, 'verify-balance-proof', { amount: 6000 })).statusCode, 400);
  const balanceVerified = await admin(order.id, 'verify-balance-proof', { amount: 2000, reference: 'GC-555' });
  assert.strictEqual(balanceVerified.statusCode, 200, balanceVerified.body);
  balanceOrder = body(balanceVerified).order;
  assert.strictEqual(balanceOrder.balanceProofStatus, 'verified');
  assert.deepStrictEqual(balanceOrder.balanceProofs.map(proof => [proof.version, proof.status]), [[1, 'rejected'], [2, 'verified']]);
  const balancePayment = balanceOrder.payments[balanceOrder.payments.length - 1];
  assert.deepStrictEqual([balancePayment.type, balancePayment.method, balancePayment.amount, balancePayment.reference, balancePayment.proofVersion], ['balance', 'gcash', 2000, 'GC-555', 2]);
  assert.strictEqual(balanceOrder.paymentSummary.balance, 3000);
  assert.match(balanceOrder.productionNotifications.pop().message, /Remaining balance: PHP 3,000\.00/);

  // Record the balance: too much, then missing reference, then correct.
  assert.strictEqual((await admin(order.id, 'record-payment', { amount: 6000 })).statusCode, 400);
  assert.strictEqual((await admin(order.id, 'record-payment', { amount: 2000, method: 'gcash' })).statusCode, 400);
  assert.strictEqual((await post(customerToken, { action: 'admin-update', orderId: order.id, operation: 'record-payment', amount: 5000 })).statusCode, 403);
  const partBalance = await admin(order.id, 'record-payment', { amount: 2000, method: 'cash', note: 'Paid at the shop.' });
  assert.strictEqual(partBalance.statusCode, 200, partBalance.body);
  assert.strictEqual(body(partBalance).order.paymentSummary.balance, 1000);
  // A balance proof still waiting when the rest is paid another way is no longer needed.
  assert.strictEqual((await post(customerToken, { action: 'customer-update', order: { id: order.id, balancePaymentProof: png('balance proof 3') } })).statusCode, 200);
  const fullBalance = await admin(order.id, 'record-payment', { method: 'gcash', reference: 'REF-99' });
  summary = body(fullBalance).order.paymentSummary;
  assert.deepStrictEqual([summary.amountPaid, summary.balance, summary.standing], [10000, 0, 'fully-paid']);
  assert.strictEqual(body(fullBalance).order.balanceProofStatus, 'not-needed');
  assert.match(body(fullBalance).order.productionNotifications.pop().message, /fully paid/);
  assert.strictEqual((await admin(order.id, 'record-payment', {})).statusCode, 409);
  assert.strictEqual((await post(customerToken, { action: 'customer-update', order: { id: order.id, balancePaymentProof: png('too late') } })).statusCode, 409, 'No balance proof once fully paid.');

  // A pickup order with a cash downpayment of a custom amount.
  const pickup = body(await post(otherToken, { action: 'create', order: { id: 1794600000000, customerEmail: 'ben@example.com', customerName: 'Ben Cruz', paymentMethod: 'pickup', totalAmount: 900, items: [{ name: 'Shirt', price: 450, quantity: 2 }] } })).order;
  assert.strictEqual((await admin(pickup.id, 'verify-payment', { amount: 1000 })).statusCode, 400);
  assert.strictEqual(body(await admin(pickup.id, 'verify-payment', { amount: 300 })).order.paymentSummary.standing, 'partial-downpayment');

  // Legacy orders: verified counts as the downpayment, completed as fully paid.
  assert.strictEqual(getPaymentSummary({ totalAmount: 900, paymentStatus: 'verified', gcashDownpaymentAmount: 450 }).amountPaid, 450);
  assert.strictEqual(getPaymentSummary({ totalAmount: 900, productionStatus: 'completed' }).standing, 'fully-paid');
  assert.strictEqual(getPaymentSummary({ totalAmount: 900, paymentStatus: 'awaiting-proof' }).standing, 'downpayment-unpaid');
  assert.strictEqual(summarizeCustomerPayments([{ totalAmount: 500, status: 'cancelled' }]).standing, 'no-orders');

  // Customer list shows balances.
  const list = body(await get(customers, adminToken)).customers;
  const ana = list.find(customer => customer.accountEmail === 'ana@example.com');
  const ben = list.find(customer => customer.accountEmail === 'ben@example.com');
  assert.deepStrictEqual([ana.payment.standing, ana.payment.balance], ['fully-paid', 0]);
  assert.deepStrictEqual([ben.payment.standing, ben.payment.amountPaid, ben.payment.balance], ['downpayment-unpaid', 300, 600]);
  assert.strictEqual(ben.totalOrders, 1);

  // PDF reports come from saved data and can be verified.
  assert.strictEqual((await get(reports, customerToken, { type: 'sales' })).statusCode, 403);
  const salesPdf = await get(reports, adminToken, { type: 'sales', start: '2026-11-01', end: '2026-11-30' });
  assert.strictEqual(salesPdf.statusCode, 200, salesPdf.body);
  assert.strictEqual(salesPdf.headers['Content-Type'], 'application/pdf');
  const pdfText = Buffer.from(salesPdf.body, 'base64').toString('latin1');
  assert.ok(pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF'));
  assert.match(pdfText, /Sales Order Details/);
  assert.match(pdfText, /TOTAL SALES/);
  assert.match(pdfText, /PHP 10,900\.00/);
  const reportNo = salesPdf.headers['X-Report-Number'];
  const check = body(await get(reports, adminToken, { verify: reportNo }));
  assert.strictEqual(check.found, true);
  assert.strictEqual(check.report.rowCount, 2);
  assert.match(pdfText, new RegExp(check.report.fingerprint));
  assert.strictEqual(body(await get(reports, adminToken, { verify: 'RPT-20260101-000000-ABCD' })).found, false);
  assert.strictEqual((await get(reports, adminToken, { type: 'sales', start: 'bad' })).statusCode, 400);

  const customerPdf = await get(reports, adminToken, { type: 'customers', standing: 'downpayment-unpaid' });
  const customerText = Buffer.from(customerPdf.body, 'base64').toString('latin1');
  assert.match(customerText, /Ben Cruz/);
  assert.doesNotMatch(customerText, /Ana Reyes/);
  assert.strictEqual((await get(reports, adminToken, { type: 'history' })).statusCode, 200);

  console.log('payment and report tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
