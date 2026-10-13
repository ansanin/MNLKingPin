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
        const designKey = uploadedDesignKey(orderId, itemIndex);
        const savedDesign = await designStore.get(designKey, { type: 'text' });
        if (!savedDesign) await designStore.set(designKey, uploadedFile);
        item.details.uploadedFileUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&itemIndex=${itemIndex}`;
        delete item.details.uploadedFile;
        changed = true;
    }

    return { order: normalized, changed };
}

function isActiveOrder(order) {
    return !['completed', 'delivered', 'cancelled'].includes(String(order.status || '').toLowerCase());
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-orders');
        const orderIndexStore = getStore('kingpin-order-index');
        const designStore = getStore('kingpin-order-designs');

        if (event.httpMethod === 'GET') {
            const activeOnly = event.queryStringParameters?.scope === 'active';
            const indexedOrders = (await orderIndexStore.get('orders', { type: 'json' })) || [];
            if (activeOnly) {
                const activeOrders = indexedOrders.filter(isActiveOrder);
                return jsonResponse(200, { orders: activeOrders });
            }

            const legacyOrders = (await store.get('orders', { type: 'json' })) || [];
            const previousIndexedOrders = (await store.get('orders-v2', { type: 'json' })) || [];
            const orderById = new Map(legacyOrders.map(order => [String(order.id), order]));
            previousIndexedOrders.forEach(order => orderById.set(String(order.id), order));
            indexedOrders.forEach(order => orderById.set(String(order.id), order));
            const selectedOrders = Array.from(orderById.values());
            const normalizedOrders = await Promise.all(selectedOrders.map(order => removeInlineDesignFiles(order, designStore)));
            const responseOrders = normalizedOrders.map(result => result.order);
            await orderIndexStore.setJSON('orders', responseOrders);
            return jsonResponse(200, { orders: responseOrders });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const order = JSON.parse(event.body || '{}');
        if (!order.id || !order.customerEmail) return jsonResponse(400, { error: 'A valid order is required' });
        const orders = (await orderIndexStore.get('orders', { type: 'json' })) || [];
        const normalizedOrder = (await removeInlineDesignFiles(order, designStore)).order;
        const existingIndex = orders.findIndex(savedOrder => String(savedOrder.id) === String(normalizedOrder.id));
        if (existingIndex >= 0) {
            orders[existingIndex] = normalizedOrder;
        } else {
            orders.push(normalizedOrder);
        }
        await orderIndexStore.setJSON('orders', orders.slice(-500));
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};