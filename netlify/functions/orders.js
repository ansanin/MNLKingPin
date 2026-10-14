const { connectLambda, getStore } = require('@netlify/blobs');
const nodemailer = require('nodemailer');
const { authenticateEvent, signAccessToken } = require('./lib/auth');
const { PRODUCTION_STAGES, normalizeProductionStatus, validateProductionTransition } = require('../../js/production-tracking');

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

function orderMediaKey(orderId, mediaType) {
    return `order-media-${orderId}-${mediaType}`;
}

async function removeInlineOrderMedia(order, designStore) {
    const normalized = JSON.parse(JSON.stringify(order));
    let changed = false;

    for (const [field, mediaType] of [['gcashQRCode', 'gcash-qr'], ['gcashPaymentProof', 'gcash-proof']]) {
        const dataUrl = String(normalized[field] || '');
        const match = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=]+)$/i);
        if (!match) continue;

        const orderId = String(normalized.id);
        const key = orderMediaKey(orderId, mediaType);
        const savedMedia = await designStore.get(key, { type: 'text' });
        if (!savedMedia) await designStore.set(key, dataUrl);
        normalized[`${field}Url`] = `/.netlify/functions/order-design?orderId=${encodeURIComponent(orderId)}&media=${mediaType}`;
        delete normalized[field];
        changed = true;
    }

    return { order: normalized, changed };
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

async function persistOrder(indexStore, designStore, order) {
    const normalized = (await removeInlineDesignFiles(order, designStore)).order;
    await writeOrderRecord(indexStore, normalized);
    return normalized;
}

async function sendProductionEmail(order, status, remarks) {
    const email = String(order.customerEmail || '').trim();
    if (!email) return;
    const label = stageLabel(status);
    const safeRemarks = String(remarks || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const subject = `KingPin Order #${order.id}: ${label}`;
    const html = `<h2>Production update</h2><p>Order <strong>#${order.id}</strong> is now at <strong>${label}</strong>.</p>${safeRemarks ? `<p>${safeRemarks}</p>` : ''}${order.estimatedCompletionDate ? `<p>Estimated completion: ${order.estimatedCompletionDate}</p>` : ''}`;

    try {
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
            await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject, html });
            return;
        }
        if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject, html })
            });
            if (!response.ok) console.error('Production email provider rejected the message:', await response.text());
        }
    } catch (error) {
        console.error('Production email failed after the order was saved:', error);
    }
}

