const { connectLambda, getStore } = require('@netlify/blobs');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-orders');
        const orders = (await store.get('orders', { type: 'json' })) || [];

        if (event.httpMethod === 'GET') return jsonResponse(200, { orders });
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const order = JSON.parse(event.body || '{}');
        if (!order.id || !order.customerEmail) return jsonResponse(400, { error: 'A valid order is required' });
        const existingIndex = orders.findIndex(savedOrder => String(savedOrder.id) === String(order.id));
        if (existingIndex >= 0) {
            orders[existingIndex] = order;
        } else {
            orders.push(order);
        }
        await store.setJSON('orders', orders.slice(-500));
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};