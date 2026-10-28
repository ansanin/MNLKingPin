const nodemailer = require('nodemailer');
const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');
const { renderOrderUpdateEmail } = require('./lib/order-email');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}


exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

    const authentication = authenticateEvent(event);
    if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
    if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

    let emailStore;
    let failureKey;
    try {
        const { orderId, eventId } = JSON.parse(event.body || '{}');
        if (!orderId || !eventId) return jsonResponse(400, { error: 'Order and production event are required.' });

        const orderStore = getStore('kingpin-order-index');
        const order = await orderStore.get(`order-${String(orderId)}`, { type: 'json' });
        if (!order) return jsonResponse(404, { error: 'Order not found.' });

        const productionEvent = (order.productionNotifications || []).find(item => item.id === eventId && item.type === 'stage-update');
        if (!productionEvent?.status) return jsonResponse(404, { error: 'Production email event not found.' });

        emailStore = getStore('kingpin-production-email-status');
        failureKey = `failed-${String(orderId)}-${String(eventId)}`;
        const sentKey = `sent-${String(orderId)}-${String(eventId)}`;
        if (await emailStore.get(sentKey, { type: 'json' })) return jsonResponse(200, { ok: true, duplicate: true });

        const email = String(order.customerEmail || '').trim();
        if (!email) { await emailStore.setJSON(failureKey, { reason: 'missing_customer_email', at: new Date().toISOString() }); console.error('Production email: customer email is missing.'); return jsonResponse(400, { error: 'Customer email is missing.' }); }

        const label = String(productionEvent.statusLabel || productionEvent.status).replace(/-/g, ' ');
        const subject = `KingPin Order #${order.id}: ${label}`;
        const html = await renderOrderUpdateEmail(order, productionEvent, process.env.URL || 'https://mnlkingpin.netlify.app');

        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
            await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: email,
                subject,
                html
            });
        } else if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject, html })
            });
            if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
        } else {
            await emailStore.setJSON(failureKey, { reason: 'email_not_configured', at: new Date().toISOString() });
            console.error('Production email is not configured for this function.');
            return jsonResponse(503, { error: 'Production email is not configured.' });
        }

        try { await emailStore.setJSON(sentKey, { sentAt: new Date().toISOString() }); } catch (error) { console.error('Production email was accepted by the provider, but delivery status could not be recorded.', error); }
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Production email background function failed:', error);
        if (emailStore && failureKey) { try { await emailStore.setJSON(failureKey, { reason: 'provider_or_processing_error', at: new Date().toISOString() }); } catch (statusError) { console.error('Unable to record email failure.', statusError); } }
        throw error; // A thrown failure permits Netlify background retries.
    }
};