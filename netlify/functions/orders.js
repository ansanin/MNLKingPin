const { connectLambda, getStore } = require('@netlify/blobs');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function uploadedDesignKey(orderId, itemIndex) {
    return `order-design-${orderId}-${itemIndex}`;
}

async function removeInlineDesignFiles(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [itemIndex, item] of (normalized.items || []).entries()) {
        if (item.designType !== 'uploaded' || !item.details) continue;

        const uploadedFile = String(item.details.uploadedFile || '');
        const match = uploadedFile.match(/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([a-z0-9+/=]+)$/i);
        if (!match) continue;

        const orderId = String(normalized.id);
        await designStore.set(uploadedDesignKey(orderId, itemIndex), uploadedFile);
        item.details.uploadedFileUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&itemIndex=${itemIndex}`;
        delete item.details.uploadedFile;
        changed = true;
    }

    return { order: normalized, changed };
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-orders');
        const designStore = getStore('kingpin-order-designs');
        let orders = (await store.get('orders', { type: 'json' })) || [];

        if (event.httpMethod === 'GET') {
            const normalizedOrders = await Promise.all(orders.map(order => removeInlineDesignFiles(order, designStore)));
            orders = normalizedOrders.map(result => result.order);
            if (normalizedOrders.some(result => result.changed)) {
                await store.setJSON('orders', orders);
            }
            return jsonResponse(200, { orders });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const order = JSON.parse(event.body || '{}');
        if (!order.id || !order.customerEmail) return jsonResponse(400, { error: 'A valid order is required' });
        const normalizedOrders = await Promise.all(orders.map(savedOrder => removeInlineDesignFiles(savedOrder, designStore)));
        orders = normalizedOrders.map(result => result.order);
        const normalizedOrder = (await removeInlineDesignFiles(order, designStore)).order;
        const existingIndex = orders.findIndex(savedOrder => String(savedOrder.id) === String(normalizedOrder.id));
        if (existingIndex >= 0) {
            orders[existingIndex] = normalizedOrder;
        } else {
            orders.push(normalizedOrder);
        }
        await store.setJSON('orders', orders.slice(-500));
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};