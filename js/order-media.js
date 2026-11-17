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
        if (!item?.details) return '';

        const dataUrl = String(item.details.uploadedFile || '');
        if (IMAGE_DATA_URL.test(dataUrl)) return dataUrl;

        return getAuthorizedMediaUrl(item.details.uploadedFileUrl, orderId, '', itemIndex);
    }

    // Every design file of a cart or order item (uploaded designs and the front/back
    // photos of a customized design), in order, with its label and a safe source:
    // the photo itself while it is in the cart, or the order's signed link.
    function getDesignFileSources(item, orderId, itemIndex) {
        if (!item?.details) return [];
        const files = Array.isArray(item.details.uploadedFiles) ? item.details.uploadedFiles : [];
        if (!files.length) {
            const image = getUploadedDesignImageSource(item, orderId, itemIndex);
            return image ? [{ src: image, isImage: true, isPdf: false, label: '', fileName: String(item.details.fileName || '') }] : [];
        }
        return files.map((file, fileIndex) => {
            const dataUrl = String(file?.uploadedFile || '');
            const fileType = String(file?.fileType || '');
            let src = '';
            if (IMAGE_DATA_URL.test(dataUrl) || /^data:application\/pdf;base64,[a-z0-9+/=]+$/i.test(dataUrl)) src = dataUrl;
            else src = getAuthorizedMediaUrl(file?.uploadedFileUrl, orderId, '', itemIndex, fileIndex);
            const isPdf = fileType === 'application/pdf' || dataUrl.startsWith('data:application/pdf');
            return {
                src,
                isImage: Boolean(src) && !isPdf,
                isPdf,
                label: String(file?.label || ''),
                fileName: String(file?.fileName || 'customer-design')
            };
        }).filter(file => file.src);
    }

    function getUploadedDesignImageSources(item, orderId, itemIndex) {
        return getDesignFileSources(item, orderId, itemIndex).filter(file => file.isImage).map(file => file.src);
    }

    const api = { getOrderMediaSource, getUploadedDesignImageSource, getUploadedDesignImageSources, getDesignFileSources };
    global.KingPinOrderMedia = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);