const { connectLambda, getStore } = require('@netlify/blobs');
const { accountKey, authenticateEvent } = require('./lib/auth');

const maxCartBytes = 5 * 1024 * 1024;
const maxCartItems = 100;
const maxDesignBytes = 4.5 * 1024 * 1024;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function getCartStore() {
    return getStore('kingpin-carts');
}

function validateCart(cart) {
    if (!Array.isArray(cart) || cart.length > maxCartItems) {
        return 'Cart must be an array with no more than 100 items.';
    }

    let designBytes = 0;
    for (const item of cart) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return 'Cart contains an invalid item.';
        }
        if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1
            || !Number.isFinite(Number(item.price)) || Number(item.price) < 0) {
            return 'Cart contains an invalid quantity or price.';
        }

        const files = Array.isArray(item.details?.uploadedFiles)
            ? item.details.uploadedFiles
            : item.details?.uploadedFile ? [{ uploadedFile: item.details.uploadedFile }] : [];
        for (const file of files) {
            const data = String(file.uploadedFile || '');
            if (!data) continue;
            if (!/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,[a-z0-9+/=]+$/i.test(data)) {
                return 'Cart contains an unsupported uploaded design file.';
            }
            designBytes += data.length;
        }
    }

    if (designBytes > maxDesignBytes) return 'Uploaded designs exceed the allowed cart size.';
    return '';
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const authentication = authenticateEvent(event);
    if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
    if (authentication.claims.role !== 'customer') {
        return jsonResponse(403, { error: 'Customer access required.' });
    }

    try {
        const store = getCartStore();
        const key = accountKey(authentication.claims.sub);

        if (event.httpMethod === 'GET') {
            const cart = await store.get(key, { type: 'json' });
            return jsonResponse(200, { cart: Array.isArray(cart) ? cart : [], exists: Array.isArray(cart) });
        }

        const body = String(event.body || '');
        if (Buffer.byteLength(body, 'utf8') > maxCartBytes) {
            return jsonResponse(413, { error: 'Cart data is too large to sync.' });
        }

        let payload;
        try {
            payload = JSON.parse(body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'Cart data must be valid JSON.' });
        }
        const validationError = validateCart(payload.cart);
        if (validationError) return jsonResponse(400, { error: validationError });

        await store.setJSON(key, payload.cart);
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify cart function error:', error);
        return jsonResponse(500, { error: 'Unable to sync customer cart.' });
    }
};
