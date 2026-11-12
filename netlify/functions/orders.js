const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent, signAccessToken } = require('./lib/auth');
const { PRODUCTION_STAGES, normalizeProductionStatus, validateProductionTransition } = require('../../js/production-tracking');
const { MIN_TEAM_PLAYERS, isValidTeamPlayerCount, areTeamPlayerDetailsComplete, normalizeTeamOrderInput } = require('../../js/team-order');
const { getPaymentSummary, round2 } = require('../../js/payment-summary');

const PROOF_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const PAYMENT_METHODS = ['cash', 'gcash', 'bank-transfer'];

function formatPeso(value) {
    return `PHP ${round2(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function uploadedDesignKey(orderId, itemIndex) {
    return `order-design-${orderId}-${itemIndex}`;
}

function uploadedDesignFileKey(orderId, itemIndex, fileIndex) {
    return `order-design-${orderId}-${itemIndex}-${fileIndex}`;
}

function orderMediaKey(orderId, mediaType) {
    return `order-media-${orderId}-${mediaType}`;
}

// Saves a new payment proof. It replaces the proof shown on the order, and
// every version stays saved under its own key so the admin can still see
// proofs that were rejected or replaced. The version in the link makes
// browsers load the new image instead of a cached older one.
async function storePaymentProof(order, dataUrl, designStore) {
    const orderId = String(order.id);
    const currentKey = orderMediaKey(orderId, 'gcash-proof');
    const proofs = Array.isArray(order.paymentProofs) ? order.paymentProofs : [];
    const previousVersion = Number(order.paymentProofVersion) || (order.gcashPaymentProofUrl ? 1 : 0);
    if (previousVersion) {
        // Orders from before versioning only have the current key: keep that image too.
        const previousKey = `${currentKey}-v${previousVersion}`;
        if (!await designStore.get(previousKey, { type: 'text' })) {
            const previous = await designStore.get(currentKey, { type: 'text' });
            if (previous) await designStore.set(previousKey, previous);
        }
        if (!proofs.some(proof => proof.version === previousVersion)) {
            proofs.push({
                version: previousVersion,
                uploadedAt: '',
                status: order.paymentStatus === 'rejected' ? 'rejected' : 'replaced',
                reason: order.paymentStatus === 'rejected' ? String(order.paymentRejectionReason || '') : ''
            });
        }
    }
    const version = previousVersion + 1;
    await designStore.set(`${currentKey}-v${version}`, dataUrl);
    await designStore.set(currentKey, dataUrl);
    proofs.forEach(proof => { if (proof.status === 'pending') proof.status = 'replaced'; });
    proofs.push({ version, uploadedAt: new Date().toISOString(), status: 'pending', reason: '' });
    order.paymentProofs = proofs;
    order.paymentProofVersion = version;
    order.gcashPaymentProofUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&media=gcash-proof&v=${version}`;
}

function markLatestProof(order, status, reason = '') {
    const proofs = Array.isArray(order.paymentProofs) ? order.paymentProofs : [];
    const latest = proofs.find(proof => proof.version === Number(order.paymentProofVersion)) || proofs[proofs.length - 1];
    if (!latest) return;
    latest.status = status;
    latest.reason = reason;
    latest.reviewedAt = new Date().toISOString();
}

// A GCash proof for the rest of the payment, sent after the downpayment was
// verified. Kept apart from the downpayment proof, with every version saved.
async function storeBalanceProof(order, dataUrl, designStore, amountDue) {
    const orderId = String(order.id);
    const baseKey = orderMediaKey(orderId, 'balance-proof');
    const proofs = Array.isArray(order.balanceProofs) ? order.balanceProofs : [];
    const version = (Number(order.balanceProofVersion) || 0) + 1;
    await designStore.set(`${baseKey}-v${version}`, dataUrl);
    await designStore.set(baseKey, dataUrl);
    proofs.forEach(proof => { if (proof.status === 'pending') proof.status = 'replaced'; });
    proofs.push({ version, uploadedAt: new Date().toISOString(), status: 'pending', reason: '', amountDue: round2(amountDue) });
    order.balanceProofs = proofs;
    order.balanceProofVersion = version;
    order.balanceProofStatus = 'pending';
    order.balanceProofUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&media=balance-proof&v=${version}`;
}

function markLatestBalanceProof(order, status, reason = '') {
    const proofs = Array.isArray(order.balanceProofs) ? order.balanceProofs : [];
    const latest = proofs.find(proof => proof.version === Number(order.balanceProofVersion)) || proofs[proofs.length - 1];
    if (latest) {
        latest.status = status;
        latest.reason = reason;
        latest.reviewedAt = new Date().toISOString();
    }
    order.balanceProofStatus = status;
}

async function removeInlineOrderMedia(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [field, mediaType] of [['gcashQRCode', 'gcash-qr'], ['gcashPaymentProof', 'gcash-proof']]) {
        const dataUrl = String(normalized[field] || '');
        if (!PROOF_DATA_URL.test(dataUrl)) continue;

        const orderId = String(normalized.id);
        if (mediaType === 'gcash-proof') {
            // A proof still inside the order record is the newest one the
            // customer sent, so it always replaces the saved proof.
            await storePaymentProof(normalized, dataUrl, designStore);
        } else {
            const key = orderMediaKey(orderId, mediaType);
            const savedMedia = await designStore.get(key, { type: 'text' });
            if (!savedMedia) await designStore.set(key, dataUrl);
            normalized[`${field}Url`] = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&media=${mediaType}`;
        }
        delete normalized[field];
        changed = true;
    }

    return { order: normalized, changed };
}

