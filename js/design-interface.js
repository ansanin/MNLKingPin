// Design Studio: customize a top, a bottom or a full set (colors typed by the
// customer, a fabric from the shop's list, front and back design photos), or
// upload a finished design. Everything chosen here goes into one cart item, and
// the same details are shown to the admin on the order.

const CUSTOM_DESIGN_PRICES = { tops: 500, bottoms: 450, both: 950, uploaded: 600 };
const DESIGN_PHOTO_SLOTS = [
    { key: 'top-front', part: 'top', side: 'front', label: 'Top · Front' },
    { key: 'top-back', part: 'top', side: 'back', label: 'Top · Back' },
    { key: 'bottom-front', part: 'bottom', side: 'front', label: 'Bottom · Front' },
    { key: 'bottom-back', part: 'bottom', side: 'back', label: 'Bottom · Back' }
];

const designData = {
    currentDesignMode: 'customize',
    currentClothingType: 'tops',
    uploadedDesignFiles: [],
    photos: {},            // slot key -> { data, fileName, fileType }
    fabrics: [],           // from the shop's fabric list
    fabricsLoaded: false,
    selectedFabric: { top: '', bottom: '' }
};

function escapeDesignHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDesignPeso(value) {
    return `₱${(Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Opens the Design Studio, or goes back to the shop when it is already open.
function toggleDesignInterface() {
    const designSection = document.getElementById('designSection');
    if (designSection && designSection.style.display === 'none') {
        setCustomerActiveView('designSection');
        initializeDesignInterface();
    } else {
        setCustomerActiveView('productsSection');
    }
}

function initializeDesignInterface() {
    setupFileUploadPreview();
    setupDesignPhotoSlots();
    setupDesignFieldListeners();
    document.querySelectorAll('[data-type-price]').forEach(element => {
        element.textContent = formatDesignPeso(CUSTOM_DESIGN_PRICES[element.dataset.typePrice]);
    });
    const uploadPrice = document.getElementById('uploadDesignPrice');
    if (uploadPrice) uploadPrice.textContent = formatDesignPeso(CUSTOM_DESIGN_PRICES.uploaded);
    renderDesignFabricOptions();
    loadDesignFabrics();
    updateDesignSummary();
}

function setDesignMode(mode) {
    if (!['customize', 'upload'].includes(mode)) return;
    designData.currentDesignMode = mode;
    document.querySelectorAll('.ds-mode-btn').forEach(button => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    document.getElementById('customizeDesignMode').hidden = mode !== 'customize';
    document.getElementById('uploadDesignMode').hidden = mode !== 'upload';
}

// Top only, bottom only, or both (a set).
function setClothingType(type) {
    if (!['tops', 'bottoms', 'both'].includes(type)) return;
    designData.currentClothingType = type;
    document.querySelectorAll('.ds-type-card').forEach(card => {
        const active = card.dataset.type === type;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-checked', String(active));
    });
    const showTop = type !== 'bottoms';
    const showBottom = type !== 'tops';
    document.getElementById('topsDesignForm').hidden = !showTop;
    document.getElementById('bottomsDesignForm').hidden = !showBottom;
    // In a set the bottom is step 3 and the notes step 4.
    const bottomStep = document.querySelector('#bottomsDesignForm .ds-step-no');
    if (bottomStep) bottomStep.textContent = type === 'both' ? '3' : '2';
    const notesStep = document.querySelector('#dsNotesTitle')?.closest('.ds-step')?.querySelector('.ds-step-no');
    if (notesStep) notesStep.textContent = type === 'both' ? '4' : '3';
    hideDesignError();
    updateDesignSummary();
}

function getActiveDesignParts() {
    const type = designData.currentClothingType;
    return [type !== 'bottoms' ? 'top' : '', type !== 'tops' ? 'bottom' : ''].filter(Boolean);
}

// ----- Fabrics (managed by the admin under Fabric Types) -----
async function loadDesignFabrics(force = false) {
    if (designData.fabricsLoaded && !force) return designData.fabrics;
    try {
        const response = await fetch('/.netlify/functions/fabrics', { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Fabric list is unavailable.');
        designData.fabrics = Array.isArray(result.fabrics) ? result.fabrics : [];
        designData.fabricsLoaded = true;
    } catch (error) {
        console.warn('Unable to load fabric types:', error);
        designData.fabricsLoaded = false;
    }
    renderDesignFabricOptions();
    updateDesignSummary();
    return designData.fabrics;
}

function getFabricsForPart(part) {
    const usedFor = part === 'top' ? 'tops' : 'bottoms';
    return designData.fabrics.filter(fabric => fabric.available !== false && (fabric.usedFor === 'both' || fabric.usedFor === usedFor));
}

function renderDesignFabricOptions() {
    ['top', 'bottom'].forEach(part => {
        const container = document.getElementById(`${part}FabricOptions`);
        if (!container) return;
        const fabrics = getFabricsForPart(part);
        if (!fabrics.some(fabric => fabric.id === designData.selectedFabric[part])) designData.selectedFabric[part] = '';
        if (!fabrics.length) {
            const typed = document.getElementById(`${part}FabricText`)?.value || '';
            container.innerHTML = `
                <div class="ds-fabric-empty">
                    <p>${designData.fabricsLoaded ? 'The shop has not listed fabrics yet.' : 'Loading the shop\'s fabrics…'} Type the fabric you want:</p>
                    <input type="text" id="${part}FabricText" maxlength="60" placeholder="e.g., Dri-fit" value="${escapeDesignHtml(typed)}" data-ds-field aria-label="${part === 'top' ? 'Top' : 'Bottom'} fabric">
                </div>`;
            container.querySelector('input').addEventListener('input', updateDesignSummary);
            return;
        }
        container.innerHTML = fabrics.map(fabric => {
            const selected = designData.selectedFabric[part] === fabric.id;
            return `<button type="button" class="ds-fabric-card${selected ? ' is-active' : ''}" role="radio" aria-checked="${selected}" data-fabric-id="${escapeDesignHtml(fabric.id)}">
                <span class="ds-fabric-photo">${fabric.imageUrl ? `<img src="${escapeDesignHtml(fabric.imageUrl)}" alt="" loading="lazy">` : '<span aria-hidden="true">▦</span>'}</span>
                <span class="ds-fabric-text"><strong>${escapeDesignHtml(fabric.name)}</strong>${fabric.description ? `<small>${escapeDesignHtml(fabric.description)}</small>` : ''}</span>
                <span class="ds-fabric-check" aria-hidden="true">✓</span>
            </button>`;
        }).join('');
        container.querySelectorAll('.ds-fabric-card').forEach(card => {
            card.addEventListener('click', () => {
                designData.selectedFabric[part] = card.dataset.fabricId;
                renderDesignFabricOptions();
                hideDesignError();
                updateDesignSummary();
            });
        });
    });
}

// The fabric chosen for a part: a listed fabric, or what the customer typed when none are listed.
function getChosenFabric(part) {
    const fabric = designData.fabrics.find(item => item.id === designData.selectedFabric[part]);
    if (fabric) return { name: fabric.name, id: fabric.id, imageUrl: fabric.imageUrl || '', description: fabric.description || '' };
    const typed = String(document.getElementById(`${part}FabricText`)?.value || '').trim();
    return typed ? { name: typed, id: '', imageUrl: '', description: '' } : null;
}

// ----- Front and back design photos -----
function setupDesignPhotoSlots() {
    document.querySelectorAll('.ds-photo-slot').forEach(slot => {
        if (slot.dataset.ready === 'true') return;
        slot.dataset.ready = 'true';
        const input = slot.querySelector('.ds-photo-input');
        input.addEventListener('change', () => handleDesignPhoto(slot, input.files[0]));
        ['dragenter', 'dragover'].forEach(type => slot.addEventListener(type, event => {
            event.preventDefault();
            slot.classList.add('is-dragging');
        }));
        ['dragleave', 'drop'].forEach(type => slot.addEventListener(type, event => {
            event.preventDefault();
            slot.classList.remove('is-dragging');
        }));
        slot.addEventListener('drop', event => handleDesignPhoto(slot, event.dataTransfer.files[0]));
    });
}

async function handleDesignPhoto(slot, file) {
    const input = slot.querySelector('.ds-photo-input');
    if (!file) return;
    const key = `${slot.dataset.part}-${slot.dataset.side}`;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        input.value = '';
        showStatusUpdateToast('Choose a JPG, PNG, WEBP or GIF photo.');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        input.value = '';
        showStatusUpdateToast('Each photo must be 10 MB or smaller.');
        return;
    }
    slot.classList.add('is-loading');
    try {
        const prepared = await prepareUploadedDesignFile(file, { maxDimension: 1400, maxLength: 900000 });
        designData.photos[key] = { data: prepared.data, fileName: prepared.fileName, fileType: prepared.fileType };
        renderDesignPhotoSlot(slot);
        hideDesignError();
        updateDesignSummary();
    } catch (error) {
        showStatusUpdateToast(error.message || 'Unable to add this photo.');
    } finally {
        input.value = '';
        slot.classList.remove('is-loading');
    }
}

function renderDesignPhotoSlot(slot) {
    const key = `${slot.dataset.part}-${slot.dataset.side}`;
    const photo = designData.photos[key];
    const sideLabel = slot.dataset.side === 'front' ? 'Front' : 'Back';
    slot.querySelector('.ds-photo-preview')?.remove();
    slot.classList.toggle('has-photo', Boolean(photo));
    if (!photo) return;
    const preview = document.createElement('span');
    preview.className = 'ds-photo-preview';
    preview.innerHTML = `<img src="${photo.data}" alt="${sideLabel} design photo"><span class="ds-photo-tag">${sideLabel}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ds-photo-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${slot.dataset.part} ${slot.dataset.side} photo`);
    remove.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        delete designData.photos[key];
        renderDesignPhotoSlot(slot);
        updateDesignSummary();
    });
    preview.appendChild(remove);
    slot.appendChild(preview);
}

function resetDesignPhotos() {
    designData.photos = {};
    document.querySelectorAll('.ds-photo-slot').forEach(renderDesignPhotoSlot);
}

// ----- Summary, quantity and validation -----
function setupDesignFieldListeners() {
    const section = document.getElementById('customizeDesignMode');
    if (!section || section.dataset.listening === 'true') return;
    section.dataset.listening = 'true';
    section.addEventListener('input', event => {
        if (event.target.matches('[data-ds-field]')) {
            event.target.classList.remove('field-invalid');
            updateDesignSummary();
        }
    });
    section.addEventListener('change', event => {
        if (event.target.matches('[data-ds-field]')) updateDesignSummary();
    });
}

function getDesignQuantity() {
    const quantity = Math.floor(Number(document.getElementById('designQuantity')?.value) || 1);
    return Math.min(99, Math.max(1, quantity));
}

function changeDesignQuantity(change) {
    const input = document.getElementById('designQuantity');
    if (!input) return;
    input.value = String(Math.min(99, Math.max(1, getDesignQuantity() + change)));
    updateDesignSummary();
}

function readDesignPart(part) {
    const prefix = part === 'top' ? 'top' : 'bottom';
    const value = id => String(document.getElementById(id)?.value || '').trim();
    const fabric = getChosenFabric(part);
    return {
        part,
        label: part === 'top' ? 'Top' : 'Bottom',
        baseColor: value(`${prefix}Color`),
        accentColor: value(`${prefix}AccentColor`),
        size: value(`${prefix}Size`),
        sideStripe: part === 'bottom' ? value('bottomSideStripe') : '',
        fabricType: fabric?.name || '',
        fabricId: fabric?.id || '',
        fabricImageUrl: fabric?.imageUrl || '',
        fabricDescription: fabric?.description || ''
    };
}

function updateDesignSummary() {
    const list = document.getElementById('designSummaryList');
    const photosBox = document.getElementById('designSummaryPhotos');
    const price = document.getElementById('designSummaryPrice');
    if (!list) return;
    const typeLabel = { tops: 'Top only', bottoms: 'Bottom only', both: 'Top & bottom set' }[designData.currentClothingType];
    const rows = [['Item', typeLabel]];
    getActiveDesignParts().forEach(part => {
        const details = readDesignPart(part);
        const label = getActiveDesignParts().length > 1 ? `${details.label} ` : '';
        rows.push([`${label}color`, [details.baseColor, details.accentColor && `trim: ${details.accentColor}`].filter(Boolean).join(', ') || '—']);
        rows.push([`${label}fabric`, details.fabricType || '—']);
    });
    list.innerHTML = rows.map(([term, value]) => `<div><dt>${escapeDesignHtml(term)}</dt><dd>${escapeDesignHtml(value)}</dd></div>`).join('');
    const photos = DESIGN_PHOTO_SLOTS.filter(slot => getActiveDesignParts().includes(slot.part) && designData.photos[slot.key]);
    photosBox.innerHTML = photos.length
        ? photos.map(slot => `<figure><img src="${designData.photos[slot.key].data}" alt=""><figcaption>${escapeDesignHtml(slot.label)}</figcaption></figure>`).join('')
        : '<p class="ds-summary-empty">No design photos yet</p>';
    price.textContent = formatDesignPeso(CUSTOM_DESIGN_PRICES[designData.currentClothingType] * getDesignQuantity());
}

function showDesignError(message, field) {
    const error = document.getElementById('designFormError');
    if (error) {
        error.textContent = message;
        error.hidden = false;
    }
    if (field) {
        field.classList.add('field-invalid');
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof field.focus === 'function') field.focus({ preventScroll: true });
    }
}

function hideDesignError() {
    const error = document.getElementById('designFormError');
    if (error) error.hidden = true;
}

// One cart item for the whole design: a top, a bottom, or the set.
function addCustomDesignToCart() {
    hideDesignError();
    const type = designData.currentClothingType;
    const parts = getActiveDesignParts().map(readDesignPart);
    for (const part of parts) {
        const prefix = part.part === 'top' ? 'top' : 'bottom';
        if (!part.baseColor) {
            showDesignError(`Type the base color of the ${part.label.toLowerCase()}.`, document.getElementById(`${prefix}Color`));
            return;
        }
        if (!part.fabricType) {
            showDesignError(`Choose the fabric of the ${part.label.toLowerCase()}.`, document.getElementById(`${prefix}FabricText`) || document.getElementById(`${prefix}FabricOptions`));
            return;
        }
    }
    const notes = String(document.getElementById('designNotes')?.value || '').trim();
    const uploadedFiles = DESIGN_PHOTO_SLOTS
        .filter(slot => parts.some(part => part.part === slot.part) && designData.photos[slot.key])
        .map(slot => ({
            uploadedFile: designData.photos[slot.key].data,
            fileName: designData.photos[slot.key].fileName,
            fileType: designData.photos[slot.key].fileType,
            label: slot.label,
            part: slot.part,
            side: slot.side
        }));
    if (!uploadedFiles.length && !notes) {
        showDesignError('Add at least one design photo (front or back), or describe the design in the notes.', document.querySelector('.ds-part:not([hidden]) .ds-photo-slot'));
        return;
    }
    const cartDesignBytes = appData.cart.reduce((sum, item) => sum + (item.details?.uploadedFiles || []).reduce((total, file) => total + String(file.uploadedFile || '').length, 0), 0);
    const newBytes = uploadedFiles.reduce((sum, file) => sum + file.uploadedFile.length, 0);
    // The order (photos plus a payment proof) must stay under Netlify's 6 MB request limit.
    if (cartDesignBytes + newBytes > 4000000) {
        showDesignError('Your cart already holds many design photos. Check out the items in your cart first, then add this design.');
        return;
    }

    const quantity = getDesignQuantity();
    const top = parts.find(part => part.part === 'top');
    const bottom = parts.find(part => part.part === 'bottom');
    const name = type === 'both' ? 'Custom Set (Top & Bottom)' : type === 'tops' ? 'Custom Top' : 'Custom Bottom';
    const colorName = parts.map(part => part.baseColor).join(' / ');
    const cartItem = {
        id: Date.now(),
        name: `${name} - ${colorName}`.slice(0, 120),
        type: 'custom-design',
        designType: 'custom',
        quantity,
        price: CUSTOM_DESIGN_PRICES[type],
        customization: { size: top?.size || '', bottomSize: bottom?.size || '' },
        details: {
            clothingType: type === 'both' ? 'set' : type === 'tops' ? 'top' : 'bottoms',
            parts,
            notes,
            uploadedFiles,
            customizationDate: new Date().toLocaleString()
        }
    };

    appData.cart.push(cartItem);
    saveUserCart();
    updateCartCount();
    updateCartDisplay();
    showStatusUpdateToast(`✓ ${name} added to cart.`);
    resetCustomDesignForm();
    openCartAfterDesign();
}

function resetCustomDesignForm() {
    document.querySelectorAll('#customizeDesignMode [data-ds-field]').forEach(field => {
        if (field.id === 'designQuantity') field.value = '1';
        else field.value = '';
        field.classList.remove('field-invalid');
    });
    designData.selectedFabric = { top: '', bottom: '' };
    resetDesignPhotos();
    renderDesignFabricOptions();
    hideDesignError();
    updateDesignSummary();
}

// Shows the cart with the new design in it.
function openCartAfterDesign() {
    if (document.getElementById('cartSection')?.style.display !== 'block') toggleCart();
    else updateCartDisplay();
}

// ----- Upload a finished design -----
function setupFileUploadPreview() {
    const fileInput = document.getElementById('uploadDesignFile');
    const previewContainer = document.getElementById('uploadDesignFilesPreview');
    const fileCount = document.getElementById('uploadDesignFileCount');
    const dropZone = document.getElementById('uploadDesignDropZone');

    if (!fileInput || fileInput.dataset.previewSetup === 'true') return;
    fileInput.dataset.previewSetup = 'true';

    const renderSelectedFiles = () => {
        previewContainer.innerHTML = '';
        const count = designData.uploadedDesignFiles.length;
        fileCount.textContent = count ? `${count} file${count === 1 ? '' : 's'} selected` : '';
        designData.uploadedDesignFiles.forEach((file, fileIndex) => {
            const preview = document.createElement('div');
            preview.className = 'ds-file-card';
            if (file.type.startsWith('image/')) {
                const image = document.createElement('img');
                image.alt = `Design file ${fileIndex + 1}`;
                image.src = URL.createObjectURL(file);
                preview.appendChild(image);
            } else {
                const fileType = document.createElement('span');
                fileType.className = 'ds-file-pdf';
                fileType.textContent = 'PDF';
                preview.appendChild(fileType);
            }
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'ds-photo-remove';
            removeButton.setAttribute('aria-label', `Remove design file ${fileIndex + 1}`);
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                designData.uploadedDesignFiles.splice(fileIndex, 1);
                renderSelectedFiles();
            });
            preview.appendChild(removeButton);
            previewContainer.appendChild(preview);
        });
    };

    const showFiles = files => {
        const addedFiles = Array.from(files || []);
        if (!addedFiles.length) return;
        if (addedFiles.some(file => !file.type.startsWith('image/') && file.type !== 'application/pdf')) {
            showStatusUpdateToast('Only image files and PDFs are supported.');
            return;
        }
        if (addedFiles.some(file => file.size > 10 * 1024 * 1024)) {
            showStatusUpdateToast('Each file must be 10MB or smaller.');
            return;
        }
        const existingKeys = new Set(designData.uploadedDesignFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`));
        const uniqueAddedFiles = addedFiles.filter(file => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`));
        designData.uploadedDesignFiles = [...designData.uploadedDesignFiles, ...uniqueAddedFiles];
        fileInput.value = '';
        renderSelectedFiles();
    };

    fileInput.addEventListener('change', () => showFiles(fileInput.files));
    if (dropZone) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInput.click();
            }
        });
        ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
            event.preventDefault();
            dropZone.classList.add('is-dragging');
        }));
        ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
            event.preventDefault();
            dropZone.classList.remove('is-dragging');
        }));
        dropZone.addEventListener('drop', event => showFiles(event.dataTransfer.files));
    }
}

function readDesignFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read the uploaded file.'));
        reader.readAsDataURL(file);
    });
}

// Shrinks a photo so it can travel with the order; PDFs are kept as they are.
async function prepareUploadedDesignFile(file, { maxDimension = 1600, maxLength = 1800000 } = {}) {
    const originalData = await readDesignFileAsDataUrl(file);
    if (!file.type.startsWith('image/')) {
        return { data: originalData, fileName: file.name, fileType: file.type };
    }

    const image = new Image();
    image.src = originalData;
    await image.decode();

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const dimension = maxDimension * Math.pow(0.82, attempt);
        const scale = Math.min(1, dimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

        const quality = Math.max(0.5, 0.82 - attempt * 0.08);
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp;base64,')) {
            const context = canvas.getContext('2d');
            context.globalCompositeOperation = 'destination-over';
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL('image/jpeg', quality);
        }

        if (data.length <= maxLength) {
            const extension = data.startsWith('data:image/webp;') ? 'webp' : 'jpg';
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'customer-design';
            return { data, fileName: `${baseName}.${extension}`, fileType: data.slice(5, data.indexOf(';')) };
        }
    }

    throw new Error('This photo is too large to add. Please choose a smaller image.');
}

async function addUploadedDesignToCart() {
    const files = designData.uploadedDesignFiles;
    const clothingType = document.getElementById('uploadClothingType').value;
    const itemDescription = document.getElementById('uploadItemDescription').value.trim();
    const notes = String(document.getElementById('uploadDesignNotes')?.value || '').trim();

    if (!files.length || !clothingType || !itemDescription) {
        showStatusUpdateToast('Add at least one design file, choose the item type and describe the item.');
        return;
    }

    try {
        const uploadedFiles = await Promise.all(files.map(async file => {
            const prepared = await prepareUploadedDesignFile(file);
            return { uploadedFile: prepared.data, fileName: prepared.fileName, fileType: prepared.fileType };
        }));
        if (uploadedFiles.reduce((total, file) => total + file.uploadedFile.length, 0) > 4500000) {
            throw new Error('The combined design files are too large. Choose fewer or smaller photos.');
        }
        const cartItem = {
            id: Date.now(),
            name: `${itemDescription} (Custom Upload)`,
            type: 'custom-design',
            quantity: 1,
            price: CUSTOM_DESIGN_PRICES.uploaded,
            designType: 'uploaded',
            details: {
                clothingType,
                itemDescription,
                notes,
                uploadedFile: uploadedFiles[0].uploadedFile,
                uploadedFiles,
                fileName: uploadedFiles.map(file => file.fileName).join(', '),
                fileType: uploadedFiles[0].fileType,
                uploadDate: new Date().toLocaleString()
            }
        };

        appData.cart.push(cartItem);
        saveUserCart();
        updateCartCount();
        updateCartDisplay();
        showStatusUpdateToast(`${itemDescription} design added to cart.`);

        document.getElementById('uploadDesignFile').value = '';
        document.getElementById('uploadClothingType').value = '';
        document.getElementById('uploadItemDescription').value = '';
        if (document.getElementById('uploadDesignNotes')) document.getElementById('uploadDesignNotes').value = '';
        document.getElementById('uploadDesignFilesPreview').innerHTML = '';
        document.getElementById('uploadDesignFileCount').textContent = '';
        designData.uploadedDesignFiles = [];
        openCartAfterDesign();
    } catch (error) {
        console.error('Unable to add uploaded design to cart:', error);
        showStatusUpdateToast(error.message || 'Unable to add the uploaded design to cart.');
    }
}
