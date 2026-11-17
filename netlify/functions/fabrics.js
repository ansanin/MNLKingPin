// Fabric types for the Design Studio. The admin adds each fabric with a photo;
// customers pick one while customizing a top or bottom.
//   GET                       -> { fabrics: [...] } (public, available ones first)
//   GET ?image=<id>&v=<n>     -> the fabric photo
//   POST (admin) { action: 'save', fabric: { id?, name, description, usedFor, available }, image?, removeImage? }
//   POST (admin) { action: 'delete', id }
const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');

const LIST_KEY = 'fabric-list';
const MAX_FABRICS = 60;
const MAX_IMAGE_CHARS = 1600000; // about 1.2 MB of image data
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=]+)$/i;
const USED_FOR = ['tops', 'bottoms', 'both'];

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function getFabricStore() {
    return getStore('kingpin-fabrics');
}

// Every photo version is kept, so orders that used an older photo still show it.
function imageKey(id, version) {
    return `fabric-image-${id}-v${version}`;
}

function publicFabric(fabric) {
    return {
        id: fabric.id,
        name: fabric.name,
        description: fabric.description || '',
        usedFor: USED_FOR.includes(fabric.usedFor) ? fabric.usedFor : 'both',
        available: fabric.available !== false,
        imageUrl: fabric.imageVersion ? `/.netlify/functions/fabrics?image=${encodeURIComponent(fabric.id)}&v=${fabric.imageVersion}` : '',
        updatedAt: fabric.updatedAt || ''
    };
}

async function readFabrics(store) {
    const list = await store.get(LIST_KEY, { type: 'json' });
    return Array.isArray(list) ? list.filter(fabric => fabric && fabric.id && fabric.name) : [];
}

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const store = getFabricStore();

        if (event.httpMethod === 'GET') {
            const imageId = String(event.queryStringParameters?.image || '');
            if (imageId) {
                if (!/^[a-z0-9-]{1,64}$/i.test(imageId)) return jsonResponse(400, { error: 'A valid fabric photo is required.' });
                const version = /^\d{1,6}$/.test(String(event.queryStringParameters?.v || '')) ? String(event.queryStringParameters.v) : '1';
                const dataUrl = await store.get(imageKey(imageId, version), { type: 'text' });
                const match = String(dataUrl || '').match(IMAGE_DATA_URL);
                if (!match) return jsonResponse(404, { error: 'Fabric photo not found.' });
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': match[1],
                        // The link changes (v=) whenever the photo is replaced.
                        'Cache-Control': 'public, max-age=86400',
                        'X-Content-Type-Options': 'nosniff'
                    },
                    isBase64Encoded: true,
                    body: match[2]
                };
            }
            const fabrics = (await readFabrics(store)).map(publicFabric)
                .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
            return jsonResponse(200, { fabrics });
        }

        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        if (authentication.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        let payload;
        try {
            payload = JSON.parse(event.body || '{}');
        } catch (error) {
            return jsonResponse(400, { error: 'The fabric request must be valid JSON.' });
        }

        const fabrics = await readFabrics(store);

        if (payload.action === 'delete') {
            const id = String(payload.id || '');
            const index = fabrics.findIndex(fabric => fabric.id === id);
            if (index < 0) return jsonResponse(404, { error: 'Fabric not found.' });
            fabrics.splice(index, 1);
            // The photos stay saved for orders that used this fabric.
            await store.setJSON(LIST_KEY, fabrics);
            return jsonResponse(200, { ok: true, fabrics: fabrics.map(publicFabric) });
        }

        if (payload.action !== 'save') return jsonResponse(400, { error: 'Unknown fabric action.' });
        const input = payload.fabric || {};
        const name = cleanText(input.name, 60);
        if (!name) return jsonResponse(400, { error: 'Enter the fabric name.' });
        const description = cleanText(input.description, 240);
        const usedFor = USED_FOR.includes(input.usedFor) ? input.usedFor : 'both';
        const image = String(payload.image || '');
        if (image && (!IMAGE_DATA_URL.test(image) || image.length > MAX_IMAGE_CHARS)) {
            return jsonResponse(400, { error: 'Use a PNG, JPG, GIF or WEBP fabric photo up to about 1 MB.' });
        }

        const id = String(input.id || '');
        let fabric = id ? fabrics.find(item => item.id === id) : null;
        if (id && !fabric) return jsonResponse(404, { error: 'Fabric not found.' });
        if (fabrics.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
            return jsonResponse(409, { error: `A fabric named "${name}" already exists.` });
        }
        if (!fabric) {
            if (fabrics.length >= MAX_FABRICS) return jsonResponse(400, { error: `You can list up to ${MAX_FABRICS} fabrics.` });
            fabric = { id: require('crypto').randomUUID(), imageVersion: 0, createdAt: new Date().toISOString() };
            fabrics.push(fabric);
        }
        Object.assign(fabric, { name, description, usedFor, available: input.available !== false, updatedAt: new Date().toISOString() });
        if (image) {
            // Counts every photo ever saved, so a new photo never reuses an older version number.
            const version = Math.max(Number(fabric.photoCounter) || 0, Number(fabric.imageVersion) || 0) + 1;
            await store.set(imageKey(fabric.id, version), image);
            fabric.imageVersion = version;
            fabric.photoCounter = version;
        } else if (payload.removeImage === true && fabric.imageVersion) {
            fabric.imageVersion = 0;
        }
        await store.setJSON(LIST_KEY, fabrics);
        return jsonResponse(200, { ok: true, fabric: publicFabric(fabric), fabrics: fabrics.map(publicFabric) });
    } catch (error) {
        console.error('Netlify fabrics function error:', error);
        return jsonResponse(500, { error: 'Unable to load or save fabric types.' });
    }
};

module.exports.publicFabric = publicFabric;
