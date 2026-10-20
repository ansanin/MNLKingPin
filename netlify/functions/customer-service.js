const { connectLambda, getStore } = require('@netlify/blobs');
const { accountKey, authenticateEvent } = require('./lib/auth');

const maxRequestBytes = 12 * 1024;
const allowedSubjects = new Set([
    'Order status',
    'Payment concern',
    'Change order details',
    'Other concern'
]);

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function getMessagesStore() {
    return getStore('kingpin-customer-service');
}

async function loadMessages(store) {
    const messages = [];
    let cursor;
    do {
        const page = await store.list({ prefix: 'message-', ...(cursor ? { cursor } : {}) });
        const pageMessages = await Promise.all((page.blobs || []).map(blob =>
            store.get(blob.key, { type: 'json' })
        ));
        messages.push(...pageMessages.filter(message => message && typeof message === 'object'));
        cursor = page.cursor;
    } while (cursor);
    return messages;
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const authentication = authenticateEvent(event);
    if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });

    try {
        const store = getMessagesStore();
        const messages = await loadMessages(store);
        const { claims } = authentication;

        if (event.httpMethod === 'GET') {
            let visibleMessages = (claims.role === 'admin'
                ? messages
                : messages.filter(message => message.ownerSub === claims.sub))
                .sort((first, second) => String(second.createdAt || '').localeCompare(String(first.createdAt || '')));
            if (claims.role === 'admin') {
                const accountsStore = getStore('kingpin-auth');
                const usernames = new Map();
                await Promise.all(visibleMessages.map(async message => {
                    if (usernames.has(message.ownerSub)) return;
                    const account = await accountsStore.get(accountKey(message.ownerSub), { type: 'json' });
                    usernames.set(message.ownerSub, account?.username || message.customerUsername || message.customerName || message.ownerSub);
                }));
                visibleMessages = visibleMessages.map(message => ({
                    ...message,
                    customerUsername: usernames.get(message.ownerSub)
                }));
            }
            return jsonResponse(200, { messages: visibleMessages });
        }

        const body = String(event.body || '');
        if (Buffer.byteLength(body, 'utf8') > maxRequestBytes) {
            return jsonResponse(413, { error: 'Message request is too large.' });
        }

        let payload;
        try {
            payload = JSON.parse(body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'Message request must be valid JSON.' });
        }

        if (payload.action === 'create') {
            if (claims.role !== 'customer') return jsonResponse(403, { error: 'Customer access required.' });
            const subject = String(payload.subject || '').trim();
            const messageText = String(payload.message || '').trim();
            if (!allowedSubjects.has(subject) || !messageText || messageText.length > 5000) {
                return jsonResponse(400, { error: 'Choose a valid subject and enter a message of up to 5,000 characters.' });
            }

            const message = {
                id: require('crypto').randomUUID(),
                ownerSub: claims.sub,
                customerUsername: claims.sub,
                customerName: claims.sub,
                customerEmail: claims.sub,
                orderId: String(payload.orderId || '').trim().slice(0, 80) || null,
                subject,
                message: messageText,
                status: 'open',
                read: false,
                date: new Date().toLocaleString(),
                createdAt: new Date().toISOString(),
                replies: []
            };
            const account = await getStore('kingpin-auth').get(accountKey(claims.sub), { type: 'json' });
            message.customerUsername = account?.username || claims.sub;
            message.customerName = message.customerUsername;
            await store.setJSON(`message-${message.id}`, message);
            return jsonResponse(201, { ok: true, message });
        }

        if (claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });
        const message = messages.find(item => item.id === String(payload.messageId || ''));
        if (!message) return jsonResponse(404, { error: 'Customer message not found.' });

        if (payload.action === 'read') {
            message.read = true;
        } else if (payload.action === 'reply') {
            const replyText = String(payload.message || '').trim();
            if (!replyText || replyText.length > 5000) {
                return jsonResponse(400, { error: 'Enter a reply of up to 5,000 characters.' });
            }
            message.replies = Array.isArray(message.replies) ? message.replies : [];
            message.replies.push({
                sender: 'admin',
                message: replyText,
                date: new Date().toLocaleString()
            });
            message.read = true;
        } else {
            return jsonResponse(400, { error: 'Unsupported customer-service action.' });
        }

        await store.setJSON(`message-${message.id}`, message);
        return jsonResponse(200, { ok: true, message });
    } catch (error) {
        console.error('Netlify customer-service function error:', error);
        return jsonResponse(500, { error: 'Unable to access customer-service messages.' });
    }
};
