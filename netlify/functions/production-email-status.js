const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');
function reply(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }; }
exports.handler = async event => {
    connectLambda(event);
    if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed.' });
    const auth = authenticateEvent(event);
    if (!auth.ok) return reply(auth.statusCode, { error: auth.error });
    if (auth.claims.role !== 'admin') return reply(403, { error: 'Admin access required.' });
    const orderId = String(event.queryStringParameters?.orderId || '');
    if (!/^\d{1,30}$/.test(orderId)) return reply(400, { error: 'A valid order number is required.' });
    try {
        const order = await getStore('kingpin-order-index').get(`order-${orderId}`, { type: 'json' });
        if (!order) return reply(404, { error: 'Order not found.' });
        const statuses = getStore('kingpin-production-email-status');
        const events = (Array.isArray(order.productionNotifications) ? order.productionNotifications : []).filter(item => item.type === 'stage-update').slice(-10);
        const deliveries = await Promise.all(events.map(async item => {
            const id = String(item.id || '');
            const sent = await statuses.get(`sent-${orderId}-${id}`, { type: 'json' });
            const failed = await statuses.get(`failed-${orderId}-${id}`, { type: 'json' });
            return { eventId: id, stage: item.statusLabel || item.status, timestamp: item.timestamp, state: sent ? 'provider_accepted' : failed ? 'failed' : 'unknown', reason: sent ? undefined : failed?.reason };
        }));
        return reply(200, { configured: Boolean((process.env.SMTP_USER && process.env.SMTP_PASS) || (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)), deliveries });
    } catch (error) { console.error('Unable to check production email status:', error); return reply(500, { error: 'Unable to check email status.' }); }
};
