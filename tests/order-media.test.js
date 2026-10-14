const assert = require('assert');
const { getOrderMediaSource, getUploadedDesignImageSource } = require('../js/order-media.js');

const orderId = 1234;
const ticket = 'header.payload.signature';
const proofUrl = `/.netlify/functions/order-design?orderId=${orderId}&media=gcash-proof&access=${ticket}`;
const designUrl = `/.netlify/functions/order-design?orderId=${orderId}&itemIndex=0&access=${ticket}`;

assert.strictEqual(getOrderMediaSource({ id: orderId, gcashPaymentProofUrl: proofUrl }, 'gcashPaymentProof'), proofUrl);
assert.strictEqual(getOrderMediaSource({ id: orderId, gcashQRCodeUrl: proofUrl }, 'gcashQRCode'), '');
assert.strictEqual(getOrderMediaSource({ id: orderId + 1, gcashPaymentProofUrl: proofUrl }, 'gcashPaymentProof'), '');
assert.strictEqual(getOrderMediaSource({ id: orderId, gcashPaymentProofUrl: proofUrl.replace(`&access=${ticket}`, '') }, 'gcashPaymentProof'), '');
assert.strictEqual(getUploadedDesignImageSource({
  designType: 'uploaded',
  details: { uploadedFileUrl: designUrl }
}, orderId, 0), designUrl);
assert.strictEqual(getUploadedDesignImageSource({
  designType: 'uploaded',
  details: { uploadedFileUrl: designUrl }
}, orderId, 1), '');
assert.strictEqual(getOrderMediaSource({ id: orderId, gcashPaymentProof: 'data:image/png;base64,AA==' }, 'gcashPaymentProof'), 'data:image/png;base64,AA==');

console.log('order media tests passed');