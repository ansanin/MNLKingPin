const assert = require('assert');
const {
  normalizeProductionStatus,
  validateProductionTransition
} = require('../js/production-tracking.js');

assert.strictEqual(normalizeProductionStatus({ status: 'pending' }), 'order-placed');
assert.strictEqual(normalizeProductionStatus({ status: 'processing' }), 'printing');
assert.strictEqual(normalizeProductionStatus({ status: 'ready-for-delivery' }), 'ready-for-release');
assert.strictEqual(normalizeProductionStatus({ status: 'delivered' }), 'completed');

const placedOrder = { status: 'pending', paymentStatus: 'awaiting-proof' };
assert.strictEqual(validateProductionTransition(placedOrder, 'payment-verification').ok, true);
assert.strictEqual(validateProductionTransition(placedOrder, 'printing').ok, false);
assert.strictEqual(validateProductionTransition(placedOrder, 'order-placed').ok, false);
assert.strictEqual(validateProductionTransition(placedOrder, 'cancelled').ok, true);

const verifiedOrder = {
  productionStatus: 'payment-verification',
  paymentStatus: 'verified',
  finalDesignUrl: '/final-design'
};
assert.strictEqual(validateProductionTransition(verifiedOrder, 'design-approval').ok, true);
assert.strictEqual(validateProductionTransition(verifiedOrder, 'printing').ok, false);
assert.strictEqual(validateProductionTransition({
  ...verifiedOrder,
  productionStatus: 'design-approval',
  designApproval: { status: 'approved' }
}, 'printing').ok, true);
assert.strictEqual(validateProductionTransition({
  ...verifiedOrder,
  productionStatus: 'on-hold',
  previousProductionStatus: 'payment-verification'
}, 'payment-verification').ok, true);

console.log('production-tracking tests passed');