const assert = require('assert');

process.env.KINGPIN_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';

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
const { signAccessToken } = require('../netlify/functions/lib/auth.js');
const adminToken = signAccessToken({ sub: 'shop-admin', role: 'admin' });
const customerToken = signAccessToken({ sub: 'customer@example.com', role: 'customer' });

async function testOrderDesignAttachments() {
    const imageData = `data:image/webp;base64,${Buffer.from('sample design').toString('base64')}`;
    const secondImageData = `data:image/png;base64,${Buffer.from('second design').toString('base64')}`;
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
            image: imageData,
            images: [imageData],
            details: { uploadedFile: imageData, fileName: 'legacy.webp', fileType: 'image/webp' }
        }],
        gcashQRCode: imageData,
        gcashPaymentProof: imageData
    }]);
    await ordersStore.setJSON('orders-v2', [{
        id: 150,
        customerEmail: 'previous-release@example.com',
        status: 'pending',
        items: [{ id: 3, type: 'custom-design', designType: 'custom', name: 'Previous release custom design' }]
    }]);

    const response = await ordersHandler({
        httpMethod: 'POST',
        headers: { authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ action: 'create', order: {
            id: 200,
            customerEmail: 'customer@example.com',
            status: 'pending',
            items: [{
                id: 2,
                type: 'custom-design',
                designType: 'uploaded',
                image: imageData,
                images: [imageData],
                details: {
                    uploadedFile: imageData,
                    uploadedFiles: [
                        { uploadedFile: imageData, fileName: 'front.webp', fileType: 'image/webp' },
                        { uploadedFile: secondImageData, fileName: 'back.png', fileType: 'image/png' }
                    ],
                    fileName: 'front.webp, back.png',
                    fileType: 'image/webp'
                }
                }],
                paymentMethod: 'gcash',
                gcashDownpaymentAmount: 500,
                gcashQRCode: imageData,
                gcashPaymentProof: imageData
        } })
    });

    assert.strictEqual(response.statusCode, 201);
    const legacyOrders = await ordersStore.get('orders', { type: 'json' });
    const storedOrder = await orderIndexStore.get('order-200', { type: 'json' });
    assert.strictEqual(legacyOrders.length, 1);
    assert.ok(legacyOrders[0].items[0].details.uploadedFile);
    assert.ok(storedOrder.items[0].details.uploadedFileUrl);
    assert.strictEqual(storedOrder.items[0].details.uploadedFiles.length, 2);
    assert.ok(storedOrder.items[0].details.uploadedFiles[1].uploadedFileUrl.includes('fileIndex=1'));
    assert.ok(storedOrder.gcashQRCodeUrl);
    assert.ok(storedOrder.gcashPaymentProofUrl);
    assert.strictEqual(storedOrder.paymentStatus, 'downpayment-received');
    assert.strictEqual(storedOrder.gcashDownpaymentAmount, 500);
    // A fresh customer session and the admin both retrieve the persisted checkout proof.
    for (const token of [customerToken, adminToken]) {
        const refreshed = await ordersHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
        const order = JSON.parse(refreshed.body).orders.find(item => item.id === 200);
        assert.ok(order.gcashPaymentProofUrl);
        assert.strictEqual(order.gcashDownpaymentAmount, 500);
        const proofUrl = new URL(order.gcashPaymentProofUrl, 'https://kingpin.example');
        const proofResponse = await orderDesignHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: Object.fromEntries(proofUrl.searchParams) });
        assert.strictEqual(proofResponse.statusCode, 200);
        assert.strictEqual(Buffer.from(proofResponse.body, 'base64').toString(), 'sample design');
    }
    assert.strictEqual(storedOrder.gcashQRCode, undefined);
    assert.strictEqual(storedOrder.gcashPaymentProof, undefined);
    assert.strictEqual(storedOrder.items[0].image, undefined);
    assert.deepStrictEqual(storedOrder.items[0].images, []);
    assert.deepStrictEqual(await orderIndexStore.get('active-order-ids', { type: 'json' }), [100, 150, 200]);

    const activeResponse = await ordersHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { scope: 'active' } });
    const firstActiveOrders = JSON.parse(activeResponse.body).orders;
    assert.strictEqual(firstActiveOrders.length, 3);
    assert.ok(firstActiveOrders.some(order => order.id === 200));

    const historyResponse = await ordersHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` } });
    const savedOrders = JSON.parse(historyResponse.body).orders;
    assert.strictEqual(savedOrders.length, 3);
    assert.ok(savedOrders.find(order => order.id === 100).items[0].details.uploadedFileUrl);
    assert.ok(savedOrders.find(order => order.id === 200).items[0].details.uploadedFileUrl);
    assert.ok(savedOrders.find(order => order.id === 100).gcashQRCodeUrl);
    assert.ok(savedOrders.find(order => order.id === 100).gcashPaymentProofUrl);
    assert.strictEqual(savedOrders.find(order => order.id === 100).items[0].image, undefined);
    assert.deepStrictEqual(savedOrders.find(order => order.id === 100).items[0].images, []);
    assert.strictEqual((await orderIndexStore.get('order-100', { type: 'json' })).id, 100);
    assert.strictEqual((await orderIndexStore.get('order-150', { type: 'json' })).id, 150);
    assert.deepStrictEqual(await orderIndexStore.get('active-order-ids', { type: 'json' }), [100, 150, 200]);

    const cachedActiveResponse = await ordersHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${adminToken}` }, queryStringParameters: { scope: 'active' } });
    const activeOrders = JSON.parse(cachedActiveResponse.body).orders;
    assert.strictEqual(activeOrders.length, 3);
    assert.ok(activeOrders.every(order => order.status === 'pending'));
    assert.ok(activeOrders.find(order => order.id === 100).items[0].details.uploadedFileUrl);
    assert.ok(activeOrders.find(order => order.id === 200).items[0].details.uploadedFileUrl);

    const customerOrder = firstActiveOrders.find(order => order.id === 200);
    const designUrl = new URL(customerOrder.items[0].details.uploadedFileUrl, 'https://kingpin.example');
    const imageResponse = await orderDesignHandler({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: Object.fromEntries(designUrl.searchParams)
    });
    assert.strictEqual(imageResponse.statusCode, 200);
    assert.strictEqual(imageResponse.headers['Content-Type'], 'image/webp');
    assert.strictEqual(Buffer.from(imageResponse.body, 'base64').toString(), 'sample design');

    const secondDesignUrl = new URL(customerOrder.items[0].details.uploadedFiles[1].uploadedFileUrl, 'https://kingpin.example');
    const secondImageResponse = await orderDesignHandler({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: Object.fromEntries(secondDesignUrl.searchParams)
    });
    assert.strictEqual(secondImageResponse.statusCode, 200);
    assert.strictEqual(Buffer.from(secondImageResponse.body, 'base64').toString(), 'second design');

    const proofUrl = new URL(customerOrder.gcashPaymentProofUrl, 'https://kingpin.example');
    const proofResponse = await orderDesignHandler({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: Object.fromEntries(proofUrl.searchParams)
    });
    assert.strictEqual(proofResponse.statusCode, 200);
    assert.strictEqual(Buffer.from(proofResponse.body, 'base64').toString(), 'sample design');

    const qrUrl = new URL(customerOrder.gcashQRCodeUrl, 'https://kingpin.example');
    const qrResponse = await orderDesignHandler({
        httpMethod: 'GET',
        headers: {},
        queryStringParameters: Object.fromEntries(qrUrl.searchParams)
    });
    assert.strictEqual(qrResponse.statusCode, 200);
    assert.strictEqual(Buffer.from(qrResponse.body, 'base64').toString(), 'sample design');

    const undersizedTeamOrder = await ordersHandler({
        httpMethod: 'POST',
        headers: { authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ action: 'create', order: {
            id: 201,
            customerEmail: 'customer@example.com',
            items: [{ price: 600, quantity: 1 }],
            teamOrder: { isTeamOrder: true, teamName: 'Team Alpha', teamType: 'Basketball', totalPlayers: 4, teamNotes: 'Player sizes listed.' }
        } })
    });
    assert.strictEqual(undersizedTeamOrder.statusCode, 400);

    const validTeamOrder = await ordersHandler({
        httpMethod: 'POST',
        headers: { authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ action: 'create', order: {
            id: 202,
            customerEmail: 'customer@example.com',
            items: [{ price: 600, quantity: 1 }],
            teamOrder: { isTeamOrder: true, teamName: 'Team Alpha', teamType: 'Basketball', totalPlayers: 5, teamNotes: 'Player sizes listed.' }
        } })
    });
    assert.strictEqual(validTeamOrder.statusCode, 201);
    assert.strictEqual(JSON.parse(validTeamOrder.body).order.totalAmount, 3000);

    console.log('order attachment tests passed');
}

testOrderDesignAttachments().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
