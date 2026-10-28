const { connectLambda, getStore } = require('@netlify/blobs');
const { migrateProductImages } = require('./lib/product-images');

const catalogKey = 'catalog';

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

    const id = String(event.queryStringParameters?.id || '');
    if (!id || id.length > 120) return jsonResponse(400, { error: 'A valid product ID is required.' });

    try {
        const store = getStore('kingpin-products');
        const products = await store.get(catalogKey, { type: 'json' });
        if (!Array.isArray(products)) return jsonResponse(404, { error: 'Product not found.' });
        const product = (await migrateProductImages(products)).find(item => String(item.id) === id);
        if (!product) return jsonResponse(404, { error: 'Product not found.' });
        return jsonResponse(200, { product });
    } catch (error) {
        console.error('Netlify product detail function error:', error);
        return jsonResponse(500, { error: 'Unable to load product details.' });
    }
};
