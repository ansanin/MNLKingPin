(function (global) {
    const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
    const ACCESS_TOKEN = /^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i;

    function getAuthorizedMediaUrl(value, orderId, mediaType, itemIndex, fileIndex) {
        if (!value || !orderId) return '';

        try {
            const url = new URL(value, global.location?.href || 'https://kingpin.invalid');
            if (url.pathname !== '/.netlify/functions/order-design') return '';
            if (url.searchParams.get('orderId') !== String(orderId)) return '';

            const accessToken = url.searchParams.get('access') || '';
            if (!ACCESS_TOKEN.test(accessToken)) return '';

            if (mediaType) {
                return url.searchParams.get('media') === mediaType ? value : '';
            }
            return url.searchParams.get('itemIndex') === String(itemIndex)
                && (fileIndex === undefined
                    ? !url.searchParams.has('fileIndex')
                    : url.searchParams.get('fileIndex') === String(fileIndex))
                && !url.searchParams.has('media')
                ? value
                : '';
        } catch (error) {
            return '';
        }
    }

    function getOrderMediaSource(order, field) {
        const mediaTypes = { gcashQRCode: 'gcash-qr', gcashPaymentProof: 'gcash-proof' };
        const mediaType = mediaTypes[field];
        if (!mediaType) return '';

        const dataUrl = String(order?.[field] || '');
        if (IMAGE_DATA_URL.test(dataUrl)) return dataUrl;

        return getAuthorizedMediaUrl(order?.[`${field}Url`], order?.id, mediaType);
    }

    function getUploadedDesignImageSource(item, orderId, itemIndex) {
        if (item?.designType !== 'uploaded' || !item.details) return '';

        const dataUrl = String(item.details.uploadedFile || '');
        if (IMAGE_DATA_URL.test(dataUrl)) return dataUrl;

        return getAuthorizedMediaUrl(item.details.uploadedFileUrl, orderId, '', itemIndex);
    }

    function getUploadedDesignImageSources(item, orderId, itemIndex) {
        if (item?.designType !== 'uploaded' || !item.details) return [];
        const files = Array.isArray(item.details.uploadedFiles) ? item.details.uploadedFiles : [];
        if (!files.length) {
            const image = getUploadedDesignImageSource(item, orderId, itemIndex);
            return image ? [image] : [];
        }
        return files.map((file, fileIndex) => {
            const dataUrl = String(file.uploadedFile || '');
            if (IMAGE_DATA_URL.test(dataUrl)) return dataUrl;
            return getAuthorizedMediaUrl(file.uploadedFileUrl, orderId, '', itemIndex, fileIndex);
        }).filter(Boolean);
    }

    const api = { getOrderMediaSource, getUploadedDesignImageSource, getUploadedDesignImageSources };
    global.KingPinOrderMedia = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);