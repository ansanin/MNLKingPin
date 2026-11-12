// Payment standing of an order and of a customer. Shared by the browser and the
// Netlify functions so the admin screens, the customer list and the PDF
// reports always show the same paid amount and balance.
(function (global) {
    const DOWNPAYMENT_RATE = 0.5;

    const STANDINGS = {
        'downpayment-unpaid': 'Downpayment unpaid',
        'awaiting-verification': 'Downpayment proof under review',
        'partial-downpayment': 'Downpayment partly paid',
        'with-balance': 'Downpayment paid - balance due',
        'fully-paid': 'Fully paid',
        cancelled: 'Cancelled',
        'no-orders': 'No orders yet'
    };

    function round2(value) {
        return Math.round((Number(value) || 0) * 100) / 100;
    }

    function isCancelledOrder(order) {
        return String(order?.status || '').toLowerCase() === 'cancelled'
            || String(order?.productionStatus || '').toLowerCase() === 'cancelled';
    }

    function isFinishedOrder(order) {
        return String(order?.productionStatus || '').toLowerCase() === 'completed'
            || ['completed', 'delivered'].includes(String(order?.status || '').toLowerCase());
    }

    function getDownpaymentAmount(order) {
        const total = round2(order?.totalAmount);
        const saved = Number(order?.downpaymentAmount);
        if (Number.isFinite(saved) && saved > 0) return round2(Math.min(saved, total || saved));
        const gcash = Number(order?.gcashDownpaymentAmount);
        if (Number.isFinite(gcash) && gcash > 0) return round2(Math.min(gcash, total || gcash));
        return round2(total * DOWNPAYMENT_RATE);
    }

    // Orders saved before payments were recorded have no `payments` list. For
    // those, a verified payment counts as the downpayment, and a completed order
    // counts as fully paid (marked `assumed` so screens can say so).
    function getAmountPaid(order) {
        if (Array.isArray(order?.payments)) {
            return { amountPaid: round2(order.payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0)), assumed: false };
        }
        if (isFinishedOrder(order)) return { amountPaid: round2(order?.totalAmount), assumed: true };
        if (String(order?.paymentStatus || '').toLowerCase() === 'verified') return { amountPaid: getDownpaymentAmount(order), assumed: true };
        return { amountPaid: 0, assumed: false };
    }

    function getPaymentSummary(order) {
        const total = round2(order?.totalAmount);
        const downpayment = getDownpaymentAmount(order);
        const { amountPaid, assumed } = getAmountPaid(order);
        const balance = round2(Math.max(0, total - amountPaid));
        const downpaymentDue = round2(Math.max(0, downpayment - amountPaid));
        let standing;
        if (isCancelledOrder(order)) standing = 'cancelled';
        else if (balance <= 0) standing = 'fully-paid';
        else if (amountPaid > 0 && amountPaid >= downpayment) standing = 'with-balance';
        else if (String(order?.paymentStatus || '').toLowerCase() === 'downpayment-received') standing = 'awaiting-verification';
        else if (amountPaid > 0) standing = 'partial-downpayment';
        else standing = 'downpayment-unpaid';
        return { total, downpayment, amountPaid, balance, downpaymentDue, standing, label: STANDINGS[standing], assumed };
    }

    // One customer's orders added up. Cancelled orders are listed but do not
    // count toward the amounts.
    function summarizeCustomerPayments(orders) {
        const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
        const summaries = list.map(order => ({ order, summary: getPaymentSummary(order) }));
        const counted = summaries.filter(entry => entry.summary.standing !== 'cancelled');
        const totalAmount = round2(counted.reduce((sum, entry) => sum + entry.summary.total, 0));
        const amountPaid = round2(counted.reduce((sum, entry) => sum + Math.min(entry.summary.amountPaid, entry.summary.total), 0));
        const balance = round2(counted.reduce((sum, entry) => sum + entry.summary.balance, 0));
        let standing = 'no-orders';
        if (counted.some(entry => ['downpayment-unpaid', 'awaiting-verification', 'partial-downpayment'].includes(entry.summary.standing))) standing = 'downpayment-unpaid';
        else if (balance > 0) standing = 'with-balance';
        else if (counted.length) standing = 'fully-paid';
        return {
            totalAmount,
            amountPaid,
            balance,
            standing,
            label: STANDINGS[standing],
            orders: summaries.map(({ order, summary }) => ({
                id: order.id,
                date: order.date || '',
                status: order.productionStatus || order.status || 'pending',
                total: summary.total,
                downpayment: summary.downpayment,
                amountPaid: summary.amountPaid,
                balance: summary.balance,
                standing: summary.standing,
                label: summary.label,
                assumed: summary.assumed
            }))
        };
    }

    const api = { DOWNPAYMENT_RATE, STANDINGS, round2, isCancelledOrder, isFinishedOrder, getDownpaymentAmount, getPaymentSummary, summarizeCustomerPayments };
    global.KingPinPaymentSummary = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
