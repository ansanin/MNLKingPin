const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');

const heroKey = 'shop-hero';
const maxHeroBytes = 3 * 1024 * 1024;
const defaultHero = {
    title: 'Your team. Your identity.',
    subtitle: 'Custom jerseys & teamwear',
    image: ''
};

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
            const hero = await store.get(heroKey, { type: 'json' });
            return jsonResponse(200, { hero: hero || defaultHero });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        let payload;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'Hero settings must be valid JSON.' });
        }

        const title = String(payload.title || '').trim();
        const subtitle = String(payload.subtitle || '').trim();
        const image = String(payload.image || '');
        if (!title || title.length > 90 || subtitle.length > 140) {
            return jsonResponse(400, { error: 'Enter a heading up to 90 characters and a subtitle up to 140 characters.' });
        }
        if (image && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(image)) {
            return jsonResponse(400, { error: 'Use a valid PNG, JPEG, GIF, or WebP hero image.' });
        }
        if (Buffer.byteLength(image, 'utf8') > maxHeroBytes * 1.4) {
            return jsonResponse(413, { error: 'Hero image must be 3 MB or smaller.' });
        }

        const hero = { title, subtitle, image };
        await store.setJSON(heroKey, hero);
        return jsonResponse(200, { ok: true, hero });
    } catch (error) {
        console.error('Netlify shop hero function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared hero settings.' });
    }
};