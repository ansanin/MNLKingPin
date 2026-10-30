const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');

const response = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async event => {
    if (event.httpMethod !== 'GET') return response(405, { error: 'Method not allowed.' });
    const auth = authenticateEvent(event);
    if (!auth.ok) return response(auth.statusCode, { error: auth.error });
    if (auth.claims.role !== 'admin') return response(403, { error: 'Admin access required.' });
    try {
        connectLambda(event);
        const accounts = getStore('kingpin-auth');
        const legacy = getStore('kingpin-orders');
        const index = getStore('kingpin-order-index');
        let cursor;
        const records = [];
        do {
            const page = await accounts.list({ prefix: 'customer-', ...(cursor ? { cursor } : {}) });
            records.push(...await Promise.all((page.blobs || []).map(item => accounts.get(item.key, { type: 'json' }))));
            cursor = page.cursor;
        } while (cursor);
        const ids = await index.get('all-order-ids', { type: 'json' }) || [];
        const orders = [
            ...await legacy.get('orders', { type: 'json' }) || [],
            ...await legacy.get('orders-v2', { type: 'json' }) || [],
            ...await index.get('orders', { type: 'json' }) || [],
            ...await Promise.all(ids.map(id => index.get(`order-${id}`, { type: 'json' })))
        ];
        const uniqueOrders = new Map();
        for (const order of orders) if (order && order.id) uniqueOrders.set(String(order.id), order);
        const counts = new Map();
        for (const order of uniqueOrders.values()) {
            const email = String(order.customerEmail || '').trim().toLowerCase();
            if (email) counts.set(email, (counts.get(email) || 0) + 1);
        }
        const customers = records.filter(account => account && account.verified && account.email).map(account => ({
            name: account.fullName || account.username || account.email,
            email: account.email,
            phone: account.phone || '',
            totalOrders: counts.get(String(account.email).trim().toLowerCase()) || 0
        })).sort((a, b) => a.name.localeCompare(b.name));
        return response(200, { customers });
    } catch (error) {
        console.error('Could not load customer list:', error);
        return response(500, { error: 'Unable to load customers. Please try again.' });
    }
};