// Orders saved before payment amounts were recorded get their payment list
// here. A downpayment the admin already verified is carried over as one entry.
function ensurePaymentLedger(order) {
    if (Array.isArray(order.payments)) return;
    const before = getPaymentSummary(order);
    order.payments = [];
    if (before.amountPaid > 0) {
        order.payments.push({
            id: require('crypto').randomUUID(),
            type: before.amountPaid >= before.total ? 'full' : 'downpayment',
            method: String(order.paymentMethod || '').toLowerCase() === 'gcash' ? 'gcash' : 'cash',
            amount: before.amountPaid,
            reference: '',
            receivedAt: '',
            recordedAt: new Date().toISOString(),
            recordedBy: 'system',
            note: 'Verified before payment amounts were recorded.'
        });
    }
}

function parsePaymentAmount(value) {
    if (value === undefined || value === null || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? round2(amount) : NaN;
}

function validPaymentDate(value) {
    if (!value) return '';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 24 * 60 * 60 * 1000 ? null : date.toISOString();
}

async function removeInlineDesignFiles(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [itemIndex, item] of (normalized.items || []).entries()) {
        for (const imageField of ['image', 'productImage', 'sizeChartImage']) {
            if (typeof item[imageField] === 'string' && item[imageField].startsWith('data:')) {
                delete item[imageField];
                changed = true;
            }
        }
        if (Array.isArray(item.images)) {
            const filteredImages = item.images.filter(image => !(typeof image === 'string' && image.startsWith('data:')));
            if (filteredImages.length !== item.images.length) {
                item.images = filteredImages;
                changed = true;
            }
        }

        if (item.designType !== 'uploaded' || !item.details) continue;

        if (Array.isArray(item.details.uploadedFiles) && item.details.uploadedFiles.length) {
            const uploadedFiles = [];
            for (const [fileIndex, file] of item.details.uploadedFiles.entries()) {
                const uploadedFile = String(file.uploadedFile || '');
                const match = uploadedFile.match(/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([a-z0-9+/=]+)$/i);
                if (!match) continue;
                const designKey = uploadedDesignFileKey(normalized.id, itemIndex, fileIndex);
                if (!await designStore.get(designKey, { type: 'text' })) await designStore.set(designKey, uploadedFile);
                uploadedFiles.push({
                    fileName: String(file.fileName || 'customer-design'),
                    fileType: String(file.fileType || match[1]),
                    uploadedFileUrl: `/.netlify/functions/order-design?orderId=${encodeURIComponent(normalized.id)}&itemIndex=${itemIndex}&fileIndex=${fileIndex}`
                });
            }
            if (uploadedFiles.length) {
                item.details.uploadedFiles = uploadedFiles;
                item.details.uploadedFileUrl = uploadedFiles[0].uploadedFileUrl;
                item.details.fileName = uploadedFiles.map(file => file.fileName).join(', ');
                delete item.details.uploadedFile;
                changed = true;
                continue;
            }
        }

        const uploadedFile = String(item.details.uploadedFile || '');
        const match = uploadedFile.match(/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([a-z0-9+/=]+)$/i);
        if (!match) continue;

        const orderId = String(normalized.id);
        const designKey = uploadedDesignKey(orderId, itemIndex);
        const savedDesign = await designStore.get(designKey, { type: 'text' });
        if (!savedDesign) await designStore.set(designKey, uploadedFile);
        item.details.uploadedFileUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&itemIndex=${itemIndex}`;
        delete item.details.uploadedFile;
        changed = true;
    }

    const mediaResult = await removeInlineOrderMedia(normalized, designStore);
    return { order: mediaResult.order, changed: changed || mediaResult.changed };
}

function isActiveOrder(order) {
    return !['completed', 'delivered', 'cancelled'].includes(String(order.status || '').toLowerCase());
}

function orderRecordKey(orderId) {
    return `order-${String(orderId)}`;
}

async function readOrderRecords(store, orderIds) {
    const records = await Promise.all(orderIds.map(orderId => store.get(orderRecordKey(orderId), { type: 'json' })));
    return records.filter(order => order && order.id);
}

async function writeOrderRecord(store, order) {
    await store.setJSON(orderRecordKey(order.id), order);

    const allOrderIds = (await store.get('all-order-ids', { type: 'json' })) || [];
    if (!allOrderIds.some(orderId => String(orderId) === String(order.id))) allOrderIds.push(order.id);
    await store.setJSON('all-order-ids', allOrderIds);

    const activeOrderIds = (await store.get('active-order-ids', { type: 'json' })) || [];
    const nextActiveOrderIds = activeOrderIds.filter(orderId =>
        String(orderId) !== String(order.id)
    );
    if (isActiveOrder(order)) nextActiveOrderIds.push(order.id);
    await store.setJSON('active-order-ids', nextActiveOrderIds);
}

function stageLabel(status) {
    return PRODUCTION_STAGES.find(stage => stage.id === status)?.label || (status === 'on-hold' ? 'On Hold' : 'Cancelled');
}

function addProductionHistory(order, event, status, actor, remarks = '') {
    const history = Array.isArray(order.productionHistory) ? order.productionHistory : [];
    history.push({
        id: require('crypto').randomUUID(),
        event,
        status,
        label: stageLabel(status),
        actor,
        remarks: String(remarks || '').trim().slice(0, 1000),
        timestamp: new Date().toISOString()
    });
    order.productionHistory = history;
}

function normalizeStoredOrder(order) {
    const normalized = { ...order };
    normalized.productionStatus = normalizeProductionStatus(normalized);
    if (!Array.isArray(normalized.productionHistory)) {
        normalized.productionHistory = [{
            id: `legacy-${normalized.id}`,
            event: 'migrated',
            status: normalized.productionStatus,
            label: stageLabel(normalized.productionStatus),
            actor: 'system',
            remarks: 'Production tracking initialized for this existing order.',
            timestamp: new Date().toISOString()
        }];
    }
    return normalized;
}

function mapProductionStatusToLegacy(status) {
    if (status === 'printing' || status === 'quality-checking') return 'processing';
    if (status === 'ready-for-release') return 'ready-for-delivery';
    if (status === 'completed') return 'delivered';
    if (status === 'cancelled' || status === 'on-hold') return status;
    return 'pending';
}

async function readAllOrders(legacyStore, indexStore) {
    const legacyOrders = (await legacyStore.get('orders', { type: 'json' })) || [];
    const priorOrders = (await legacyStore.get('orders-v2', { type: 'json' })) || [];
    const priorArray = (await indexStore.get('orders', { type: 'json' })) || [];
    const ids = (await indexStore.get('all-order-ids', { type: 'json' })) || [];
    const indexed = await readOrderRecords(indexStore, ids);
    const byId = new Map();
    [...legacyOrders, ...priorOrders, ...priorArray, ...indexed].forEach(order => {
        if (order?.id) byId.set(String(order.id), order);
    });
    return Array.from(byId.values());
}

// Recomputes order totals with the current catalog prices. Items are matched
// to products by product id; custom and uploaded designs have no catalog
// price and keep theirs. The total changes by the price difference only, so
// anything else in the original total is kept. Team orders multiply by players.
function recomputeOrderPrices(orders, catalog) {
    const productsById = new Map((Array.isArray(catalog) ? catalog : [])
        .filter(product => product && product.id !== undefined && Number.isFinite(Number(product.price)) && Number(product.price) >= 0)
        .map(product => [String(product.id), Number(product.price)]));
    const changes = [];
    let totalBefore = 0;
    let totalAfter = 0;
    for (const order of orders) {
        const before = Number(order.totalAmount) || 0;
        totalBefore += before;
        const multiplier = order.teamOrder?.isTeamOrder ? (Number(order.teamOrder.totalPlayers) || 0) : 1;
        const itemChanges = [];
        let delta = 0;
        (order.items || []).forEach((item, index) => {
            if (!item || item.designType) return;
            const currentPrice = productsById.get(String(item.id));
            const oldPrice = Number(item.price);
            if (currentPrice === undefined || !Number.isFinite(oldPrice) || currentPrice === oldPrice) return;
            const quantity = Number(item.quantity) || 1;
            delta += (currentPrice - oldPrice) * quantity * multiplier;
            itemChanges.push({ index, name: item.name, oldPrice, newPrice: currentPrice, quantity });
        });
        const after = Math.max(0, Math.round((before + delta) * 100) / 100);
        totalAfter += itemChanges.length ? after : before;
        if (itemChanges.length) {
            changes.push({ orderId: order.id, customerName: order.customerName || '', status: order.status || 'pending', totalBefore: before, totalAfter: after, items: itemChanges });
        }
    }
    return {
        ordersChecked: orders.length,
        ordersChanged: changes.length,
        totalBefore: Math.round(totalBefore * 100) / 100,
        totalAfter: Math.round(totalAfter * 100) / 100,
        changes
    };
}

function applyPriceChange(order, change, appliedAt) {
    const updated = JSON.parse(JSON.stringify(order));
    change.items.forEach(itemChange => {
        if (updated.items?.[itemChange.index]) updated.items[itemChange.index].price = itemChange.newPrice;
    });
    updated.totalAmount = change.totalAfter;
    updated.priceAdjustments = [...(Array.isArray(updated.priceAdjustments) ? updated.priceAdjustments : []), {
        at: appliedAt,
        totalBefore: change.totalBefore,
        totalAfter: change.totalAfter,
        items: change.items.map(item => ({ name: item.name, oldPrice: item.oldPrice, newPrice: item.newPrice }))
    }];
    return updated;
}

async function persistOrder(indexStore, designStore, order) {
    const normalized = (await removeInlineDesignFiles(order, designStore)).order;
    await writeOrderRecord(indexStore, normalized);
    return normalized;
}

async function enqueueProductionEmail(event, orderId, eventId) {
    const headers = event.headers || {};
    const authorization = headers.authorization || headers.Authorization || '';
    const host = headers.host || headers.Host;
    const baseUrl = process.env.DEPLOY_URL || process.env.URL || (host ? `https://${host}` : '');
    if (!authorization || !baseUrl) {
        console.warn('Production email was not queued: function origin or admin authorization is unavailable.');
        return;
    }

    try {
        const endpoint = new URL('/.netlify/functions/production-email-background', baseUrl);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, eventId })
        });
        if (!response.ok) console.error('Production email background task was not queued:', response.status);
    } catch (error) {
        console.error('Production email background task could not be queued after save:', error);
    }
}

