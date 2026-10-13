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
    const orderId = String(event.queryStringParameters?.orderId || '');
    const itemIndex = String(event.queryStringParameters?.itemIndex || '');
    if (!/^\d+$/.test(orderId) || !/^\d+$/.test(itemIndex)) {
        return jsonResponse(400, { error: 'A valid order design is required' });
    }

    try {
        const store = getStore('kingpin-order-designs');
        const dataUrl = await store.get(`order-design-${orderId}-${itemIndex}`, { type: 'text' });
        const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([a-z0-9+/=]+)$/i);
        if (!match) return jsonResponse(404, { error: 'Order design not found' });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': match[1],
                'Cache-Control': 'private, max-age=300',
                'X-Content-Type-Options': 'nosniff'
            },
            isBase64Encoded: true,
            body: match[2]
        };
    } catch (error) {
        console.error('Netlify order design function error:', error);
        return jsonResponse(500, { error: 'Unable to load order design' });
    }
};