const { connectLambda } = require('@netlify/blobs');
const { getImageStore } = require('./lib/product-images');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

    const key = String(event.queryStringParameters?.key || '');
    if (!/^[a-f0-9]{64}$/.test(key)) return jsonResponse(400, { error: 'A valid product image key is required.' });

    try {
        const store = getImageStore();
        const [image, result] = await Promise.all([
            store.get(key, { type: 'arrayBuffer' }),
            store.getMetadata(key)
        ]);
        if (!image || !result?.metadata?.contentType) return jsonResponse(404, { error: 'Product image not found.' });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': result.metadata.contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            },
            isBase64Encoded: true,
            body: Buffer.from(image).toString('base64')
        };
    } catch (error) {
        console.error('Netlify product image function error:', error);
        return jsonResponse(500, { error: 'Unable to load product image.' });
    }
};