function validEstimate(value) {
    return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addMediaTicket(url, claims, orderId, media, itemIndex = '') {
    if (!url || !String(url).startsWith('/.netlify/functions/order-design?')) return url;
    const ticket = signAccessToken({ sub: claims.sub, role: claims.role, mediaOrderId: String(orderId), media, itemIndex: String(itemIndex) });
    return `${url}&access=${encodeURIComponent(ticket)}`;
}

function decorateOrderMedia(order, claims) {
    const decorated = JSON.parse(JSON.stringify(order));
    decorated.gcashQRCodeUrl = addMediaTicket(decorated.gcashQRCodeUrl, claims, decorated.id, 'gcash-qr');
    decorated.gcashPaymentProofUrl = addMediaTicket(decorated.gcashPaymentProofUrl, claims, decorated.id, 'gcash-proof');
    decorated.finalDesignUrl = addMediaTicket(decorated.finalDesignUrl, claims, decorated.id, 'final-design');
    (decorated.items || []).forEach((item, itemIndex) => {
        if (item.details?.uploadedFileUrl) {
            item.details.uploadedFileUrl = addMediaTicket(item.details.uploadedFileUrl, claims, decorated.id, 'item-design', itemIndex);
        }
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
                await Promise.all(allResponseOrders.map(order => orderIndexStore.setJSON(orderRecordKey(order.id), order)));
                await orderIndexStore.setJSON('all-order-ids', allResponseOrders.map(order => order.id));
                await orderIndexStore.setJSON('active-order-ids', allResponseOrders.filter(isActiveOrder).map(order => order.id));
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
        if (action === 'create') {
            if (claims.role !== 'customer') return jsonResponse(403, { error: 'Customer access required.' });
            const order = payload.order;
            if (!order?.id || !order.customerEmail || String(order.customerEmail).toLowerCase() !== String(claims.sub).toLowerCase()) {
                return jsonResponse(400, { error: 'A valid order for the signed-in customer is required.' });
            }
            if (await orderIndexStore.get(orderRecordKey(order.id), { type: 'json' })) return jsonResponse(409, { error: 'This order already exists.' });
            order.customerEmail = claims.sub;
            order.customerUsername = claims.sub;
            order.status = 'pending';
            order.paymentStatus = String(order.paymentMethod).toLowerCase() === 'gcash' ? 'awaiting-proof' : 'pending';
            order.productionStatus = 'order-placed';
            order.productionHistory = [];
            order.productionNotifications = [];
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
                if (proof.length > 1500000 || !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(proof)) {
                    return jsonResponse(400, { error: 'A valid, compressed payment proof is required.' });
                }
                order.gcashPaymentProof = proof;
                order.paymentStatus = 'downpayment-received';
                addProductionHistory(order, 'payment-proof-uploaded', order.productionStatus, 'customer');
                order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
                order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'payment-proof', message: 'Customer uploaded GCash payment proof.', timestamp: new Date().toISOString(), read: false });
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
                changed = true;
            }
            if (!changed) return jsonResponse(400, { error: 'No supported customer update was provided.' });
            const savedOrder = await persistOrder(orderIndexStore, designStore, order);
            if (incoming.status === 'cancelled') await sendProductionEmail(savedOrder, 'cancelled', order.requestReason);
            return jsonResponse(200, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
        }

        if (action !== 'admin-update' && action !== 'admin-migrate') return jsonResponse(400, { error: 'Unknown order action.' });
        if (claims.role !== 'admin') return jsonResponse(403, { error: 'Admin access required.' });

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
        let notifyStatus = '';
        let notifyRemarks = '';

        if (operation === 'verify-payment') {
            if (!['order-placed', 'payment-verification'].includes(order.productionStatus)) return jsonResponse(409, { error: 'Payment can only be verified before design approval.' });
            if (String(order.paymentMethod).toLowerCase() === 'gcash' && order.paymentStatus !== 'downpayment-received') {
                return jsonResponse(409, { error: 'Review the uploaded GCash downpayment proof first.' });
            }
            if (order.paymentStatus === 'verified') return jsonResponse(409, { error: 'Payment was already verified.' });
            order.paymentStatus = 'verified';
            if (order.productionStatus === 'order-placed') {
                order.productionStatus = 'payment-verification';
                order.status = mapProductionStatusToLegacy(order.productionStatus);
                addProductionHistory(order, 'stage-change', order.productionStatus, 'admin', String(payload.remarks || ''));
            }
            addProductionHistory(order, 'payment-verified', order.productionStatus, 'admin', String(payload.remarks || 'Payment verified.'));
            order.productionNotifications = Array.isArray(order.productionNotifications) ? order.productionNotifications : [];
            order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'stage-update', message: 'The admin verified your payment.', timestamp: new Date().toISOString(), read: false });
            notifyStatus = order.productionStatus;
            notifyRemarks = String(payload.remarks || 'Payment verified.');
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
            order.productionNotifications.push({ id: require('crypto').randomUUID(), type: 'stage-update', message: `Production stage updated to ${stageLabel(nextStatus)}.${notifyRemarks ? ` Remarks: ${notifyRemarks}` : ''}`, timestamp: new Date().toISOString(), read: false });
            notifyStatus = nextStatus;
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
        if (notifyStatus) await sendProductionEmail(savedOrder, notifyStatus, notifyRemarks);
        return jsonResponse(200, { ok: true, order: decorateOrderMedia(savedOrder, claims) });
    } catch (error) {
        console.error('Netlify orders function error:', error);
        return jsonResponse(500, { error: 'Unable to access shared orders' });
    }
};