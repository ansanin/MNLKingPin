const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

    const encryptionKey = process.env.KINGPIN_EMAIL_SETTINGS_KEY;
    if (!encryptionKey) return jsonResponse(503, { error: 'Email settings security key is not configured' });

    try {
        const payload = JSON.parse(event.body || '{}');
        if (!payload.email || !payload.appPassword || payload.settingsKey !== encryptionKey) {
            return jsonResponse(403, { error: 'Invalid email settings credentials' });
        }

        const key = crypto.createHash('sha256').update(encryptionKey).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify({
            host: 'smtp.gmail.com',
            port: 587,
            email: payload.email,
            appPassword: payload.appPassword
        }), 'utf8'), cipher.final()]);

        connectLambda(event);
        await getStore('kingpin-email-settings').setJSON('smtp', {
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
            data: encrypted.toString('base64')
        });

        return jsonResponse(200, { success: true });
    } catch (error) {
        console.error('Email settings error:', error.message);
        return jsonResponse(500, { error: 'Unable to save email settings' });
    }
};