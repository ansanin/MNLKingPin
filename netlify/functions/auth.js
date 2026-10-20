const nodemailer = require('nodemailer');
const { getStore, connectLambda } = require('@netlify/blobs');
const {
    accountKey,
    authenticateEvent,
    getAuthConfigurationError,
    hashPassword,
    hashVerificationCode,
    safeEqual,
    signAccessToken,
    verifyPassword
} = require('./lib/auth');

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function sendVerificationEmail(email, code) {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: smtpUser, pass: smtpPass }
        });
        await transporter.sendMail({
            from: process.env.SMTP_FROM || smtpUser,
            to: email,
            subject: 'Verify your MNL KingPin account',
            html: `<p>Your account verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`
        });
        return;
    }

    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL,
                to: [email],
                subject: 'Verify your MNL KingPin account',
                html: `<p>Your account verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`
            })
        });
        if (response.ok) return;
        throw new Error('Email provider rejected verification message');
    }

    throw new Error('Account verification email is not configured');
}

function publicAccount(account) {
    return {
        email: account.email,
        username: account.username || account.email,
        fullName: account.fullName || account.email,
        phone: account.phone || '',
        address: account.address || ''
    };
}

function issueCustomerSession(account) {
    const profile = publicAccount(account);
    return {
        token: signAccessToken({ sub: account.email, role: 'customer', name: profile.fullName }),
        user: profile,
        role: 'customer'
    };
}

async function handleRegistration(store, data) {
    const email = normalizeEmail(data.email);
    const username = String(data.username || '').trim();
    const fullName = String(data.fullName || '').trim();
    const password = String(data.password || '');
    if (!email.includes('@') || !username || !fullName || password.length < 8) {
        return jsonResponse(400, { error: 'Enter a valid email, name, username, and password with at least 8 characters.' });
    }

    const key = accountKey(email);
    const rateLimitKey = `registration-rate-${key}`;
    const lastRequest = await store.get(rateLimitKey, { type: 'json' });
    if (lastRequest?.timestamp && Date.now() - lastRequest.timestamp < 60 * 1000) {
        return jsonResponse(429, { error: 'Wait one minute before requesting another verification code.' });
    }
    await store.setJSON(rateLimitKey, { timestamp: Date.now() });
    const existing = await store.get(key, { type: 'json' });
    if (existing?.verified) return jsonResponse(409, { error: 'An account already exists for this email. Sign in instead.' });

    const code = String(cryptoRandomCode());
    const passwordHash = await hashPassword(password);
    const pending = {
        email,
        username,
        fullName,
        phone: String(data.phone || '').trim(),
        passwordHash,
        codeHash: hashVerificationCode(code),
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0
    };
    await store.setJSON(`pending-${key}`, pending);
    await sendVerificationEmail(email, code);
    return jsonResponse(200, { ok: true, verificationRequired: true, email });
}

function cryptoRandomCode() {
    return require('crypto').randomInt(100000, 1000000);
}

