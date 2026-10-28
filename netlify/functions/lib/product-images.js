const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const imageDataPattern = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));(base64),([a-z0-9+/=]+)$/i;
const imageUrlPattern = /^\/(?:\.netlify\/functions\/product-image\?key=[a-f0-9]{64}|uploads\/[a-z0-9_./%-]+)$/i;
const imageStoreName = 'kingpin-product-images';

function getImageStore() {
    return getStore(imageStoreName);
}

function parseImageDataUrl(value) {
    const match = imageDataPattern.exec(String(value || ''));
    if (match) {
        return {
            contentType: match[1].toLowerCase(),
            bytes: Buffer.from(match[3], 'base64')
        };
    }

    const encodedSvg = /^data:image\/svg\+xml,([\s\S]+)$/i.exec(String(value || ''));
    if (!encodedSvg) return null;
    try {
        return { contentType: 'image/svg+xml', bytes: Buffer.from(decodeURIComponent(encodedSvg[1]), 'utf8') };
    } catch (error) {
        return null;
    }
}

async function storeProductImage(value) {
    const source = String(value || '');
    if (!source) return '';
    if (imageUrlPattern.test(source)) return source;
    if (/^https:\/\//i.test(source)) return source;

    const parsed = parseImageDataUrl(source);
    if (!parsed || !parsed.bytes.length) {
        throw new Error('Product images must be PNG, JPEG, GIF, WebP, or SVG data URLs.');
    }

    const key = crypto.createHash('sha256').update(parsed.bytes).digest('hex');
    const store = getImageStore();
    const metadata = await store.getMetadata(key);
    if (!metadata) {
        const bytes = parsed.bytes;
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        await store.set(key, arrayBuffer, {
            onlyIfNew: true,
            metadata: { contentType: parsed.contentType }
        });
    }

    return `/.netlify/functions/product-image?key=${key}`;
}

async function migrateProductImages(products) {
    const migratedProducts = await Promise.all((products || []).map(async product => {
        const migrated = { ...product };
        const oldImages = Array.isArray(product.images) ? product.images : [];
        const images = await Promise.all(oldImages.map(storeProductImage));
        const image = await storeProductImage(product.image || images[0] || '');
        migrated.images = images.length ? images : image ? [image] : [];
        migrated.image = image || migrated.images[0] || '';
        migrated.thumbnailImage = await storeProductImage(product.thumbnailImage || migrated.image);
        migrated.sizeChartImage = await storeProductImage(product.sizeChartImage || '');
        return migrated;
    }));

    return migratedProducts;
}

function getProductThumbnail(product) {
    return product.thumbnailImage || product.image || product.images?.[0] || '';
}

function toProductListItem(product) {
    return {
        id: product.id,
        name: product.name,
        type: product.type,
        price: product.price,
        stock: product.stock,
        availableSizes: Array.isArray(product.availableSizes) ? product.availableSizes : [],
        thumbnailUrl: getProductThumbnail(product)
    };
}

module.exports = {
    getImageStore,
    getProductThumbnail,
    migrateProductImages,
    parseImageDataUrl,
    storeProductImage,
    toProductListItem
};
