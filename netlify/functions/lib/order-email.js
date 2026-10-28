const { getStore } = require('@netlify/blobs');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function money(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? `PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
}

function imageUrl(value, siteUrl) {
    if (typeof value !== 'string' || !value) return '';
    try {
        const base = new URL(siteUrl || 'https://mnlkingpin.netlify.app');
        if (base.protocol !== 'https:') return '';
        const url = new URL(value, base);
        if (url.protocol !== 'https:' || url.username || url.password) return '';
        if (url.origin === base.origin) {
            if (/^\/\.netlify\/functions\/product-image$/.test(url.pathname) && /^[a-f0-9]{64}$/.test(url.searchParams.get('key') || '')) return url.href;
            if (/^\/uploads\/[a-z0-9_./%-]+$/i.test(url.pathname) && !url.search) return url.href;
            return '';
        }
        // Catalog images may be hosted on a public HTTPS image service.
        if (value.startsWith('https://') && !url.search && !url.hash) return url.href;
    } catch (error) { /* Ignore invalid URLs. */ }
    return '';
}

async function renderOrderUpdateEmail(order, productionEvent, siteUrl) {
    let catalog = [];
    try {
        const saved = await getStore('kingpin-products').get('catalog', { type: 'json' });
        if (Array.isArray(saved)) catalog = saved;
    } catch (error) { /* Product names and totals still appear if the catalog is unavailable. */ }

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsHtml = items.map(item => {
        const product = catalog.find(entry => entry && String(entry.id) === String(item.id));
        const candidates = [item.thumbnailUrl, item.image, item.productImage, ...(Array.isArray(item.images) ? item.images : []), product?.thumbnailImage, product?.image, ...(Array.isArray(product?.images) ? product.images : [])];
        const src = candidates.map(candidate => imageUrl(candidate, siteUrl)).find(Boolean);
        const name = escapeHtml(item.name || product?.name || 'Order item');
        const quantity = Number(item.quantity);
        const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
        return `<tr><td style="padding:12px;border-bottom:1px solid #ddd;vertical-align:top">${src ? `<img src="${escapeHtml(src)}" alt="${name}" width="120" style="display:block;max-width:120px;height:auto;border-radius:6px">` : '<span>Image unavailable</span>'}</td><td style="padding:12px;border-bottom:1px solid #ddd;vertical-align:top"><strong>${name}</strong><br>Quantity: ${qty}</td></tr>`;
    }).join('');
    const total = money(order.totalAmount);
    const downpayment = Number(order.gcashDownpaymentAmount);
    const verifiedDownpayment = String(order.paymentMethod || '').toLowerCase() === 'gcash' && order.paymentStatus === 'verified' && Number.isFinite(downpayment) && downpayment >= 0;
    const downpaymentHtml = verifiedDownpayment ? `<p><strong>Verified downpayment:</strong> ${money(downpayment)}</p>${Number.isFinite(Number(order.totalAmount)) && downpayment <= Number(order.totalAmount) ? `<p><strong>Estimated remaining balance:</strong> ${money(Number(order.totalAmount) - downpayment)}</p>` : ''}` : String(order.paymentMethod || '').toLowerCase() === 'gcash' && order.paymentStatus === 'downpayment-received' ? '<p>Your GCash proof is awaiting verification; the downpayment is not yet confirmed.</p>' : '';
    const label = escapeHtml(productionEvent.statusLabel || productionEvent.status || productionEvent.message || 'Updated');
    const remarks = productionEvent.remarks ? `<p>${escapeHtml(productionEvent.remarks)}</p>` : '';
    const date = order.estimatedCompletionDate ? escapeHtml(order.estimatedCompletionDate) : 'Not set by the shop yet';
    return `<div style="font-family:Arial,sans-serif;color:#202020;max-width:620px"><h2>KingPin Order Update</h2><p><strong>Order number:</strong> #${escapeHtml(order.id)}</p><p><strong>Current stage:</strong> ${label}</p>${remarks}<p><strong>Estimated ready / receive date:</strong> ${date}</p>${total ? `<p><strong>Order total:</strong> ${total}</p>` : '<p><strong>Order total:</strong> Not available</p>'}${downpaymentHtml}${itemsHtml ? `<h3>Items ordered</h3><table style="border-collapse:collapse;width:100%">${itemsHtml}</table>` : ''}<p>Please contact the shop to confirm the final balance and pickup or delivery date.</p><p>Thank you for choosing KingPin!</p></div>`;
}

module.exports = { escapeHtml, imageUrl, money, renderOrderUpdateEmail };
