const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent, verifyAccessToken } = require('./lib/auth');

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
    const mediaType = String(event.queryStringParameters?.media || '');
    const accessTicket = String(event.queryStringParameters?.access || '');
    const isOrderMedia = ['gcash-qr', 'gcash-proof', 'final-design'].includes(mediaType);
    if (!/^\d+$/.test(orderId) || (!isOrderMedia && !/^\d+$/.test(itemIndex))) {
        return jsonResponse(400, { error: 'A valid order design is required' });
    }

    try {
        const ticketClaims = accessTicket ? verifyAccessToken(accessTicket) : null;
        const authentication = ticketClaims
            ? { ok: true, claims: ticketClaims }
            : authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        const { claims } = authentication;
        if (ticketClaims && (
            String(ticketClaims.mediaOrderId) !== orderId
            || ticketClaims.media !== (isOrderMedia ? mediaType : 'item-design')
            || (!isOrderMedia && String(ticketClaims.itemIndex) !== itemIndex)
        )) return jsonResponse(403, { error: 'This media ticket does not grant access to the requested file.' });

        const orderStore = getStore('kingpin-order-index');
        const legacyStore = getStore('kingpin-orders');
        let order = await orderStore.get(`order-${orderId}`, { type: 'json' });
        if (!order) {
            const legacySources = [
                (await legacyStore.get('orders', { type: 'json' })) || [],
                (await legacyStore.get('orders-v2', { type: 'json' })) || [],
                (await orderStore.get('orders', { type: 'json' })) || []
            ];
            order = legacySources.flat().find(item => String(item.id) === orderId) || null;
        }
        if (!order) return jsonResponse(404, { error: 'Order not found' });
        if (claims.role !== 'admin' && String(order.customerEmail || '').toLowerCase() !== String(claims.sub).toLowerCase()) {
            return jsonResponse(403, { error: 'You can only access files for your own orders.' });
        }

        const store = getStore('kingpin-order-designs');
        const key = mediaType === 'final-design'
            ? `order-final-design-${orderId}`
            : isOrderMedia ? `order-media-${orderId}-${mediaType}` : `order-design-${orderId}-${itemIndex}`;
        const dataUrl = await store.get(key, { type: 'text' });
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