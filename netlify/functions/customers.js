const { connectLambda, getStore } = require('@netlify/blobs');
const { accountKey, authenticateEvent } = require('./lib/auth');
const { deleteAccount, isActiveAccount, isValidEmail, moveAccount, normalizeEmail } = require('./lib/customer-data');

const response = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

async function listCustomers() {
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
        // Orders count toward the email they were placed with, so an old
        // email's entry keeps its orders after the customer changes email.
        const email = normalizeEmail(order.placedByEmail || order.customerEmail);
        if (email) counts.set(email, (counts.get(email) || 0) + 1);
    }
    return records.filter(account => account && account.verified && account.email).map(account => ({
        name: account.fullName || account.username || account.email,
        email: account.email,
        phone: account.phone || '',
        username: account.username || '',
        address: account.address || '',
        totalOrders: counts.get(normalizeEmail(account.email)) || 0,
        status: account.archived ? 'old-email' : 'active',
        movedTo: account.movedTo || ''
    })).sort((a, b) => a.name.localeCompare(b.name) || (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
}

// Admin edits a customer's profile. A new email moves the account and its
// orders, cart and messages, the same as a customer-confirmed email change.
async function updateCustomer(data) {
    const store = getStore('kingpin-auth');
    const email = normalizeEmail(data.email);
    const account = await store.get(accountKey(email), { type: 'json' });
    if (account?.archived) return response(409, { error: 'This is an old email record and cannot be edited.' });
    if (!isActiveAccount(account)) return response(404, { error: 'Customer account was not found.' });

    // Fields that are not sent keep their current value, so the list can
    // update just the name or Gmail.
    const field = (name, fallback = '') => String(data[name] ?? account[name] ?? fallback).trim();
    const newEmail = normalizeEmail(data.newEmail || data.email);
    const fullName = field('fullName');
    const username = field('username') || account.username || email;
    const phone = field('phone');
    const address = field('address');
    if (!isValidEmail(newEmail)) return response(400, { error: 'Enter a valid email address.' });
    if (!fullName || fullName.length > 120 || username.length < 3 || username.length > 60
        || phone.length > 40 || address.length > 500) {
        return response(400, { error: 'Enter a name, a username of 3–60 characters, and a phone and address within the allowed lengths.' });
    }

    if (newEmail !== email) {
        const existing = await store.get(accountKey(newEmail), { type: 'json' });
        if (isActiveAccount(existing)) return response(409, { error: 'Another account already uses this email.' });
        // The old email stays in the list with its old details; the edits
        // apply to the new email's entry.
        await moveAccount(store, account, newEmail, { fullName, username, phone, address });
    } else {
        await store.setJSON(accountKey(email), { ...account, fullName, username, phone, address });
    }
    return response(200, { ok: true, customer: { name: fullName, email: newEmail, phone, username, address } });
}

async function removeCustomer(data) {
    const store = getStore('kingpin-auth');
    const email = normalizeEmail(data.email);
    const account = await store.get(accountKey(email), { type: 'json' });
    if (!account?.verified) return response(404, { error: 'Customer account was not found.' });
    await deleteAccount(store, email);
    return response(200, { ok: true, deletedEmail: email });
}

exports.handler = async event => {
    if (!['GET', 'POST'].includes(event.httpMethod)) return response(405, { error: 'Method not allowed.' });
    const auth = authenticateEvent(event);
    if (!auth.ok) return response(auth.statusCode, { error: auth.error });
    if (auth.claims.role !== 'admin') return response(403, { error: 'Admin access required.' });
    try {
        connectLambda(event);
        if (event.httpMethod === 'GET') return response(200, { customers: await listCustomers() });
        let data;
        try {
            data = JSON.parse(event.body || '{}');
        } catch (error) {
            return response(400, { error: 'Request must be valid JSON.' });
        }
        if (data.action === 'update') return await updateCustomer(data);
        if (data.action === 'delete') return await removeCustomer(data);
        return response(400, { error: 'Unknown customer action.' });
    } catch (error) {
        console.error('Customer list request failed:', error);
        return response(500, { error: 'Unable to complete the customer request. Please try again.' });
    }
};
