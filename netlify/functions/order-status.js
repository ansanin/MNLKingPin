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
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

    const authentication = authenticateEvent(event);
    if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
    if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;
    if ((!smtpUser || !smtpPass) && (!resendApiKey || !resendFromEmail)) {
        return jsonResponse(500, { error: 'Email service is not configured' });
    }

    try {
        const data = JSON.parse(event.body || '{}');
        if (!data.orderId || !data.eventId) {
            return jsonResponse(400, { error: 'Order ID and production event ID are required.' });
        }

        const store = getStore('kingpin-order-index');
        const order = await store.get(`order-${String(data.orderId)}`, { type: 'json' });
        if (!order) return jsonResponse(404, { error: 'Order not found.' });
        const productionEvent = (order.productionNotifications || []).find(item => item.id === data.eventId);
        if (!productionEvent) return jsonResponse(403, { error: 'The production event is not associated with this order.' });
        const sentEmailIds = Array.isArray(order.productionEmailEventIds) ? order.productionEmailEventIds : [];
        if (sentEmailIds.includes(data.eventId)) return jsonResponse(200, { success: true, duplicate: true });

        const status = String(productionEvent.message || 'updated');
        const subject = `KingPin Order #${order.id} Status Update`;
        const html = await renderOrderUpdateEmail(order, productionEvent, process.env.URL || 'https://mnlkingpin.netlify.app');

        if (smtpUser && smtpPass) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: smtpUser, pass: smtpPass }
            });
            await transporter.sendMail({
                from: process.env.SMTP_FROM || smtpUser,
                to: order.customerEmail,
                bcc: order.customerEmail === smtpUser ? undefined : smtpUser,
                subject,
                html
            });
            order.productionEmailEventIds = [...sentEmailIds, data.eventId];
            await store.setJSON(`order-${String(order.id)}`, order);
            return jsonResponse(200, { success: true, message: 'Order status email sent successfully' });
        }

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: resendFromEmail,
                to: [order.customerEmail],
                bcc: order.customerEmail === resendFromEmail ? undefined : [resendFromEmail],
                subject,
                html
            })
        });
        if (!response.ok) {
            console.error('Resend email error:', await response.text());
            return jsonResponse(502, { error: 'Email provider rejected the message' });
        }
        order.productionEmailEventIds = [...sentEmailIds, data.eventId];
        await store.setJSON(`order-${String(order.id)}`, order);
        return jsonResponse(200, { success: true, message: 'Order status email sent successfully' });
    } catch (error) {
        console.error('Order status email error:', error);
        return jsonResponse(500, { error: 'Unable to send order status email' });
    }
};