async function handleVerification(store, data) {
    const email = normalizeEmail(data.email);
    const key = accountKey(email);
    const pendingKey = `pending-${key}`;
    const pending = await store.get(pendingKey, { type: 'json' });
    if (!pending || pending.expiresAt < Date.now()) return jsonResponse(400, { error: 'Verification code expired. Submit registration again to receive a new code.' });
    if (pending.attempts >= 5) return jsonResponse(429, { error: 'Too many attempts. Request a new verification code.' });
    if (!safeEqual(hashVerificationCode(data.code || ''), pending.codeHash)) {
        pending.attempts += 1;
        await store.setJSON(pendingKey, pending);
        return jsonResponse(400, { error: 'The verification code is incorrect.' });
    }

    const account = {
        email: pending.email,
        username: pending.username,
        fullName: pending.fullName,
        phone: pending.phone,
        passwordHash: pending.passwordHash,
        verified: true,
        createdAt: new Date().toISOString()
    };
    await store.setJSON(key, account);
    if (typeof store.delete === 'function') await store.delete(pendingKey);
    return jsonResponse(200, { ok: true, ...issueCustomerSession(account) });
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
    if (event.httpMethod === 'GET') {
        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        const { claims } = authentication;
        if (claims.role !== 'customer') {
            return jsonResponse(200, { ok: true, user: claims.sub, role: claims.role, exp: claims.exp });
        }
        try {
            const account = await getStore('kingpin-auth').get(accountKey(claims.sub), { type: 'json' });
            if (!account?.verified) return jsonResponse(401, { error: 'Customer account is unavailable.' });
            return jsonResponse(200, {
                ok: true,
                user: claims.sub,
                role: claims.role,
                exp: claims.exp,
                profile: publicAccount(account)
            });
        } catch (error) {
            console.error('Unable to load customer profile:', error);
            return jsonResponse(500, { error: 'Unable to load customer account information.' });
        }
    }
    if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
    const configurationError = getAuthConfigurationError();
    if (configurationError) return jsonResponse(503, { error: configurationError });

    let action = '';
    try {
        const data = JSON.parse(event.body || '{}');
        action = data.action || '';
        const store = getStore('kingpin-auth');
        if (data.action === 'register') return await handleRegistration(store, data);
        if (data.action === 'verify') return await handleVerification(store, data);

        if (data.action === 'update-customer-profile') {
            const authentication = authenticateEvent(event);
            if (!authentication.ok) {
                return jsonResponse(authentication.statusCode, { error: authentication.error });
            }
            if (authentication.claims.role !== 'customer') {
                return jsonResponse(403, { error: 'Customer access required.' });
            }

            const email = normalizeEmail(data.email);
            const username = String(data.username || '').trim();
            const fullName = String(data.fullName || '').trim();
            const phone = String(data.phone || '').trim();
            const address = String(data.address || '').trim();
            if (email !== normalizeEmail(authentication.claims.sub)) {
                return jsonResponse(400, { error: 'The login email cannot be changed in Customer Settings.' });
            }
            if (username.length < 3 || username.length > 60 || !fullName || fullName.length > 120
                || !phone || phone.length > 40 || !address || address.length > 500) {
                return jsonResponse(400, { error: 'Enter a username (3–60 characters), name, phone, and address within the allowed lengths.' });
            }

            const key = accountKey(authentication.claims.sub);
            const account = await store.get(key, { type: 'json' });
            if (!account?.verified) return jsonResponse(404, { error: 'Customer account was not found.' });
            const updatedAccount = { ...account, username, fullName, phone, address };
            await store.setJSON(key, updatedAccount);
            return jsonResponse(200, { ok: true, user: publicAccount(updatedAccount) });
        }

        if (data.action === 'login') {
            const email = normalizeEmail(data.email);
            const account = await store.get(accountKey(email), { type: 'json' });
            if (!account?.verified || !await verifyPassword(data.password || '', account.passwordHash)) {
                return jsonResponse(401, { error: 'Email or password is incorrect.' });
            }
            return jsonResponse(200, { ok: true, ...issueCustomerSession(account) });
        }

        if (data.action === 'admin-login') {
            const savedAdmin = await store.get('admin-credentials', { type: 'json' });
            const recoveryUsername = process.env.KINGPIN_ADMIN_USERNAME;
            const recoveryPassword = process.env.KINGPIN_ADMIN_PASSWORD;
            if (!savedAdmin && (!recoveryUsername || !recoveryPassword)) {
                return jsonResponse(503, { error: 'Admin login is not configured on the server.' });
            }

            const matchesSavedCredentials = Boolean(savedAdmin)
                && safeEqual(data.username || '', savedAdmin.username)
                && await verifyPassword(data.password || '', savedAdmin.passwordHash);
            const matchesEnvironmentRecovery = Boolean(recoveryUsername && recoveryPassword)
                && safeEqual(data.username || '', recoveryUsername)
                && safeEqual(data.password || '', recoveryPassword);
            if (!matchesSavedCredentials && !matchesEnvironmentRecovery) {
                return jsonResponse(401, { error: 'Admin username or password is incorrect.' });
            }

            const username = matchesSavedCredentials ? savedAdmin.username : recoveryUsername;
            if (matchesEnvironmentRecovery && !matchesSavedCredentials) {
                await store.setJSON('admin-credentials', {
                    username,
                    passwordHash: await hashPassword(recoveryPassword),
                    updatedAt: new Date().toISOString()
                });
            }
            return jsonResponse(200, {
                ok: true,
                token: signAccessToken({ sub: username, role: 'admin' }),
                user: { username },
                role: 'admin'
            });
        }

        if (data.action === 'change-admin-credentials') {
            const authentication = authenticateEvent(event);
            if (!authentication.ok || authentication.claims.role !== 'admin') {
                return jsonResponse(authentication.ok ? 403 : authentication.statusCode, { error: authentication.ok ? 'Admin access required.' : authentication.error });
            }
            const savedAdmin = await store.get('admin-credentials', { type: 'json' });
            const currentPasswordValid = savedAdmin
                ? await verifyPassword(data.currentPassword || '', savedAdmin.passwordHash)
                : Boolean(process.env.KINGPIN_ADMIN_PASSWORD && safeEqual(data.currentPassword || '', process.env.KINGPIN_ADMIN_PASSWORD));
            const username = String(data.username || '').trim();
            const password = String(data.password || '');
            if (!currentPasswordValid) return jsonResponse(401, { error: 'Current admin password is incorrect.' });
            if (username.length < 3 || password.length < 8) return jsonResponse(400, { error: 'Username must be at least 3 characters and password at least 8 characters.' });
            const updatedAdmin = { username, passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() };
            await store.setJSON('admin-credentials', updatedAdmin);
            return jsonResponse(200, {
                ok: true,
                token: signAccessToken({ sub: username, role: 'admin' }),
                user: { username },
                role: 'admin'
            });
        }

        if (data.action === 'google-login') {
            if (!data.credential) return jsonResponse(400, { error: 'Google credential is required.' });
            const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(data.credential)}`);
            if (!googleResponse.ok) return jsonResponse(401, { error: 'Google sign-in could not be verified.' });
            const googleAccount = await googleResponse.json();
            const expectedAudience = process.env.GOOGLE_CLIENT_ID || '620751674943-strv31pamttvkn3jlftptalegihspstn.apps.googleusercontent.com';
            if (googleAccount.aud !== expectedAudience || googleAccount.email_verified !== 'true') {
                return jsonResponse(401, { error: 'Google sign-in could not be verified.' });
            }
            const email = normalizeEmail(googleAccount.email);
            const key = accountKey(email);
            let account = await store.get(key, { type: 'json' });
            if (!account) {
                account = {
                    email,
                    username: email,
                    fullName: googleAccount.name || email,
                    phone: '',
                    verified: true,
                    loginMethod: 'google',
                    createdAt: new Date().toISOString()
                };
                await store.setJSON(key, account);
            }
            return jsonResponse(200, { ok: true, ...issueCustomerSession(account) });
        }

        return jsonResponse(400, { error: 'Unknown authentication action.' });
    } catch (error) {
        console.error('KingPin authentication error:', error);
        if (action === 'register') {
            return jsonResponse(503, { error: 'We could not send the verification email. Check the Netlify SMTP or Resend settings, then try registration again in one minute.' });
        }
        return jsonResponse(500, { error: 'Unable to complete authentication.' });
    }
};