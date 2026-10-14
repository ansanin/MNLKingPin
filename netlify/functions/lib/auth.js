const crypto = require('crypto');

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signAccessToken(claims, secret = process.env.KINGPIN_AUTH_SECRET) {
    if (!secret || secret.length < 32) throw new Error('KINGPIN_AUTH_SECRET must contain at least 32 characters');
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({ ...claims, iat: now, exp: now + 8 * 60 * 60 });
    const unsignedToken = `${header}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(unsignedToken).digest('base64url');
    return `${unsignedToken}.${signature}`;
}

function verifyAccessToken(token, secret = process.env.KINGPIN_AUTH_SECRET) {
    if (!secret || secret.length < 32 || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const unsignedToken = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac('sha256', secret).update(unsignedToken).digest();
    let actual;
    try {
        actual = Buffer.from(parts[2], 'base64url');
    } catch (error) {
        return null;
    }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

    try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (header.alg !== 'HS256' || !claims.sub || !['admin', 'customer'].includes(claims.role)) return null;
        if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
        return claims;
    } catch (error) {
        return null;
    }
}

function getBearerToken(event) {
    const headers = event.headers || {};
    const authorization = headers.authorization || headers.Authorization || '';
    return /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || '';
}

function authenticateEvent(event) {
    const configurationError = getAuthConfigurationError();
    if (configurationError) return { ok: false, statusCode: 503, error: configurationError };
    const claims = verifyAccessToken(getBearerToken(event));
    return claims
        ? { ok: true, claims }
        : { ok: false, statusCode: 401, error: 'Authentication required' };
}

function getAuthConfigurationError() {
    const secret = process.env.KINGPIN_AUTH_SECRET;
    if (!secret) return 'Server authentication is not configured. Add the KINGPIN_AUTH_SECRET Netlify environment variable and redeploy.';
    if (secret.length < 32) return 'Server authentication is misconfigured. KINGPIN_AUTH_SECRET must be at least 32 characters; update it in Netlify and redeploy.';
    return '';
}

function accountKey(email) {
    const digest = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
    return `customer-${digest}`;
}

function hashVerificationCode(code) {
    return crypto.createHmac('sha256', process.env.KINGPIN_AUTH_SECRET).update(String(code)).digest('hex');
}

function safeEqual(first, second) {
    const a = Buffer.from(String(first));
    const b = Buffer.from(String(second));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (error, derivedKey) => {
            if (error) return reject(error);
            resolve(`${salt}:${derivedKey.toString('hex')}`);
        });
    });
}

function verifyPassword(password, storedHash) {
    const [salt, expectedHex] = String(storedHash || '').split(':');
    if (!salt || !/^[a-f0-9]{128}$/i.test(expectedHex || '')) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (error, derivedKey) => {
            if (error) return reject(error);
            resolve(safeEqual(derivedKey.toString('hex'), expectedHex));
        });
    });
}

module.exports = {
    accountKey,
    authenticateEvent,
    hashPassword,
    hashVerificationCode,
    getAuthConfigurationError,
    safeEqual,
    signAccessToken,
    verifyAccessToken,
    verifyPassword
};