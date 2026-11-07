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
        // The customer keeps access through the new email, but placedByEmail
        // records which customer-list entry the order belongs to.
        const updated = { ...order, customerEmail: newEmail, placedByEmail: normalizeEmail(order.placedByEmail) || oldEmail };
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

// Moves sign-in to a new email. The new email becomes a new customer entry
// with `profile` applied; the old email stays in the customer list as an
// archived record with its old name and details, and cannot sign in.
// The caller checks that the new email is free.
async function moveAccount(authStore, account, newEmail, profile = {}) {
    const oldEmail = normalizeEmail(account.email);
    const changedAt = new Date().toISOString();
    const newAccount = {
        ...account,
        ...profile,
        email: newEmail,
        previousEmails: [...(account.previousEmails || []), oldEmail],
        emailChangedAt: changedAt,
        createdAt: changedAt
    };
    if (normalizeEmail(newAccount.username) === oldEmail) newAccount.username = newEmail;
    delete newAccount.archived;
    delete newAccount.movedTo;
    const archivedAccount = {
        email: oldEmail,
        username: account.username || '',
        fullName: account.fullName || '',
        phone: account.phone || '',
        address: account.address || '',
        createdAt: account.createdAt || '',
        verified: true,
        archived: true,
        movedTo: newEmail,
        archivedAt: changedAt
    };
    await authStore.setJSON(accountKey(newEmail), newAccount);
    await moveCustomerData(oldEmail, newEmail);
    await authStore.setJSON(accountKey(oldEmail), archivedAccount);
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
