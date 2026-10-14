(function (global) {
    const PRODUCTION_STAGES = [
        { id: 'order-placed', label: 'Order Placed' },
        { id: 'payment-verification', label: 'Payment Verification' },
        { id: 'design-approval', label: 'Design Approval' },
        { id: 'printing', label: 'Printing / Production' },
        { id: 'quality-checking', label: 'Quality Checking' },
        { id: 'ready-for-release', label: 'Ready for Pickup / Delivery' },
        { id: 'completed', label: 'Completed' }
    ];
    const EXCEPTION_STAGES = ['on-hold', 'cancelled'];

    function normalizeProductionStatus(order) {
        const status = String(order?.productionStatus || '').toLowerCase();
        if (PRODUCTION_STAGES.some(stage => stage.id === status) || EXCEPTION_STAGES.includes(status)) return status;

        const legacyStatus = String(order?.status || '').toLowerCase();
        if (legacyStatus === 'cancelled') return 'cancelled';
        if (legacyStatus === 'completed' || legacyStatus === 'delivered') return 'completed';
        if (legacyStatus === 'design-approval') return 'design-approval';
        if (legacyStatus === 'quality-checking') return 'quality-checking';
        if (legacyStatus === 'ready-for-release') return 'ready-for-release';
        if (legacyStatus === 'payment-verification') return 'payment-verification';
        if (legacyStatus === 'on-hold') return 'on-hold';
        if (legacyStatus === 'ready-for-delivery') return 'ready-for-release';
        if (legacyStatus === 'processing') return 'printing';
        return 'order-placed';
    }

    function validateProductionTransition(order, nextStatus) {
        const currentStatus = normalizeProductionStatus(order);
        if (currentStatus === nextStatus) return { ok: false, reason: 'This order is already at that stage.' };
        if (!PRODUCTION_STAGES.some(stage => stage.id === nextStatus) && !EXCEPTION_STAGES.includes(nextStatus)) {
            return { ok: false, reason: 'Unknown production stage.' };
        }
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
            return { ok: false, reason: 'Completed or cancelled orders cannot be changed.' };
        }
        if (nextStatus === 'cancelled' || nextStatus === 'on-hold') return { ok: true };

        if (currentStatus === 'on-hold') {
            if (nextStatus !== order.previousProductionStatus) {
                return { ok: false, reason: 'Resume the order at its previous production stage.' };
            }
            return { ok: true };
        }

        const currentIndex = PRODUCTION_STAGES.findIndex(stage => stage.id === currentStatus);
        const nextIndex = PRODUCTION_STAGES.findIndex(stage => stage.id === nextStatus);
        if (nextIndex !== currentIndex + 1) {
            return { ok: false, reason: 'Production stages must be completed in order.' };
        }
        if (nextStatus === 'design-approval') {
            if (order.paymentStatus !== 'verified') {
                return { ok: false, reason: 'Verify the payment before requesting design approval.' };
            }
            if (!order.finalDesignUrl) {
                return { ok: false, reason: 'Upload the final design before requesting customer approval.' };
            }
        }
        if (nextStatus === 'printing' && order.designApproval?.status !== 'approved') {
            return { ok: false, reason: 'The customer must approve the final design before production.' };
        }
        return { ok: true };
    }

    const api = { PRODUCTION_STAGES, EXCEPTION_STAGES, normalizeProductionStatus, validateProductionTransition };
    global.KingPinProductionTracking = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);