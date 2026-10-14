const fs = require('fs/promises');
const path = require('path');
const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');

const productKey = 'catalog';

function getProductsStore() {
    return getStore('kingpin-products');
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

async function loadInitialProducts() {
    try {
        const filePath = path.join(process.cwd(), 'uploads', 'products.json');
        const fileData = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return Array.isArray(fileData.products) ? fileData.products : [];
    } catch (error) {
        return [];
    }
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(204, {});
    }

    try {
        if (event.httpMethod === 'GET') {
            const store = getProductsStore();
            let products = await store.get(productKey, { type: 'json' });
            if (!Array.isArray(products)) {
                products = await loadInitialProducts();
                await store.setJSON(productKey, products);
            }
            return jsonResponse(200, { products });
        }

        if (event.httpMethod !== 'POST') {
            return jsonResponse(405, { error: 'Method not allowed' });
        }

        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        const payload = JSON.parse(event.body || '{}');
        if (!Array.isArray(payload.products)) {
            return jsonResponse(400, { error: 'Products must be an array' });
        }

        if (JSON.stringify(payload.products).length > 25 * 1024 * 1024) {
            return jsonResponse(413, { error: 'Product data is too large' });
        }

        const store = getProductsStore();
        await store.setJSON(productKey, payload.products);
        return jsonResponse(200, { ok: true });
    } catch (error) {
        console.error('Netlify products function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared products' });
    }
};
