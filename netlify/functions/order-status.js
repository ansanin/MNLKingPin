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

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !fromEmail) {
        return jsonResponse(500, { error: 'Email service is not configured' });
    }

    try {
        const data = JSON.parse(event.body || '{}');
        if (!data.customerEmail || !data.orderId) {
            return jsonResponse(400, { error: 'Customer email or order ID is missing' });
        }

        const status = String(data.status || 'updated').replace(/-/g, ' ');
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [data.customerEmail],
                subject: `KingPin Order #${data.orderId} Status Update`,
                html: `<h2>KingPin Order Update</h2><p>Your order <strong>#${data.orderId}</strong> has been updated.</p><p><strong>New Status:</strong> ${status}</p><p>${data.message || 'Your order status has been updated.'}</p><p>Thank you for choosing KingPin!</p>`
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Resend email error:', error);
            return jsonResponse(502, { error: 'Email provider rejected the message' });
        }

        return jsonResponse(200, { success: true, message: 'Order status email sent successfully' });
    } catch (error) {
        console.error('Order status email error:', error);
        return jsonResponse(500, { error: 'Unable to send order status email' });
    }
};