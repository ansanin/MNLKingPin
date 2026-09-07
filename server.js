const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8000;
const PUBLIC_DIR = __dirname;

function sendJson(res, statusCode, body) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function readJsonBody(req, maxLength = 100000) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > maxLength) reject(new Error('Request body is too large'));
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch (error) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

async function handleGcashQr(req, res) {
    const storageFile = path.join(PUBLIC_DIR, 'uploads', 'gcash_qr.json');

    if (req.method === 'GET') {
        fs.readFile(storageFile, 'utf8', (error, data) => {
            if (error && error.code === 'ENOENT') return sendJson(res, 200, { gcashQRCode: null });
            if (error) return sendJson(res, 500, { error: 'Unable to read QR image' });
            try {
                const saved = JSON.parse(data);
                sendJson(res, 200, { gcashQRCode: saved.gcashQRCode || null });
            } catch (parseError) {
                sendJson(res, 500, { error: 'Saved QR image is invalid' });
            }
        });
        return;
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    try {
        const payload = await readJsonBody(req, 6 * 1024 * 1024);
        const qrCode = payload.gcashQRCode || '';
        if (!/^data:image\/(png|jpeg|jpg|gif);base64,/.test(qrCode)) {
            return sendJson(res, 400, { error: 'A valid QR image is required' });
        }

        fs.mkdirSync(path.dirname(storageFile), { recursive: true });
        fs.writeFileSync(storageFile, JSON.stringify({ gcashQRCode: qrCode }));
        sendJson(res, 200, { ok: true });
    } catch (error) {
        console.error('GCash QR storage error:', error.message);
        sendJson(res, 500, { error: 'Unable to save QR image' });
    }
}

async function handleProducts(req, res) {
    const storageFile = path.join(PUBLIC_DIR, 'uploads', 'products.json');

    if (req.method === 'GET') {
        fs.readFile(storageFile, 'utf8', (error, data) => {
            if (error && error.code === 'ENOENT') return sendJson(res, 200, { products: [] });
            if (error) return sendJson(res, 500, { error: 'Unable to read products' });
            try {
                const saved = JSON.parse(data);
                sendJson(res, 200, { products: Array.isArray(saved.products) ? saved.products : [] });
            } catch (parseError) {
                sendJson(res, 500, { error: 'Saved products are invalid' });
            }
        });
        return;
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    try {
        const payload = await readJsonBody(req, 25 * 1024 * 1024);
        if (!Array.isArray(payload.products)) return sendJson(res, 400, { error: 'Products must be an array' });
        fs.mkdirSync(path.dirname(storageFile), { recursive: true });
        fs.writeFileSync(storageFile, JSON.stringify({ products: payload.products }));
        sendJson(res, 200, { ok: true });
    } catch (error) {
        console.error('Product storage error:', error.message);
        sendJson(res, 500, { error: 'Unable to save products' });
    }
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname !== '/migrate-products.html') {
        const apacheUrl = `http://localhost/KingPinSystem${parsedUrl.path}`;
        res.writeHead(302, {
            Location: apacheUrl,
            'Cache-Control': 'no-store'
        });
        res.end();
        return;
    }

    if (parsedUrl.pathname === '/api/gcash-qr') {
        return handleGcashQr(req, res);
    }

    if (parsedUrl.pathname === '/api/products') {
        return handleProducts(req, res);
    }

    const requestedPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    let filePath = path.join(PUBLIC_DIR, decodeURIComponent(requestedPath));
    
    const extname = path.extname(filePath);
    let contentType = 'text/plain';
    
    if (extname === '.html') contentType = 'text/html';
    else if (extname === '.css') contentType = 'text/css';
    else if (extname === '.js') contentType = 'text/javascript';
    else if (extname === '.json') contentType = 'application/json';
    else if (extname === '.png') contentType = 'image/png';
    else if (extname === '.jpg' || extname === '.jpeg') contentType = 'image/jpeg';
    else if (extname === '.gif') contentType = 'image/gif';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - File Not Found</h1>');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(data);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Press Ctrl+C to stop the server`);
});