function validEstimate(value) {
    return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addMediaTicket(url, claims, orderId, media, itemIndex = '', fileIndex = '') {
    if (!url || !String(url).startsWith('/.netlify/functions/order-design?')) return url;
    const ticket = signAccessToken({ sub: claims.sub, role: claims.role, mediaOrderId: String(orderId), media, itemIndex: String(itemIndex), fileIndex: String(fileIndex) });
    return `${url}&access=${encodeURIComponent(ticket)}`;
}

function decorateOrderMedia(order, claims) {
    const decorated = JSON.parse(JSON.stringify(order));
    decorated.gcashQRCodeUrl = addMediaTicket(decorated.gcashQRCodeUrl, claims, decorated.id, 'gcash-qr');
    decorated.gcashPaymentProofUrl = addMediaTicket(decorated.gcashPaymentProofUrl, claims, decorated.id, 'gcash-proof');
    decorated.balanceProofUrl = addMediaTicket(decorated.balanceProofUrl, claims, decorated.id, 'balance-proof');
    decorated.finalDesignUrl = addMediaTicket(decorated.finalDesignUrl, claims, decorated.id, 'final-design');
    [['paymentProofs', 'gcash-proof'], ['balanceProofs', 'balance-proof']].forEach(([field, media]) => {
        (decorated[field] || []).forEach(proof => {
            const version = Number(proof?.version);
            if (!Number.isInteger(version) || version < 1) return;
            proof.url = addMediaTicket(`/.netlify/functions/order-design?orderId=${encodeURIComponent(decorated.id)}&media=${media}&v=${version}`, claims, decorated.id, media);
        });
    });
    decorated.paymentSummary = getPaymentSummary(decorated);
    (decorated.items || []).forEach((item, itemIndex) => {
        if (item.details?.uploadedFileUrl) {
            const firstFileIndex = item.details.uploadedFiles?.length ? 0 : '';
            item.details.uploadedFileUrl = addMediaTicket(item.details.uploadedFileUrl, claims, decorated.id, 'item-design', itemIndex, firstFileIndex);
        }
        (item.details?.uploadedFiles || []).forEach((file, fileIndex) => {
            file.uploadedFileUrl = addMediaTicket(file.uploadedFileUrl, claims, decorated.id, 'item-design', itemIndex, fileIndex);
        });
    });
    return decorated;
}

exports.handler = async function handler(event) {
    connectLambda(event);
    if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});

    try {
        const authentication = authenticateEvent(event);
        if (!authentication.ok) return jsonResponse(authentication.statusCode, { error: authentication.error });
        const { claims } = authentication;
        const store = getStore('kingpin-orders');
        const orderIndexStore = getStore('kingpin-order-index');
        const designStore = getStore('kingpin-order-designs');

        if (event.httpMethod === 'GET') {
            const activeOnly = event.queryStringParameters?.scope === 'active';
            const allOrders = await readAllOrders(store, orderIndexStore);
            const normalizedOrders = await Promise.all(allOrders.map(order => removeInlineDesignFiles(normalizeStoredOrder(order), designStore)));
            const allResponseOrders = normalizedOrders.map(result => result.order);
            if (claims.role === 'admin') {
                // Save only orders whose attachments were just moved out of the
                // record. Rewriting every order on each page load could overwrite
                // a payment or proof saved at the same moment by someone else.
                const savedIds = (await orderIndexStore.get('all-order-ids', { type: 'json' })) || [];
                const savedIdSet = new Set(savedIds.map(String));
                await Promise.all(normalizedOrders
                    .filter(result => result.changed || !savedIdSet.has(String(result.order.id)))
                    .map(result => orderIndexStore.setJSON(orderRecordKey(result.order.id), result.order)));
                const allIds = allResponseOrders.map(order => order.id);
                if (allIds.length !== savedIds.length || allIds.some(id => !savedIdSet.has(String(id)))) {
                    await orderIndexStore.setJSON('all-order-ids', allIds);
                    await orderIndexStore.setJSON('active-order-ids', allResponseOrders.filter(isActiveOrder).map(order => order.id));
                }
            }
            let responseOrders = claims.role === 'admin'
                ? allResponseOrders
                : allResponseOrders.filter(order => String(order.customerEmail || '').toLowerCase() === String(claims.sub).toLowerCase());
            if (activeOnly) responseOrders = responseOrders.filter(isActiveOrder);
            return jsonResponse(200, { orders: responseOrders.map(order => decorateOrderMedia(order, claims)) });
        }
        if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

        const payload = JSON.parse(event.body || '{}');
        const action = String(payload.action || '');
        let emailEventId = '';
        if (action === 'create') {
            if (claims.role !== 'customer') return jsonResponse(403, { error: 'Customer access required.' });
            const order = payload.order;
            if (!order?.id || !order.customerEmail) {
                return jsonResponse(400, { error: 'A valid order for the signed-in customer is required.' });
            }
            if (String(order.customerEmail).trim().toLowerCase() !== String(claims.sub).trim().toLowerCase()) {
                return jsonResponse(400, { error: 'The checkout email must match the email you used to sign in.' });
            }
            const teamOrder = normalizeTeamOrderInput(order.teamOrder);
            if (teamOrder.isTeamOrder) {
                if (!isValidTeamPlayerCount(teamOrder.totalPlayers)) {
                    return jsonResponse(400, { error: `Team orders require at least ${MIN_TEAM_PLAYERS} players.` });
                }
                if (teamOrder.teamSizes.length
                    ? !areTeamPlayerDetailsComplete(teamOrder.teamSizes, teamOrder.totalPlayers)
                    : !teamOrder.teamNotes) {
                    return jsonResponse(400, { error: 'Surname, jersey number, upper size, and lower size for every player are required.' });
                }
                order.teamOrder = teamOrder;
                order.totalAmount = (order.items || []).reduce((sum, item) => {
                    const unitPrice = Number(item.price);
                    const quantity = Number(item.quantity) || 1;
                    return sum + (Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice * quantity * teamOrder.totalPlayers : 0);
                }, 0);
            }
            if (await orderIndexStore.get(orderRecordKey(order.id), { type: 'json' })) return jsonResponse(409, { error: 'This order already exists.' });
            order.customerEmail = claims.sub;
            order.customerUsername = claims.sub;
            order.status = 'pending';
            const isGcash = String(order.paymentMethod).toLowerCase() === 'gcash';
            const checkoutProof = String(order.gcashPaymentProof || '');
            if (isGcash && checkoutProof && (checkoutProof.length > 1500000 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(checkoutProof))) {
                return jsonResponse(400, { error: 'A valid, compressed payment proof is required.' });
            }
            order.paymentStatus = isGcash ? (checkoutProof ? 'downpayment-received' : 'awaiting-proof') : 'pending';
            // Payments are recorded by the admin only; the browser cannot set them.
            order.totalAmount = round2(order.totalAmount);
            order.downpaymentAmount = round2(order.totalAmount / 2);
            order.gcashDownpaymentAmount = isGcash ? order.downpaymentAmount : 0;
            order.payments = [];
            delete order.paymentProofs;
            delete order.paymentProofVersion;
            delete order.gcashPaymentProofUrl;
            ['balanceProofs', 'balanceProofVersion', 'balanceProofStatus', 'balanceProofUrl', 'balanceProofRejectionReason'].forEach(field => delete order[field]);
            order.productionStatus = 'order-placed';
            order.productionHistory = [];
            // Tells the admin a new order arrived (the admin screen turns this into its Orders badge and a pop-up).
            const pieces = (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 1), 0);
            const paymentNote = isGcash ? (checkoutProof ? 'GCash proof attached' : 'GCash, no proof yet') : 'pay at the shop';
            order.productionNotifications = [{
                id: require('crypto').randomUUID(),
                type: 'new-order',
                message: `New order from ${String(order.customerName || claims.sub).slice(0, 80)}: ${pieces} pc${pieces === 1 ? '' : 's'}, ${formatPeso(order.totalAmount)}, ${paymentNote}.`,
                timestamp: new Date().toISOString(),
                read: false
            }];
            order.designApproval = { status: 'not-requested' };
            order.estimatedCompletionDate = '';
            order.productionRemarks = '';
            addProductionHistory(order, 'stage-change', 'order-placed', 'customer', 'Order placed.');
            const savedOrder = await persistOrder(orderIndexStore, designStore, order);
            return jsonResponse(201, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
        }

        if (action === 'customer-update' || action === 'customer-approval') {
            if (claims.role !== 'customer') return jsonResponse(403, { error: 'Customer access required.' });
            const orderId = payload.order?.id || payload.orderId;
            if (!orderId) return jsonResponse(400, { error: 'Order number is required.' });
            const order = normalizeStoredOrder(await orderIndexStore.get(orderRecordKey(orderId), { type: 'json' })
                || (await readAllOrders(store, orderIndexStore)).find(item => String(item.id) === String(orderId)) || {});
            if (!order.id) return jsonResponse(404, { error: 'Order not found.' });
            if (String(order.customerEmail || '').toLowerCase() !== String(claims.sub).toLowerCase()) return jsonResponse(403, { error: 'You can only update your own orders.' });

            if (action === 'customer-approval') {
                const decision = String(payload.decision || '');
                if (order.productionStatus !== 'design-approval' || !order.finalDesignUrl) return jsonResponse(409, { error: 'There is no design waiting for approval.' });
                if (!['approved', 'revision-requested'].includes(decision)) return jsonResponse(400, { error: 'Choose approve or request revision.' });
                if (order.designApproval?.status === decision) return jsonResponse(409, { error: 'That design response was already recorded.' });
                order.designApproval = {
                    status: decision,
                    updatedAt: new Date().toISOString(),
                    remarks: String(payload.remarks || '').trim().slice(0, 1000)
                };
                addProductionHistory(order, decision, order.productionStatus, 'customer', order.designApproval.remarks);
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'design-response', message: decision === 'approved' ? 'Customer approved the final design.' : 'Customer requested a design revision.', timestamp: new Date().toISOString(), read: false });
                const savedOrder = await persistOrder(orderIndexStore, designStore, order);
                return jsonResponse(200, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
            }

            const incoming = payload.order || {};
            let changed = false;
            const proof = String(incoming.gcashPaymentProof || '');
            if (proof) {
                if (proof.length > 1500000 || !PROOF_DATA_URL.test(proof)) {
                    return jsonResponse(400, { error: 'A valid, compressed payment proof is required.' });
                }
                if (order.paymentStatus === 'verified') return jsonResponse(409, { error: 'Your payment was already verified. A new proof is not needed.' });
                if (order.status === 'cancelled' || order.productionStatus === 'cancelled') return jsonResponse(409, { error: 'This order was cancelled.' });
                order.gcashPaymentProof = proof;
                const wasRejected = order.paymentStatus === 'rejected';
                order.paymentStatus = 'downpayment-received';
                delete order.paymentRejectionReason;
                addProductionHistory(order, 'payment-proof-uploaded', order.productionStatus, 'customer', wasRejected ? 'New proof uploaded after the previous one was rejected.' : '');
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'payment-proof', message: wasRejected ? 'Customer uploaded a new GCash payment proof after the previous one was rejected.' : 'Customer uploaded GCash payment proof.', timestamp: new Date().toISOString(), read: false });
                changed = true;
            }
            // GCash proof for the remaining balance, after the downpayment was verified.
            const balanceProof = String(incoming.balancePaymentProof || '');
            if (balanceProof) {
                if (balanceProof.length > 1500000 || !PROOF_DATA_URL.test(balanceProof)) {
                    return jsonResponse(400, { error: 'A valid, compressed payment proof is required.' });
                }
                if (order.status === 'cancelled' || order.productionStatus === 'cancelled') return jsonResponse(409, { error: 'This order was cancelled.' });
                if (String(order.paymentMethod).toLowerCase() !== 'gcash') return jsonResponse(409, { error: 'Pay the balance of this order at the shop.' });
                if (order.paymentStatus !== 'verified') return jsonResponse(409, { error: 'Your downpayment must be verified before you send a proof for the balance.' });
                ensurePaymentLedger(order);
                const balanceDue = getPaymentSummary(order).balance;
                if (balanceDue <= 0) return jsonResponse(409, { error: 'This order is already fully paid.' });
                const wasRejected = order.balanceProofStatus === 'rejected';
                await storeBalanceProof(order, balanceProof, designStore, balanceDue);
                delete order.balanceProofRejectionReason;
                addProductionHistory(order, 'balance-proof-uploaded', order.productionStatus, 'customer', `GCash proof for the remaining balance of ${formatPeso(balanceDue)}.`);
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({
                    id: require('crypto').randomUUID(),
                    type: 'payment-proof',
                    message: wasRejected
                        ? `Customer uploaded a new GCash proof for the remaining balance of ${formatPeso(balanceDue)} after the previous one was rejected.`
                        : `Customer uploaded GCash proof for the remaining balance of ${formatPeso(balanceDue)}.`,
                    timestamp: new Date().toISOString(),
                    read: false
                });
                changed = true;
            }
            if (incoming.requestType === 'refund' && incoming.requestStatus === 'pending') {
                order.requestType = 'refund';
                order.requestReason = String(incoming.requestReason || '').trim().slice(0, 500);
                order.requestDate = new Date().toISOString();
                order.requestStatus = 'pending';
                addProductionHistory(order, 'refund-requested', order.productionStatus, 'customer', order.requestReason);
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'refund-requested', message: `Customer requested a refund: ${order.requestReason}`, timestamp: new Date().toISOString(), read: false });
                changed = true;
            }
            if (incoming.status === 'cancelled') {
                if (['completed', 'delivered', 'cancelled'].includes(order.status)) return jsonResponse(409, { error: 'This order can no longer be cancelled.' });
                order.status = 'cancelled';
                order.productionStatus = 'cancelled';
                order.requestType = 'cancel';
                order.requestReason = String(incoming.requestReason || '').trim().slice(0, 500);
                order.requestDate = new Date().toISOString();
                order.requestStatus = 'approved';
                addProductionHistory(order, 'stage-change', 'cancelled', 'customer', order.requestReason);
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'customer-cancel', message: `Customer cancelled this order: ${order.requestReason}`, timestamp: new Date().toISOString(), read: false });
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'customer-confirmation', message: 'Your order was cancelled successfully.', timestamp: new Date().toISOString(), read: false });
                emailEventId = require('crypto').randomUUID();
                order.productionNotifications.push({
                    id: emailEventId,
                    type: 'stage-update',
                    status: 'cancelled',
                    statusLabel: 'Cancelled',
                    remarks: order.requestReason,
                    message: 'The customer cancelled this order.',
                    timestamp: new Date().toISOString(),
                    read: false
                });
                changed = true;
            }
            if (!changed) return jsonResponse(400, { error: 'No supported customer update was provided.' });
            const savedOrder = await persistOrder(orderIndexStore, designStore, order);
            if (emailEventId) await enqueueProductionEmail(event, savedOrder.id, emailEventId);
            return jsonResponse(200, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
        }

        if (action !== 'admin-update' && action !== 'admin-migrate' && action !== 'recompute-prices') return jsonResponse(400, { error: 'Unknown order action.' });
        if (claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

        if (action === 'recompute-prices') {
            const catalog = (await getStore('kingpin-products').get('catalog', { type: 'json' })) || [];
            const orders = await readAllOrders(store, orderIndexStore);
            const result = recomputeOrderPrices(orders, catalog);
            if (payload.apply === true) {
                const appliedAt = new Date().toISOString();
                for (const change of result.changes) {
                    const order = orders.find(item => String(item.id) === String(change.orderId));
                    const updated = applyPriceChange(order, change, appliedAt);
                    await persistOrder(orderIndexStore, designStore, updated);
                }
            }
            return jsonResponse(200, { ok: true, applied: payload.apply === true, ...result });
        }

        if (action === 'admin-migrate') {
            const legacyOrder = payload.order;
            if (!legacyOrder?.id || !legacyOrder.customerEmail) return jsonResponse(400, { error: 'A valid legacy order is required.' });
            if (await orderIndexStore.get(orderRecordKey(legacyOrder.id), { type: 'json' })) return jsonResponse(409, { error: 'This order already exists.' });
            const migratedOrder = normalizeStoredOrder(legacyOrder);
            const savedOrder = await persistOrder(orderIndexStore, designStore, migratedOrder);
            return jsonResponse(201, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
        }

        const orderId = payload.orderId || payload.order?.id;
        if (!orderId) return jsonResponse(400, { error: 'Order number is required.' });
        const storedOrder = await orderIndexStore.get(orderRecordKey(orderId), { type: 'json' })
            || (await readAllOrders(store, orderIndexStore)).find(item => String(item.id) === String(orderId));
        if (!storedOrder) return jsonResponse(404, { error: 'Order not found.' });
        const order = normalizeStoredOrder(storedOrder);
        const operation = String(payload.operation || '');
        let notifyRemarks = '';

        if (operation === 'verify-payment') {
            if (!['order-placed', 'payment-verification'].includes(order.productionStatus)) return jsonResponse(409, { error: 'Payment can only be verified before design approval.' });
            if (String(order.paymentMethod).toLowerCase() === 'gcash' && order.paymentStatus !== 'downpayment-received') {
                return jsonResponse(409, { error: 'Review the uploaded GCash downpayment proof first.' });
            }
            if (order.paymentStatus === 'verified') return jsonResponse(409, { error: 'Payment was already verified.' });
            ensurePaymentLedger(order);
            const before = getPaymentSummary(order);
            // The amount the admin actually received. Without one, the
            // downpayment still owed is recorded (the usual 50%).
            const requestedAmount = parsePaymentAmount(payload.amount);
            const amount = requestedAmount === null ? (before.downpaymentDue > 0 ? before.downpaymentDue : before.balance) : requestedAmount;
            if (Number.isNaN(amount) || (requestedAmount !== null && amount <= 0)) return jsonResponse(400, { error: 'Enter the amount received, greater than zero.' });
            if (amount > before.balance + 0.001) return jsonResponse(400, { error: `The amount received cannot be more than the unpaid balance of ${formatPeso(before.balance)}.` });
            const receivedAt = validPaymentDate(payload.receivedAt);
            if (receivedAt === null) return jsonResponse(400, { error: 'Enter a valid payment date.' });
            const isGcashPayment = String(order.paymentMethod).toLowerCase() === 'gcash';
            if (amount > 0) {
                order.payments.push({
                    id: require('crypto').randomUUID(),
                    type: amount >= before.balance ? 'full' : 'downpayment',
                    method: isGcashPayment ? 'gcash' : 'cash',
                    amount,
                    reference: String(payload.reference || '').trim().slice(0, 80),
                    proofVersion: isGcashPayment ? Number(order.paymentProofVersion) || null : null,
                    receivedAt: receivedAt || new Date().toISOString(),
                    recordedAt: new Date().toISOString(),
                    recordedBy: claims.sub,
                    note: String(payload.remarks || '').trim().slice(0, 500)
                });
            }
            if (isGcashPayment) markLatestProof(order, 'verified');
            order.paymentStatus = 'verified';
            if (order.productionStatus === 'order-placed') {
                order.productionStatus = 'payment-verification';
                order.status = mapProductionStatusToLegacy(order.productionStatus);
                addProductionHistory(order, 'stage-change', order.productionStatus, 'admin', String(payload.remarks || ''));
            }
            const after = getPaymentSummary(order);
            addProductionHistory(order, 'payment-verified', order.productionStatus, 'admin', `${String(payload.remarks || 'Payment verified.')} Amount received: ${formatPeso(amount)}. Remaining balance: ${formatPeso(after.balance)}.`);
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            notifyRemarks = String(payload.remarks || 'Payment verified.');
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: order.productionStatus,
                statusLabel: stageLabel(order.productionStatus),
                remarks: notifyRemarks,
                message: 'The admin verified your payment.',
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'reject-payment') {
            if (!['order-placed', 'payment-verification'].includes(order.productionStatus)) {
                return jsonResponse(409, { error: 'Payment proof can only be rejected before design approval.' });
            }
            if (String(order.paymentMethod).toLowerCase() !== 'gcash'
                || order.paymentStatus !== 'downpayment-received'
                || (!order.gcashPaymentProof && !order.gcashPaymentProofUrl)) {
                return jsonResponse(409, { error: 'A submitted GCash payment proof is required before it can be rejected.' });
            }
            const reason = String(payload.reason || '').trim();
            if (!reason) return jsonResponse(400, { error: 'A reason is required to reject the payment proof.' });
            if (reason.length > 1000) return jsonResponse(400, { error: 'The rejection reason must be 1000 characters or fewer.' });

            order.paymentStatus = 'rejected';
            order.paymentRejectionReason = reason;
            markLatestProof(order, 'rejected', reason);
            addProductionHistory(order, 'payment-rejected', order.productionStatus, 'admin', reason);
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: order.productionStatus,
                statusLabel: stageLabel(order.productionStatus),
                remarks: `Payment proof rejected: ${reason}`,
                message: `Your GCash payment proof was rejected. Reason: ${reason} Please upload a new proof.`,
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'record-payment') {
            // The rest of the payment, usually paid in cash at pickup or on delivery.
            if (order.status === 'cancelled' || order.productionStatus === 'cancelled') return jsonResponse(409, { error: 'Payments cannot be recorded on a cancelled order.' });
            if (order.paymentStatus !== 'verified') return jsonResponse(409, { error: 'Verify the downpayment first.' });
            ensurePaymentLedger(order);
            const before = getPaymentSummary(order);
            if (before.balance <= 0) return jsonResponse(409, { error: 'This order is already fully paid.' });
            const requestedAmount = parsePaymentAmount(payload.amount);
            const amount = requestedAmount === null ? before.balance : requestedAmount;
            if (Number.isNaN(amount) || amount <= 0) return jsonResponse(400, { error: 'Enter the amount received, greater than zero.' });
            if (amount > before.balance + 0.001) return jsonResponse(400, { error: `The amount received cannot be more than the unpaid balance of ${formatPeso(before.balance)}.` });
            const method = String(payload.method || 'cash').toLowerCase();
            if (!PAYMENT_METHODS.includes(method)) return jsonResponse(400, { error: 'Choose Cash, GCash or Bank transfer.' });
            const reference = String(payload.reference || '').trim().slice(0, 80);
            if (method !== 'cash' && !reference) return jsonResponse(400, { error: 'Enter the reference number of the GCash or bank payment.' });
            const receivedAt = validPaymentDate(payload.receivedAt);
            if (receivedAt === null) return jsonResponse(400, { error: 'Enter a valid payment date.' });
            const note = String(payload.note || '').trim().slice(0, 500);
            order.payments.push({
                id: require('crypto').randomUUID(),
                type: 'balance',
                method,
                amount,
                reference,
                receivedAt: receivedAt || new Date().toISOString(),
                recordedAt: new Date().toISOString(),
                recordedBy: claims.sub,
                note
            });
            const after = getPaymentSummary(order);
            // Paid in full some other way: a balance proof still waiting is no longer needed.
            if (after.balance <= 0 && order.balanceProofStatus === 'pending') markLatestBalanceProof(order, 'not-needed');
            const methodLabel = { cash: 'cash', gcash: 'GCash', 'bank-transfer': 'bank transfer' }[method];
            const summaryText = after.balance > 0
                ? `Payment of ${formatPeso(amount)} received by ${methodLabel}. Remaining balance: ${formatPeso(after.balance)}.`
                : `Payment of ${formatPeso(amount)} received by ${methodLabel}. Your order is now fully paid.`;
            addProductionHistory(order, 'payment-recorded', order.productionStatus, 'admin', `${summaryText}${note ? ` ${note}` : ''}`);
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: order.productionStatus,
                statusLabel: stageLabel(order.productionStatus),
                remarks: summaryText,
                message: summaryText,
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'verify-balance-proof') {
            // The customer's GCash proof for the rest of the payment: records it as a balance payment.
            if (order.status === 'cancelled' || order.productionStatus === 'cancelled') return jsonResponse(409, { error: 'Payments cannot be recorded on a cancelled order.' });
            if (order.balanceProofStatus !== 'pending') return jsonResponse(409, { error: 'There is no balance proof waiting for review.' });
            ensurePaymentLedger(order);
            const before = getPaymentSummary(order);
            if (before.balance <= 0) return jsonResponse(409, { error: 'This order is already fully paid.' });
            const requestedAmount = parsePaymentAmount(payload.amount);
            const amount = requestedAmount === null ? before.balance : requestedAmount;
            if (Number.isNaN(amount) || amount <= 0) return jsonResponse(400, { error: 'Enter the amount received, greater than zero.' });
            if (amount > before.balance + 0.001) return jsonResponse(400, { error: `The amount received cannot be more than the unpaid balance of ${formatPeso(before.balance)}.` });
            const receivedAt = validPaymentDate(payload.receivedAt);
            if (receivedAt === null) return jsonResponse(400, { error: 'Enter a valid payment date.' });
            const note = String(payload.remarks || '').trim().slice(0, 500);
            order.payments.push({
                id: require('crypto').randomUUID(),
                type: 'balance',
                method: 'gcash',
                amount,
                reference: String(payload.reference || '').trim().slice(0, 80),
                proofKind: 'balance',
                proofVersion: Number(order.balanceProofVersion) || null,
                receivedAt: receivedAt || new Date().toISOString(),
                recordedAt: new Date().toISOString(),
                recordedBy: claims.sub,
                note
            });
            markLatestBalanceProof(order, 'verified');
            delete order.balanceProofRejectionReason;
            const after = getPaymentSummary(order);
            const summaryText = after.balance > 0
                ? `Your GCash payment of ${formatPeso(amount)} for the balance was verified. Remaining balance: ${formatPeso(after.balance)}.`
                : `Your GCash payment of ${formatPeso(amount)} for the balance was verified. Your order is now fully paid.`;
            addProductionHistory(order, 'payment-recorded', order.productionStatus, 'admin', `${summaryText}${note ? ` ${note}` : ''}`);
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: order.productionStatus,
                statusLabel: stageLabel(order.productionStatus),
                remarks: summaryText,
                message: summaryText,
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'reject-balance-proof') {
            if (order.balanceProofStatus !== 'pending') return jsonResponse(409, { error: 'There is no balance proof waiting for review.' });
            const reason = String(payload.reason || '').trim();
            if (!reason) return jsonResponse(400, { error: 'A reason is required to reject the payment proof.' });
            if (reason.length > 1000) return jsonResponse(400, { error: 'The rejection reason must be 1000 characters or fewer.' });
            markLatestBalanceProof(order, 'rejected', reason);
            order.balanceProofRejectionReason = reason;
            addProductionHistory(order, 'balance-proof-rejected', order.productionStatus, 'admin', reason);
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: order.productionStatus,
                statusLabel: stageLabel(order.productionStatus),
                remarks: `Balance payment proof rejected: ${reason}`,
                message: `Your GCash proof for the balance was rejected. Reason: ${reason} Please upload a new proof.`,
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'production-stage') {
            const nextStatus = String(payload.productionStatus || '');
            const validation = validateProductionTransition(order, nextStatus);
            if (!validation.ok) return jsonResponse(409, { error: validation.reason });
            const currentStatus = order.productionStatus;
            if (nextStatus === 'on-hold') order.previousProductionStatus = currentStatus;
            if (currentStatus === 'on-hold') delete order.previousProductionStatus;
            order.productionStatus = nextStatus;
            order.status = mapProductionStatusToLegacy(nextStatus);
            notifyRemarks = String(payload.remarks || '').trim().slice(0, 1000);
            if (notifyRemarks) order.productionRemarks = notifyRemarks;
            if (!validEstimate(payload.estimatedCompletionDate)) return jsonResponse(400, { error: 'Enter a valid estimated completion date.' });
            if (payload.estimatedCompletionDate !== undefined) order.estimatedCompletionDate = String(payload.estimatedCompletionDate || '');
            addProductionHistory(order, 'stage-change', nextStatus, 'admin', notifyRemarks);
            if (nextStatus === 'completed') order.completedAt = new Date().toISOString();
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            emailEventId = require('crypto').randomUUID();
            order.productionNotifications.push({
                id: emailEventId,
                type: 'stage-update',
                status: nextStatus,
                statusLabel: stageLabel(nextStatus),
                remarks: notifyRemarks,
                message: `Production stage updated to ${stageLabel(nextStatus)}.${notifyRemarks ? ` Remarks: ${notifyRemarks}` : ''}`,
                timestamp: new Date().toISOString(),
                read: false
            });
        } else if (operation === 'production-details') {
            if (!validEstimate(payload.estimatedCompletionDate)) return jsonResponse(400, { error: 'Enter a valid estimated completion date.' });
            const nextEstimate = String(payload.estimatedCompletionDate || '');
            const nextRemarks = String(payload.remarks || '').trim().slice(0, 1000);
            if (nextEstimate === String(order.estimatedCompletionDate || '') && nextRemarks === String(order.productionRemarks || '')) {
                return jsonResponse(409, { error: 'There are no production detail changes to save.' });
            }
            order.estimatedCompletionDate = nextEstimate;
            order.productionRemarks = nextRemarks;
            addProductionHistory(order, 'admin-remark', order.productionStatus, 'admin', order.productionRemarks);
        } else if (operation === 'design-upload') {
            const design = String(payload.design || '');
            const match = design.match(/^data:(image\/(?:png|jpeg|gif|webp)|application\/pdf);base64,([a-z0-9+/=]+)$/i);
            if (!match || design.length > 6 * 1024 * 1024) return jsonResponse(400, { error: 'Upload a valid design image or PDF under 4 MB.' });
            if (['printing', 'quality-checking', 'ready-for-release', 'completed'].includes(order.productionStatus) && order.designApproval?.status !== 'revision-requested') {
                return jsonResponse(409, { error: 'A design can only be uploaded before production or after a revision request.' });
            }
            await designStore.set(`order-final-design-${order.id}`, design);
            order.finalDesignUrl = `/.netlify/functions/order-design?orderId=${encodeURIComponent(order.id)}&media=final-design`;
            order.finalDesignType = match[1].toLowerCase();
            order.finalDesignName = String(payload.fileName || 'final-design').slice(0, 160);
            order.designApproval = { status: 'pending', updatedAt: new Date().toISOString(), remarks: String(payload.remarks || '').trim().slice(0, 1000) };
            addProductionHistory(order, 'design-uploaded', order.productionStatus, 'admin', order.designApproval.remarks || 'Final design uploaded for customer review.');
        } else {
            return jsonResponse(400, { error: 'Unknown admin order operation.' });
        }

        const savedOrder = await persistOrder(orderIndexStore, designStore, order);
        if (emailEventId) await enqueueProductionEmail(event, savedOrder.id, emailEventId);
        return jsonResponse(200, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};
