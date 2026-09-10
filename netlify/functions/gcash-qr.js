const { connectLambda, getStore } = require('@netlify/blobs');

const qrKey = 'gcash-qr';

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getStore('kingpin-settings');

        if (event.httpMethod === 'GET') {
            const gcashQRCode = await store.get(qrKey, { type: 'text' });
            return jsonResponse(200, { gcashQRCode: gcashQRCode || null });
        }

        if (event.httpMethod !== 'POST') {
            return jsonResponse(405, { error: 'Method not allowed' });
        }

        const payload = JSON.parse(event.body || '{}');
        const gcashQRCode = payload.gcashQRCode;
        if (!/^data:image\/(png|jpeg|jpg|gif);base64,/.test(String(gcashQRCode || ''))) {
            return jsonResponse(400, { error: 'A valid QR image is required' });
        }
        if (String(gcashQRCode).length > 5 * 1024 * 1024) {
            return jsonResponse(413, { error: 'QR image is too large' });
        }

        await store.set(qrKey, gcashQRCode);
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify GCash QR function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared GCash QR code' });
    }
};
