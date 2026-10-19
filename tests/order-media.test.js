const assert = require('assert');
const { getOrderMediaSource, getUploadedDesignImageSource, getUploadedDesignImageSources } = require('../js/order-media.js');

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
const secondDesignUrl = `/.netlify/functions/order-design?orderId=${orderId}&itemIndex=0&fileIndex=1&access=${ticket}`;
assert.deepStrictEqual(getUploadedDesignImageSources({
  designType: 'uploaded',
  details: { uploadedFiles: [
    { uploadedFileUrl: `/.netlify/functions/order-design?orderId=${orderId}&itemIndex=0&fileIndex=0&access=${ticket}` },
    { uploadedFileUrl: secondDesignUrl }
  ] }
}, orderId, 0), [
  `/.netlify/functions/order-design?orderId=${orderId}&itemIndex=0&fileIndex=0&access=${ticket}`,
  secondDesignUrl
]);
assert.deepStrictEqual(getUploadedDesignImageSources({
  designType: 'uploaded',
  details: { uploadedFiles: [
    { uploadedFile: 'data:image/png;base64,AA==' },
    { uploadedFile: 'data:application/pdf;base64,AA==' }
  ] }
}, orderId, 0), ['data:image/png;base64,AA==']);
assert.strictEqual(getOrderMediaSource({ id: orderId, gcashPaymentProof: 'data:image/png;base64,AA==' }, 'gcashPaymentProof'), 'data:image/png;base64,AA==');

console.log('order media tests passed');