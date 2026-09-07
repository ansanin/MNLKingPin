const nodemailer = require('nodemailer');

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

        const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const smtpPort = Number(process.env.SMTP_PORT || 587);

        if (!smtpUser || !smtpPass) {
            return jsonResponse(503, { error: 'Email service is not configured in Netlify Environment Variables.' });
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: smtpUser, pass: smtpPass }
        });

        await transporter.sendMail({
            from: process.env.SMTP_FROM || smtpUser,
            to: notification.customerEmail,
            subject: `KingPin Order #${notification.orderId} Status Update`,
            text: notification.message,
            html: `<h2>KingPin Order Update</h2><p>Your order <strong>#${notification.orderId}</strong> status is now:</p><p><strong>${notification.status || 'Updated'}</strong></p><p>${notification.message}</p><p>Thank you for choosing KingPin!</p>`
        });

        return jsonResponse(200, { success: true, message: 'Order status email sent successfully.' });
    } catch (error) {
        console.error('Order status email error:', error.message);
        const errorMessage = String(error.message || '');
        if (errorMessage.includes('Invalid login') || errorMessage.includes('Username and Password not accepted')) {
            return jsonResponse(502, { error: 'Gmail rejected the login. Check the Gmail address and App Password.' });
        }
        if (errorMessage.includes('getaddrinfo') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED')) {
            return jsonResponse(502, { error: 'Unable to connect to the Gmail SMTP server.' });
        }
        return jsonResponse(500, { error: 'Email service failed. Check the Gmail App Password and Netlify function logs.' });
    }
};
