const { connectLambda, getStore } = require('@netlify/blobs');

const footerKey = 'shop-footer';
const emptySettings = { location: '', contactNumber: '', facebookUrl: '', instagramUrl: '' };

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function normalizeFooterUrl(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '';

    try {
        const url = new URL(/^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (error) {
        return null;
    }
}

function normalizeShopContactNumber(value) {
    const contactNumber = String(value || '').trim();
    if (!contactNumber) return '';
    if (!/^\+?[\d\s().-]+$/.test(contactNumber)) return null;

    const digits = contactNumber.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? contactNumber : null;
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-settings');
        if (event.httpMethod === 'GET') {
            const footerSettings = (await store.get(footerKey, { type: 'json' })) || emptySettings;
            return jsonResponse(200, { footerSettings });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const payload = JSON.parse(event.body || '{}');
        const facebookUrl = normalizeFooterUrl(payload.facebookUrl);
        const instagramUrl = normalizeFooterUrl(payload.instagramUrl);
        const contactNumber = normalizeShopContactNumber(payload.contactNumber);
        const location = String(payload.location || '').trim();
        if (facebookUrl === null || instagramUrl === null || contactNumber === null || location.length > 300) {
            return jsonResponse(400, { error: 'Enter valid web links, contact number, and location' });
        }

        const footerSettings = { location, contactNumber, facebookUrl, instagramUrl };
        await store.setJSON(footerKey, footerSettings);
        return jsonResponse(200, { ok: true, footerSettings });
    } catch (error) {
        console.error('Netlify shop footer function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared footer settings' });
    }
};
