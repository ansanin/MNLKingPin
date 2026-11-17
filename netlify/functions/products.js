const fs = require('fs/promises');
const path = require('path');
const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');
const { migrateProductImages, toProductListItem } = require('./lib/product-images');

const productKey = 'catalog';
const migrationKey = 'catalog-image-migration-v1';
const allowedSizes = new Set(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL']);

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

function normalizedSizes(value) {
    const sizes = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(sizes.map(size => {
        const normalized = String(size || '').trim().toUpperCase();
        return normalized === 'XXL' ? '2XL' : normalized === 'XXXL' ? '3XL' : normalized;
    }).filter(Boolean))];
}

function validateChangedProductSizes(products, existingProducts) {
    const existingById = new Map((existingProducts || []).map(product => [String(product.id), product]));
    for (const product of products) {
        if (!product || typeof product !== 'object' || Array.isArray(product)) {
            return 'Product data must contain valid product objects.';
        }

        const previous = existingById.get(String(product.id));
        const changed = !previous || JSON.stringify(previous) !== JSON.stringify(product);
        if (!changed) continue;

        const sizes = normalizedSizes(product.availableSizes);
        if (!sizes.length) return `Select at least one size for ${String(product.name || 'each product').slice(0, 120)}.`;
        const unsupported = sizes.filter(size => !allowedSizes.has(size));
        if (unsupported.length) return `Unsupported sizes for ${String(product.name || 'product').slice(0, 120)}: ${unsupported.join(', ')}.`;
        product.availableSizes = sizes;
    }
    return '';
}

// Orders take stock on the server. The admin page sends `stockBase`, the stock
// it loaded. A product whose stock the admin did not change (stock still equals
// stockBase) keeps the server's current stock, so a page opened before an order
// cannot put sold pieces back. A changed stock (edit, restock, out of stock) is saved.
function keepServerStock(products, stockBases, currentProducts) {
    const currentById = new Map((currentProducts || []).map(product => [String(product?.id), product]));
    return products.map(product => {
        if (!product || typeof product !== 'object' || Array.isArray(product)) return product;
        const { stockBase: ignored, ...rest } = product;
        const base = stockBases.get(String(rest.id));
        const current = currentById.get(String(rest.id));
        if (current && base !== undefined && base !== null && base !== '' && Number(rest.stock) === Number(base)) {
            rest.stock = current.stock;
        }
        return rest;
    });
}

async function loadAndMigrateCatalog(store) {
    let products = await store.get(productKey, { type: 'json' });
    if (!Array.isArray(products)) {
        products = await loadInitialProducts();
        await store.setJSON(productKey, products);
    }

    const migrationComplete = await store.get(migrationKey, { type: 'text' });
    if (migrationComplete !== 'complete') {
        products = await migrateProductImages(products);
        await store.setJSON(productKey, products);
        await store.set(migrationKey, 'complete');
    }
    return products;
}

exports.handler = async function handler(event) {
    connectLambda(event);

    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(204, {});
    }

    try {
        if (event.httpMethod === 'GET') {
            const fullCatalogRequested = event.queryStringParameters?.view === 'admin';
            if (fullCatalogRequested) {
                const authentication = authenticateEvent(event);
                if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
                if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });
            }

            const store = getProductsStore();
            const products = await loadAndMigrateCatalog(store);
            return jsonResponse(200, {
                products: fullCatalogRequested ? products : products.map(toProductListItem)
            });
        }

        if (event.httpMethod !== 'POST') {
            return jsonResponse(405, { error: 'Method not allowed' });
        }

        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        let payload;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'Product data must be valid JSON.' });
        }
        if (!Array.isArray(payload.products)) {
            return jsonResponse(400, { error: 'Products must be an array' });
        }

        if (JSON.stringify(payload.products).length > 25 * 1024 * 1024) {
            return jsonResponse(413, { error: 'Product data is too large' });
        }

        const store = getProductsStore();
        await loadAndMigrateCatalog(store);
        const stockBases = new Map(payload.products.map(product => [String(product?.id), product?.stockBase]));
        const migratedProducts = await migrateProductImages(payload.products);
        // Saved only if no order changed the stock in between; otherwise merged again.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            let currentProducts;
            let etag = '';
            if (typeof store.getWithMetadata === 'function') {
                const entry = await store.getWithMetadata(productKey, { type: 'json' });
                currentProducts = entry?.data;
                etag = entry?.etag || '';
            } else {
                currentProducts = await store.get(productKey, { type: 'json' });
            }
            const preparedProducts = keepServerStock(migratedProducts, stockBases, currentProducts);
            const sizeError = validateChangedProductSizes(preparedProducts, currentProducts);
            if (sizeError) return jsonResponse(400, { error: sizeError });
            const saved = etag
                ? await store.setJSON(productKey, preparedProducts, { onlyIfMatch: etag })
                : await store.setJSON(productKey, preparedProducts);
            if (!etag || saved?.modified !== false) return jsonResponse(200, { ok: true });
        }
        return jsonResponse(409, { error: 'The catalog changed while saving. Please try again.' });
    } catch (error) {
        console.error('Netlify products function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared products' });
    }
};
