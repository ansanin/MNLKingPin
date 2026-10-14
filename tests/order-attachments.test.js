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
    const orderIndexStore = blobModule.getStore('kingpin-order-index');
    await ordersStore.setJSON('orders', [{
        id: 100,
        customerEmail: 'legacy@example.com',
        status: 'pending',
        items: [{
            id: 1,
            type: 'custom-design',
            designType: 'uploaded',
            details: { uploadedFile: imageData, fileName: 'legacy.webp', fileType: 'image/webp' }
        }]
    }]);
    await ordersStore.setJSON('orders-v2', [{
        id: 150,
        customerEmail: 'previous-release@example.com',
        status: 'pending',
        items: [{ id: 3, type: 'custom-design', designType: 'custom', name: 'Previous release custom design' }]
    }]);

    const response = await ordersHandler({
        httpMethod: 'POST',
        body: JSON.stringify({
            id: 200,
            customerEmail: 'customer@example.com',
            status: 'pending',
            items: [{
                id: 2,
                type: 'custom-design',
                designType: 'uploaded',
                details: { uploadedFile: imageData, fileName: 'design.webp', fileType: 'image/webp' }
            }]
        })
    });

    assert.strictEqual(response.statusCode, 200);
    const legacyOrders = await ordersStore.get('orders', { type: 'json' });
    const storedOrders = await orderIndexStore.get('orders', { type: 'json' });
    assert.strictEqual(legacyOrders.length, 1);
    assert.ok(legacyOrders[0].items[0].details.uploadedFile);
    assert.strictEqual(storedOrders.length, 1);
    assert.ok(storedOrders[0].items[0].details.uploadedFileUrl);

    const activeResponse = await ordersHandler({ httpMethod: 'GET', queryStringParameters: { scope: 'active' } });
    const firstActiveOrders = JSON.parse(activeResponse.body).orders;
    assert.strictEqual(firstActiveOrders.length, 1);
    assert.strictEqual(firstActiveOrders[0].id, 200);

    const historyResponse = await ordersHandler({ httpMethod: 'GET' });
    const savedOrders = JSON.parse(historyResponse.body).orders;
    assert.strictEqual(savedOrders.length, 3);
    assert.ok(savedOrders.find(order => order.id === 100).items[0].details.uploadedFileUrl);
    assert.ok(savedOrders.find(order => order.id === 200).items[0].details.uploadedFileUrl);
    assert.strictEqual((await orderIndexStore.get('orders', { type: 'json' })).length, 3);

    const cachedActiveResponse = await ordersHandler({ httpMethod: 'GET', queryStringParameters: { scope: 'active' } });
    const activeOrders = JSON.parse(cachedActiveResponse.body).orders;
    assert.strictEqual(activeOrders.length, 3);
    assert.ok(activeOrders.every(order => order.status === 'pending'));
    assert.ok(activeOrders.find(order => order.id === 100).items[0].details.uploadedFileUrl);
    assert.ok(activeOrders.find(order => order.id === 200).items[0].details.uploadedFileUrl);

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