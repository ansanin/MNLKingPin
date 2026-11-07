// Shared helpers for customer accounts. A customer's orders, cart and support
// messages are linked by login email, so changing or removing an account has
// to update those records too.
const { getStore } = require('@netlify/blobs');
const { accountKey } = require('./auth');

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// An account that can sign in. Old records kept after an email change are
// "archived": they stay in the admin customer list but cannot be used.
function isActiveAccount(account) {
    return Boolean(account?.verified && !account.archived);
}

function emailChangeKey(email) {
    return `email-change-${accountKey(email)}`;
}

async function deleteKey(store, key) {
    if (typeof store.delete === 'function') await store.delete(key);
    else await store.setJSON(key, null);
}

async function readAllOrderRecords(orderIndexStore, orderStore) {
    const ids = (await orderIndexStore.get('all-order-ids', { type: 'json' })) || [];
    const indexed = await Promise.all(ids.map(id => orderIndexStore.get(`order-${String(id)}`, { type: 'json' })));
    const legacy = [
        ...((await orderStore.get('orders', { type: 'json' })) || []),
        ...((await orderStore.get('orders-v2', { type: 'json' })) || []),
        ...((await orderIndexStore.get('orders', { type: 'json' })) || [])
    ];
    const byId = new Map();
    [...legacy, ...indexed].forEach(order => { if (order?.id) byId.set(String(order.id), order); });
    return { ids, orders: Array.from(byId.values()) };
}

async function moveCustomerData(oldEmail, newEmail) {
    const orderIndexStore = getStore('kingpin-order-index');
    const { ids, orders } = await readAllOrderRecords(orderIndexStore, getStore('kingpin-orders'));
    const nextIds = [...ids];
    const activeIds = (await orderIndexStore.get('active-order-ids', { type: 'json' })) || [];
    const nextActiveIds = [...activeIds];
    let movedOrders = 0;
    for (const order of orders) {
        if (normalizeEmail(order.customerEmail) !== oldEmail) continue;
        const updated = { ...order, customerEmail: newEmail };
        if (normalizeEmail(order.customerUsername) === oldEmail) updated.customerUsername = newEmail;
        await orderIndexStore.setJSON(`order-${String(order.id)}`, updated);
        if (!nextIds.some(id => String(id) === String(order.id))) nextIds.push(order.id);
        const isActive = !['completed', 'delivered', 'cancelled'].includes(String(order.status || '').toLowerCase());
        if (isActive && !nextActiveIds.some(id => String(id) === String(order.id))) nextActiveIds.push(order.id);
        movedOrders += 1;
    }
    if (nextIds.length !== ids.length) await orderIndexStore.setJSON('all-order-ids', nextIds);
    if (nextActiveIds.length !== activeIds.length) await orderIndexStore.setJSON('active-order-ids', nextActiveIds);

    const cartStore = getStore('kingpin-carts');
    const cart = await cartStore.get(accountKey(oldEmail), { type: 'json' });
    if (Array.isArray(cart)) {
        await cartStore.setJSON(accountKey(newEmail), cart);
        await deleteKey(cartStore, accountKey(oldEmail));
    }

    const messageStore = getStore('kingpin-customer-service');
    let cursor;
    do {
        const page = await messageStore.list({ prefix: 'message-', ...(cursor ? { cursor } : {}) });
        for (const blob of page.blobs || []) {
            const message = await messageStore.get(blob.key, { type: 'json' });
            if (!message || normalizeEmail(message.ownerSub) !== oldEmail) continue;
            await messageStore.setJSON(blob.key, { ...message, ownerSub: newEmail, customerEmail: newEmail });
        }
        cursor = page.cursor;
    } while (cursor);
    return { movedOrders };
}

// Moves an account to a new email. It stays one customer: the account,
// orders, cart, messages and any admin label move to the new email, and the
// old email is removed. The caller checks that the new email is free.
async function moveAccount(authStore, account, newEmail, profile = {}) {
    const oldEmail = normalizeEmail(account.email);
    const newAccount = {
        ...account,
        ...profile,
        email: newEmail,
        previousEmails: [...(account.previousEmails || []), oldEmail],
        emailChangedAt: new Date().toISOString()
    };
    if (normalizeEmail(newAccount.username) === oldEmail) newAccount.username = newEmail;
    delete newAccount.archived;
    delete newAccount.movedTo;
    await authStore.setJSON(accountKey(newEmail), newAccount);
    await moveCustomerData(oldEmail, newEmail);

    const adminEdits = getStore('kingpin-customer-admin-edits');
    const label = await adminEdits.get(accountKey(oldEmail), { type: 'json' });
    if (label) {
        await adminEdits.setJSON(accountKey(newEmail), label);
        await deleteKey(adminEdits, accountKey(oldEmail));
    }

    await deleteKey(authStore, accountKey(oldEmail));
    await deleteKey(authStore, emailChangeKey(oldEmail));
    return newAccount;
}

// Removes the login account, any pending sign-up or email change, and the
// saved cart. Orders are kept because they are sales records.
async function deleteAccount(authStore, email) {
    const key = accountKey(email);
    await deleteKey(authStore, key);
    await deleteKey(authStore, `pending-${key}`);
    await deleteKey(authStore, emailChangeKey(email));
    await deleteKey(getStore('kingpin-carts'), key);
}

module.exports = {
    normalizeEmail,
    isValidEmail,
    isActiveAccount,
    emailChangeKey,
    readAllOrderRecords,
    moveCustomerData,
    moveAccount,
    deleteAccount
};
