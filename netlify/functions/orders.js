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

function orderMediaKey(orderId, mediaType) {
    return `order-media-${orderId}-${mediaType}`;
}

async function removeInlineOrderMedia(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [field, mediaType] of [['gcashQRCode', 'gcash-qr'], ['gcashPaymentProof', 'gcash-proof']]) {
        const dataUrl = String(normalized[field] || '');
        const match = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=]+)$/i);
        if (!match) continue;

        const orderId = String(normalized.id);
        const key = orderMediaKey(orderId, mediaType);
        const savedMedia = await designStore.get(key, { type: 'text' });
        if (!savedMedia) await designStore.set(key, dataUrl);
        normalized[`${field}Url`] = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&media=${mediaType}`;
        delete normalized[field];
        changed = true;
    }

    return { order: normalized, changed };
}

async function removeInlineDesignFiles(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [itemIndex, item] of (normalized.items || []).entries()) {
        for (const imageField of ['image', 'productImage', 'sizeChartImage']) {
            if (typeof item[imageField] === 'string' && item[imageField].startsWith('data:')) {
                delete item[imageField];
                changed = true;
            }
        }
        if (Array.isArray(item.images)) {
            const filteredImages = item.images.filter(image => !(typeof image === 'string' && image.startsWith('data:')));
            if (filteredImages.length !== item.images.length) {
                item.images = filteredImages;
                changed = true;
            }
        }

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

    const mediaResult = await removeInlineOrderMedia(normalized, designStore);
    return { order: mediaResult.order, changed: changed || mediaResult.changed };
}

function isActiveOrder(order) {
    return !['completed', 'delivered', 'cancelled'].includes(String(order.status || '').toLowerCase());
}

function orderRecordKey(orderId) {
    return `order-${String(orderId)}`;
}

async function readOrderRecords(store, orderIds) {
    const records = await Promise.all(orderIds.map(orderId => store.get(orderRecordKey(orderId), { type: 'json' })));
    return records.filter(order => order && order.id);
}

async function writeOrderRecord(store, order) {
    await store.setJSON(orderRecordKey(order.id), order);

    const allOrderIds = (await store.get('all-order-ids', { type: 'json' })) || [];
    if (!allOrderIds.some(orderId => String(orderId) === String(order.id))) allOrderIds.push(order.id);
    const retainedOrderIds = allOrderIds.slice(-500);
    await store.setJSON('all-order-ids', retainedOrderIds);

    const activeOrderIds = (await store.get('active-order-ids', { type: 'json' })) || [];
    const nextActiveOrderIds = activeOrderIds.filter(orderId =>
        String(orderId) !== String(order.id) && retainedOrderIds.some(retainedId => String(retainedId) === String(orderId))
    );
    if (isActiveOrder(order)) nextActiveOrderIds.push(order.id);
    await store.setJSON('active-order-ids', nextActiveOrderIds.slice(-500));
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
            if (activeOnly) {
                const activeOrderIds = (await orderIndexStore.get('active-order-ids', { type: 'json' })) || [];
                const activeOrders = await readOrderRecords(orderIndexStore, activeOrderIds);
                const normalizedOrders = await Promise.all(activeOrders.map(order => removeInlineDesignFiles(order, designStore)));
                const responseOrders = normalizedOrders.map(result => result.order).filter(isActiveOrder);
                await Promise.all(normalizedOrders
                    .filter(result => result.changed)
                    .map(result => orderIndexStore.setJSON(orderRecordKey(result.order.id), result.order)));
                return jsonResponse(200, { orders: responseOrders });
            }

            const legacyOrders = (await store.get('orders', { type: 'json' })) || [];
            const previousIndexedOrders = (await store.get('orders-v2', { type: 'json' })) || [];
            const previousArrayIndex = (await orderIndexStore.get('orders', { type: 'json' })) || [];
            const existingOrderIds = (await orderIndexStore.get('all-order-ids', { type: 'json' })) || [];
            const existingIndexedOrders = await readOrderRecords(orderIndexStore, existingOrderIds);
            const orderById = new Map(legacyOrders.map(order => [String(order.id), order]));
            previousIndexedOrders.forEach(order => orderById.set(String(order.id), order));
            previousArrayIndex.forEach(order => orderById.set(String(order.id), order));
            existingIndexedOrders.forEach(order => orderById.set(String(order.id), order));
            const selectedOrders = Array.from(orderById.values());
            const normalizedOrders = await Promise.all(selectedOrders.map(order => removeInlineDesignFiles(order, designStore)));
            const responseOrders = normalizedOrders.map(result => result.order);
            const retainedOrders = responseOrders.slice(-500);
            await Promise.all(retainedOrders.map(order => orderIndexStore.setJSON(orderRecordKey(order.id), order)));
            await orderIndexStore.setJSON('all-order-ids', retainedOrders.map(order => order.id));
            await orderIndexStore.setJSON('active-order-ids', retainedOrders.filter(isActiveOrder).map(order => order.id));
            return jsonResponse(200, { orders: responseOrders });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const order = JSON.parse(event.body || '{}');
        if (!order.id || !order.customerEmail) return jsonResponse(400, { error: 'A valid order is required' });
        const normalizedOrder = (await removeInlineDesignFiles(order, designStore)).order;
        await writeOrderRecord(orderIndexStore, normalizedOrder);
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};