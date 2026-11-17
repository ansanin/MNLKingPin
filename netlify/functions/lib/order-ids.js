// Every order id, found from the saved order records themselves (keys
// "order-<id>") as well as the old "all-order-ids" list. The list alone can
// miss an order: two saves at the same moment (a new order and the admin page
// loading) can each write the list without the other's new id, which hid that
// order from the admin even though it was saved.
async function listOrderIds(orderIndexStore) {
    const ids = new Map();
    const saved = (await orderIndexStore.get('all-order-ids', { type: 'json' })) || [];
    (Array.isArray(saved) ? saved : []).forEach(id => ids.set(String(id), id));
    if (typeof orderIndexStore.list === 'function') {
        let cursor;
        do {
            const page = await orderIndexStore.list({ prefix: 'order-', ...(cursor ? { cursor } : {}) });
            (page?.blobs || []).forEach(({ key }) => {
                const id = String(key || '').slice('order-'.length);
                if (!id || ids.has(id)) return;
                ids.set(id, /^\d{1,15}$/.test(id) ? Number(id) : id);
            });
            cursor = page?.cursor;
        } while (cursor);
    }
    return Array.from(ids.values());
}

module.exports = { listOrderIds };
