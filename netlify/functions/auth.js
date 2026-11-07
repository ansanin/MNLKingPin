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
const { emailChangeKey, isActiveAccount, isValidEmail, moveAccount } = require('./lib/customer-data');

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

async function sendVerificationEmail(email, code, {
    subject = 'Verify your MNL KingPin account',
    intro = 'Your account verification code is'
} = {}) {
    const html = `<p>${escapeHtml(intro)} <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`;
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
            subject,
            html
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
                subject,
                html
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
    if (isActiveAccount(existing)) return jsonResponse(409, { error: 'An account already exists for this email. Sign in instead.' });

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

function requireCustomer(event) {
    const authentication = authenticateEvent(event);
    if (!authentication.ok) return { response: jsonResponse(authentication.statusCode, { error: authentication.error }) };
    if (authentication.claims.role !== 'customer') return { response: jsonResponse(403, { error: 'Customer access required.' }) };
    return { email: normalizeEmail(authentication.claims.sub) };
}

// Step 1 of an email change: send a code to the new address so a typo
// cannot lock the customer out of their account.
async function handleEmailChangeRequest(store, event, data) {
    const customer = requireCustomer(event);
    if (customer.response) return customer.response;
    const currentEmail = customer.email;
    const newEmail = normalizeEmail(data.newEmail);
    if (!isValidEmail(newEmail)) return jsonResponse(400, { error: 'Enter a valid new email address.' });
    if (newEmail === currentEmail) return jsonResponse(400, { error: 'The new email is the same as your current email.' });

    const account = await store.get(accountKey(currentEmail), { type: 'json' });
    if (!isActiveAccount(account)) return jsonResponse(404, { error: 'Customer account was not found.' });
    const existing = await store.get(accountKey(newEmail), { type: 'json' });
    if (isActiveAccount(existing)) return jsonResponse(409, { error: 'Another account already uses this email.' });

    // Name and details for the new email's customer entry. The old email's
    // entry keeps the current details, so they are not saved until confirmed.
    const profile = {
        username: String(data.username ?? account.username ?? '').trim(),
        fullName: String(data.fullName ?? account.fullName ?? '').trim(),
        phone: String(data.phone ?? account.phone ?? '').trim(),
        address: String(data.address ?? account.address ?? '').trim()
    };
    if (profile.username.length < 3 || profile.username.length > 60 || !profile.fullName || profile.fullName.length > 120
        || profile.phone.length > 40 || profile.address.length > 500) {
        return jsonResponse(400, { error: 'Enter a username (3–60 characters), name, phone, and address within the allowed lengths.' });
    }

    const key = emailChangeKey(currentEmail);
    const previous = await store.get(key, { type: 'json' });
    if (previous?.requestedAt && Date.now() - previous.requestedAt < 60 * 1000) {
        return jsonResponse(429, { error: 'Wait one minute before requesting another code.' });
    }
    const code = String(cryptoRandomCode());
    await store.setJSON(key, {
        newEmail,
        profile,
        codeHash: hashVerificationCode(code),
        requestedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0
    });
    await sendVerificationEmail(newEmail, code, {
        subject: 'Confirm your new MNL KingPin email',
        intro: 'Use this code to confirm your new account email:'
    });
    return jsonResponse(200, { ok: true, verificationRequired: true, newEmail });
}

// Step 2: check the code, move the account to the new email, and issue a
// new session because the old token is tied to the old email.
async function handleEmailChangeConfirm(store, event, data) {
    const customer = requireCustomer(event);
    if (customer.response) return customer.response;
    const oldEmail = customer.email;
    const key = emailChangeKey(oldEmail);
    const pending = await store.get(key, { type: 'json' });
    if (!pending || pending.expiresAt < Date.now()) return jsonResponse(400, { error: 'The code expired. Request a new code.' });
    if (pending.attempts >= 5) return jsonResponse(429, { error: 'Too many attempts. Request a new code.' });
    if (!safeEqual(hashVerificationCode(data.code || ''), pending.codeHash)) {
        pending.attempts += 1;
        await store.setJSON(key, pending);
        return jsonResponse(400, { error: 'The code is incorrect.' });
    }

    const newEmail = pending.newEmail;
    const account = await store.get(accountKey(oldEmail), { type: 'json' });
    if (!isActiveAccount(account)) return jsonResponse(404, { error: 'Customer account was not found.' });
    const existing = await store.get(accountKey(newEmail), { type: 'json' });
    if (isActiveAccount(existing)) return jsonResponse(409, { error: 'Another account already uses this email.' });

    const movedAccount = await moveAccount(store, account, newEmail, pending.profile || {});
    return jsonResponse(200, { ok: true, previousEmail: oldEmail, ...issueCustomerSession(movedAccount) });
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
            if (!isActiveAccount(account)) return jsonResponse(401, { error: 'Customer account is unavailable.' });
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
        if (data.action === 'request-email-change') return await handleEmailChangeRequest(store, event, data);
        if (data.action === 'confirm-email-change') return await handleEmailChangeConfirm(store, event, data);

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
            if (!isActiveAccount(account)) return jsonResponse(404, { error: 'Customer account was not found.' });
            const updatedAccount = { ...account, username, fullName, phone, address };
            await store.setJSON(key, updatedAccount);
            return jsonResponse(200, { ok: true, user: publicAccount(updatedAccount) });
        }

        if (data.action === 'login') {
            const email = normalizeEmail(data.email);
            const account = await store.get(accountKey(email), { type: 'json' });
            if (!isActiveAccount(account) || !await verifyPassword(data.password || '', account.passwordHash)) {
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

        if (data.action === 'staff-login') {
            const staff = await store.get('staff-credentials', { type: 'json' });
            if (!staff || !safeEqual(data.username || '', staff.username) || !await verifyPassword(data.password || '', staff.passwordHash)) return jsonResponse(401, { error: 'Staff username or password is incorrect.' });
            return jsonResponse(200, { ok: true, token: signAccessToken({ sub: staff.username, role: 'staff' }), user: { username: staff.username }, role: 'staff' });
        }
        if (data.action === 'set-staff-credentials') {
            const auth = authenticateEvent(event);
            if (!auth.ok) return jsonResponse(auth.statusCode, { error: auth.error });
            if (auth.claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });
            const username = String(data.username || '').trim();
            const password = String(data.password || '');
            if (username.length < 3 || username.length > 60 || password.length < 8 || password.length > 128) return jsonResponse(400, { error: 'Username must be 3?60 characters and password 8?128 characters.' });
            await store.setJSON('staff-credentials', { username, passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() });
            return jsonResponse(200, { ok: true });
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
            if (!isActiveAccount(account)) {
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
        if (action === 'request-email-change') {
            return jsonResponse(503, { error: 'We could not send the code to the new email. Check the Netlify SMTP or Resend settings, then try again in one minute.' });
        }
        return jsonResponse(500, { error: 'Unable to complete authentication.' });
    }
};