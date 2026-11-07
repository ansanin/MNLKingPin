const { connectLambda, getStore } = require('@netlify/blobs');
const { accountKey, authenticateEvent } = require('./lib/auth');
const { deleteAccount, isValidEmail, normalizeEmail } = require('./lib/customer-data');

// Admin edits in the customer list are labels for the admin only. They are
// kept apart from the customer's account, so the customer's login, profile
// and orders never change, and Reset brings back the real details.
const ADMIN_EDITS_STORE = 'kingpin-customer-admin-edits';
const EDITABLE_FIELDS = ['fullName', 'email', 'phone', 'address'];

function realDetails(account) {
    return {
        fullName: account.fullName || account.username || account.email,
        email: account.email,
        phone: account.phone || '',
        address: account.address || ''
    };
}

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
        const email = normalizeEmail(order.customerEmail);
        if (email) counts.set(email, (counts.get(email) || 0) + 1);
    }
    const edits = getStore(ADMIN_EDITS_STORE);
    // One entry per customer: records left by an earlier email change are not listed.
    const visible = records.filter(account => account && account.verified && !account.archived && account.email);
    const overrides = await Promise.all(visible.map(account => edits.get(accountKey(account.email), { type: 'json' })));
    return visible.map((account, index) => {
        const real = realDetails(account);
        const override = overrides[index] || {};
        const shown = { ...real };
        EDITABLE_FIELDS.forEach(field => { if (typeof override[field] === 'string') shown[field] = override[field]; });
        const adminEdited = EDITABLE_FIELDS.some(field => shown[field] !== real[field]);
        return {
            name: shown.fullName,
            email: shown.email,
            phone: shown.phone,
            username: account.username || '',
            address: shown.address,
            accountEmail: account.email,
            totalOrders: counts.get(normalizeEmail(account.email)) || 0,
            status: account.archived ? 'old-email' : 'active',
            movedTo: account.movedTo || '',
            adminEdited,
            ...(adminEdited ? { original: { name: real.fullName, email: real.email, phone: real.phone, address: real.address } } : {})
        };
    }).sort((a, b) => a.name.localeCompare(b.name) || (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
}

// Saves the admin's edited name, Gmail, phone or address for the list only.
async function updateCustomer(data) {
    const email = normalizeEmail(data.email);
    const account = await getStore('kingpin-auth').get(accountKey(email), { type: 'json' });
    if (!account?.verified) return response(404, { error: 'Customer account was not found.' });
    const edits = getStore(ADMIN_EDITS_STORE);
    const current = (await edits.get(accountKey(email), { type: 'json' })) || {};
    const real = realDetails(account);
    const next = { ...real, ...current };
    if (data.fullName !== undefined) next.fullName = String(data.fullName).trim();
    if (data.newEmail !== undefined) next.email = normalizeEmail(data.newEmail);
    if (data.phone !== undefined) next.phone = String(data.phone).trim();
    if (data.address !== undefined) next.address = String(data.address).trim();
    if (!next.fullName || next.fullName.length > 120) return response(400, { error: 'Enter a name of up to 120 characters.' });
    if (!isValidEmail(next.email)) return response(400, { error: 'Enter a valid email address.' });
    if (next.phone.length > 40 || next.address.length > 500) return response(400, { error: 'Phone or address is too long.' });

    const override = {};
    EDITABLE_FIELDS.forEach(field => { if (next[field] !== real[field]) override[field] = next[field]; });
    if (Object.keys(override).length) {
        await edits.setJSON(accountKey(email), { ...override, updatedAt: new Date().toISOString() });
    } else {
        await removeKey(edits, accountKey(email));
    }
    return response(200, { ok: true, customer: { name: next.fullName, email: next.email, phone: next.phone, address: next.address, accountEmail: account.email } });
}

async function resetCustomer(data) {
    await removeKey(getStore(ADMIN_EDITS_STORE), accountKey(normalizeEmail(data.email)));
    return response(200, { ok: true });
}

async function removeKey(store, key) {
    if (typeof store.delete === 'function') await store.delete(key);
    else await store.setJSON(key, null);
}

async function removeCustomer(data) {
    const store = getStore('kingpin-auth');
    const email = normalizeEmail(data.email);
    const account = await store.get(accountKey(email), { type: 'json' });
    if (!account?.verified) return response(404, { error: 'Customer account was not found.' });
    await deleteAccount(store, email);
    await removeKey(getStore(ADMIN_EDITS_STORE), accountKey(email));
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
        if (data.action === 'reset') return await resetCustomer(data);
        if (data.action === 'delete') return await removeCustomer(data);
        return response(400, { error: 'Unknown customer action.' });
    } catch (error) {
        console.error('Customer list request failed:', error);
        return response(500, { error: 'Unable to complete the customer request. Please try again.' });
    }
};
