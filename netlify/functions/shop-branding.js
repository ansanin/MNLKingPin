const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');

const brandingKey = 'shop-branding';
const maxLogoBytes = 3 * 1024 * 1024;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-settings');
        if (event.httpMethod === 'GET') {
            const branding = await store.get(brandingKey, { type: 'json' });
            return jsonResponse(200, {
                exists: Boolean(branding?.shopName),
                branding: branding || { shopName: '', shopLogo: '' }
            });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        let payload;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'Branding data must be valid JSON.' });
        }
        const shopName = String(payload.shopName || '').trim();
        const shopLogo = String(payload.shopLogo || '');
        if (!shopName || shopName.length > 120) {
            return jsonResponse(400, { error: 'Enter a shop name of up to 120 characters.' });
        }
        if (shopLogo && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(shopLogo)) {
            return jsonResponse(400, { error: 'Use a valid PNG, JPEG, GIF, or WebP logo image.' });
        }
        if (Buffer.byteLength(shopLogo, 'utf8') > maxLogoBytes * 1.4) {
            return jsonResponse(413, { error: 'Logo image must be 3MB or smaller.' });
        }

        const branding = { shopName, shopLogo };
        await store.setJSON(brandingKey, branding);
        return jsonResponse(200, { ok: true, branding });
    } catch (error) {
        console.error('Netlify shop branding function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared shop branding.' });
    }
};
