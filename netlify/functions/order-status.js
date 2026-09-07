const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');

async function loadSavedEmailSettings(event) {
    connectLambda(event);
    const encryptionKey = process.env.KINGPIN_EMAIL_SETTINGS_KEY;
    if (!encryptionKey) return null;

    const store = getStore('kingpin-email-settings');
    const saved = await store.get('smtp', { type: 'json' });
    if (!saved?.iv || !saved?.tag || !saved?.data) return null;

    const key = crypto.createHash('sha256').update(encryptionKey).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(saved.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(saved.tag, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

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
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

    try {
        const notification = JSON.parse(event.body || '{}');
        if (!notification.orderId || !notification.customerEmail) {
            return jsonResponse(400, { error: 'orderId and customerEmail are required' });
        }

        const savedSettings = await loadSavedEmailSettings(event);
        const smtpHost = savedSettings?.host || process.env.SMTP_HOST || 'smtp.gmail.com';
        const smtpUser = savedSettings?.email || process.env.SMTP_USER;
        const smtpPass = savedSettings?.appPassword || process.env.SMTP_PASS;
        const smtpPort = Number(savedSettings?.port || process.env.SMTP_PORT || 587);

        if (!smtpUser || !smtpPass) {
            return jsonResponse(503, { error: 'Email service is not configured on the server' });
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: smtpUser, pass: smtpPass }
        });

        await transporter.sendMail({
            from: savedSettings?.email || process.env.SMTP_FROM || smtpUser,
            to: notification.customerEmail,
            subject: `KingPin Order #${notification.orderId} Status Update`,
            text: notification.message,
            html: `<h2>KingPin Order Update</h2><p>Your order <strong>#${notification.orderId}</strong> status is now:</p><p><strong>${notification.status || 'Updated'}</strong></p><p>${notification.message}</p><p>Thank you for choosing KingPin!</p>`
        });

        return jsonResponse(200, { success: true, message: 'Order status email sent successfully.' });
    } catch (error) {
        console.error('Order status email error:', error.message);
        return jsonResponse(500, { error: 'Failed to send order status email.' });
    }
};
