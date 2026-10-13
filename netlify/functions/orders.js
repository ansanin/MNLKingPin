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

async function getLegacyActiveOrders(store, designStore) {
    const cachedOrders = await store.get('legacy-active-orders', { type: 'json' });
    if (Array.isArray(cachedOrders)) return cachedOrders;

    const legacyOrders = (await store.get('orders', { type: 'json' })) || [];
    const activeOrders = legacyOrders.filter(isActiveOrder);
    const normalizedOrders = await Promise.all(activeOrders.map(order => removeInlineDesignFiles(order, designStore)));
    const compactOrders = normalizedOrders.map(result => result.order);
    await store.setJSON('legacy-active-orders', compactOrders);
    return compactOrders;
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-orders');
        const designStore = getStore('kingpin-order-designs');

        if (event.httpMethod === 'GET') {
            const activeOnly = event.queryStringParameters?.scope === 'active';
            const indexedOrders = (await store.get('orders-v2', { type: 'json' })) || [];
            if (activeOnly) {
                const legacyActiveOrders = await getLegacyActiveOrders(store, designStore);
                const orderById = new Map(legacyActiveOrders.map(order => [String(order.id), order]));
                indexedOrders.forEach(order => orderById.set(String(order.id), order));
                const activeOrders = Array.from(orderById.values()).filter(isActiveOrder);
                return jsonResponse(200, { orders: activeOrders });
            }

            const legacyOrders = (await store.get('orders', { type: 'json' })) || [];
            const orderById = new Map(legacyOrders.map(order => [String(order.id), order]));
            indexedOrders.forEach(order => orderById.set(String(order.id), order));
            const selectedOrders = Array.from(orderById.values());
            const normalizedOrders = await Promise.all(selectedOrders.map(order => removeInlineDesignFiles(order, designStore)));
            const responseOrders = normalizedOrders.map(result => result.order);
            return jsonResponse(200, { orders: responseOrders });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const order = JSON.parse(event.body || '{}');
        if (!order.id || !order.customerEmail) return jsonResponse(400, { error: 'A valid order is required' });
        const orders = (await store.get('orders-v2', { type: 'json' })) || [];
        const normalizedOrder = (await removeInlineDesignFiles(order, designStore)).order;
        const existingIndex = orders.findIndex(savedOrder => String(savedOrder.id) === String(normalizedOrder.id));
        if (existingIndex >= 0) {
            orders[existingIndex] = normalizedOrder;
        } else {
            orders.push(normalizedOrder);
        }
        await store.setJSON('orders-v2', orders.slice(-500));
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};