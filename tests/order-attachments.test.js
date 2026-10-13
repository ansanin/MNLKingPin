const assert = require('assert');

const blobStores = new Map();
const blobModulePath = require.resolve('@netlify/blobs');
const blobModule = {
    connectLambda() {},
    getStore(name) {
        if (!blobStores.has(name)) blobStores.set(name, new Map());
        const entries = blobStores.get(name);
        return {
            async get(key) {
                return entries.has(key) ? entries.get(key) : null;
            },
            async set(key, value) {
                entries.set(key, value);
            },
            async setJSON(key, value) {
                entries.set(key, value);
            }
        };
    }
};

require.cache[blobModulePath] = {
    id: blobModulePath,
    filename: blobModulePath,
    loaded: true,
    exports: blobModule
};

const { handler: ordersHandler } = require('../netlify/functions/orders.js');
const { handler: orderDesignHandler } = require('../netlify/functions/order-design.js');

async function testOrderDesignAttachments() {
    const imageData = `data:image/webp;base64,${Buffer.from('sample design').toString('base64')}`;
    const ordersStore = blobModule.getStore('kingpin-orders');
    await ordersStore.setJSON('orders', [{
        id: 100,
        customerEmail: 'legacy@example.com',
        items: [{
            id: 1,
            type: 'custom-design',
            designType: 'uploaded',
            details: { uploadedFile: imageData, fileName: 'legacy.webp', fileType: 'image/webp' }
        }]
    }]);

    const response = await ordersHandler({
        httpMethod: 'POST',
        body: JSON.stringify({
            id: 200,
            customerEmail: 'customer@example.com',
            items: [{
                id: 2,
                type: 'custom-design',
                designType: 'uploaded',
                details: { uploadedFile: imageData, fileName: 'design.webp', fileType: 'image/webp' }
            }]
        })
    });

    assert.strictEqual(response.statusCode, 200);
    const savedOrders = await ordersStore.get('orders', { type: 'json' });
    assert.strictEqual(savedOrders.length, 2);
    assert.ok(savedOrders.every(order => order.items[0].details.uploadedFile === undefined));
    assert.ok(savedOrders.every(order => order.items[0].details.uploadedFileUrl));

    const imageResponse = await orderDesignHandler({
        httpMethod: 'GET',
        queryStringParameters: { orderId: '200', itemIndex: '0' }
    });
    assert.strictEqual(imageResponse.statusCode, 200);
    assert.strictEqual(imageResponse.headers['Content-Type'], 'image/webp');
    assert.strictEqual(Buffer.from(imageResponse.body, 'base64').toString(), 'sample design');

    console.log('order attachment tests passed');
}

testOrderDesignAttachments().catch(error => {
    console.error(error);
    process.exitCode = 1;
});