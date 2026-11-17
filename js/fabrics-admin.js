// Admin > Fabric Types: add, edit and remove the fabrics customers choose from
// in the Design Studio, each with a photo.

const adminFabricState = { fabrics: [], image: '', loading: false };

function escapeFabricHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function callFabricsApi(payload) {
    const response = await fetch('/.netlify/functions/fabrics', payload
        ? { method: 'POST', headers: getAuthenticatedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) }
        : { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Fabric types are unavailable right now.');
    return result;
}

async function loadAdminFabrics() {
    const list = document.getElementById('adminFabricList');
    if (!list) return;
    if (!adminFabricState.fabrics.length) list.innerHTML = '<p class="fabric-empty">Loading fabrics…</p>';
    try {
        const result = await callFabricsApi();
        adminFabricState.fabrics = Array.isArray(result.fabrics) ? result.fabrics : [];
        renderAdminFabrics();
    } catch (error) {
        list.innerHTML = `<p class="fabric-empty is-error">${escapeFabricHtml(error.message)}</p>`;
    }
    setupFabricImageInput();
}

function renderAdminFabrics() {
    const list = document.getElementById('adminFabricList');
    const count = document.getElementById('fabricCount');
    const fabrics = adminFabricState.fabrics;
    if (count) count.textContent = fabrics.length ? `(${fabrics.length})` : '';
    if (!fabrics.length) {
        list.innerHTML = `<div class="fabric-empty">
            <strong>No fabrics yet</strong>
            <span>Add the fabrics you offer. Customers pick from this list when they customize a design.</span>
            <button type="button" class="btn btn-primary" onclick="openFabricForm()">+ Add Fabric</button>
        </div>`;
        return;
    }
    const usedForLabel = { both: 'Tops & bottoms', tops: 'Tops', bottoms: 'Bottoms' };
    list.innerHTML = fabrics.map(fabric => `<article class="fabric-admin-card${fabric.available ? '' : ' is-hidden'}">
        <div class="fabric-admin-photo">${fabric.imageUrl ? `<img src="${escapeFabricHtml(fabric.imageUrl)}" alt="${escapeFabricHtml(fabric.name)} fabric" loading="lazy">` : '<span>No photo</span>'}</div>
        <div class="fabric-admin-body">
            <div class="fabric-admin-title">
                <strong>${escapeFabricHtml(fabric.name)}</strong>
                <span class="fabric-pill${fabric.available ? '' : ' is-off'}">${fabric.available ? 'Shown' : 'Hidden'}</span>
            </div>
            <small class="fabric-admin-use">${escapeFabricHtml(usedForLabel[fabric.usedFor] || 'Tops & bottoms')}</small>
            ${fabric.description ? `<p>${escapeFabricHtml(fabric.description)}</p>` : ''}
            <div class="fabric-admin-actions">
                <button type="button" class="btn btn-secondary btn-small" onclick="openFabricForm('${escapeFabricHtml(fabric.id)}')">Edit</button>
                <button type="button" class="btn btn-danger btn-small" onclick="deleteFabric('${escapeFabricHtml(fabric.id)}')">Delete</button>
            </div>
        </div>
    </article>`).join('');
}

function setFabricFormMessage(text, type = '') {
    const message = document.getElementById('fabricFormMessage');
    if (!message) return;
    message.className = `status-message${type ? ` ${type}` : ''}`;
    message.textContent = text;
}

function showFabricPreview(src) {
    const preview = document.getElementById('fabricImagePreview');
    const empty = document.getElementById('fabricImageEmpty');
    preview.hidden = !src;
    empty.hidden = Boolean(src);
    if (src) preview.src = src; else preview.removeAttribute('src');
}

function openFabricForm(fabricId = '') {
    const form = document.getElementById('fabricForm');
    const fabric = adminFabricState.fabrics.find(item => item.id === fabricId);
    form.reset();
    adminFabricState.image = '';
    document.getElementById('fabricId').value = fabric?.id || '';
    document.getElementById('fabricName').value = fabric?.name || '';
    document.getElementById('fabricDescription').value = fabric?.description || '';
    document.getElementById('fabricUsedFor').value = fabric?.usedFor || 'both';
    document.getElementById('fabricAvailable').checked = fabric ? fabric.available !== false : true;
    document.getElementById('fabricFormTitle').textContent = fabric ? `Edit ${fabric.name}` : 'Add fabric';
    document.getElementById('fabricRemoveImageRow').hidden = !fabric?.imageUrl;
    showFabricPreview(fabric?.imageUrl || '');
    setFabricFormMessage('');
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('fabricName').focus({ preventScroll: true });
}

function closeFabricForm() {
    const form = document.getElementById('fabricForm');
    form.hidden = true;
    form.reset();
    adminFabricState.image = '';
}

function setupFabricImageInput() {
    const input = document.getElementById('fabricImage');
    if (!input || input.dataset.ready === 'true') return;
    input.dataset.ready = 'true';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
            setFabricFormMessage('Choose a JPG, PNG, WEBP or GIF photo up to 10 MB.', 'error');
            input.value = '';
            return;
        }
        try {
            const prepared = await prepareUploadedDesignFile(file, { maxDimension: 1000, maxLength: 1100000 });
            adminFabricState.image = prepared.data;
            document.getElementById('fabricRemoveImage').checked = false;
            showFabricPreview(prepared.data);
            setFabricFormMessage('');
        } catch (error) {
            setFabricFormMessage(error.message, 'error');
        }
    });
}

async function saveFabric(event) {
    event.preventDefault();
    const button = document.getElementById('fabricSaveButton');
    const name = document.getElementById('fabricName').value.trim();
    if (!name) {
        setFabricFormMessage('Enter the fabric name.', 'error');
        return;
    }
    button.disabled = true;
    setFabricFormMessage('Saving…');
    try {
        const result = await callFabricsApi({
            action: 'save',
            fabric: {
                id: document.getElementById('fabricId').value,
                name,
                description: document.getElementById('fabricDescription').value.trim(),
                usedFor: document.getElementById('fabricUsedFor').value,
                available: document.getElementById('fabricAvailable').checked
            },
            image: adminFabricState.image,
            removeImage: document.getElementById('fabricRemoveImage').checked
        });
        adminFabricState.fabrics = result.fabrics || adminFabricState.fabrics;
        renderAdminFabrics();
        closeFabricForm();
        showStatusUpdateToast(`✓ ${name} saved. Customers see it in the Design Studio.`);
    } catch (error) {
        setFabricFormMessage(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

async function deleteFabric(fabricId) {
    const fabric = adminFabricState.fabrics.find(item => item.id === fabricId);
    if (!fabric) return;
    if (!await confirmAction(`Delete the fabric "${fabric.name}"? Customers will no longer see it. Orders that already used it keep its name and photo.`)) return;
    try {
        const result = await callFabricsApi({ action: 'delete', id: fabricId });
        adminFabricState.fabrics = result.fabrics || [];
        renderAdminFabrics();
        showStatusUpdateToast(`${fabric.name} was deleted.`);
    } catch (error) {
        showStatusUpdateToast(error.message);
    }
}
