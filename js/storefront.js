function formatStorefrontPrice(value) {
    return new Intl.NumberFormat('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

function setupStorefrontCatalog() {
    const categorySelect = document.getElementById('categoryFilter');
    const categoryFilters = document.getElementById('storefrontCategoryFilters');
    const productsList = document.getElementById('productsList');
    if (!categorySelect || !categoryFilters || !productsList) return;

    categoryFilters.replaceChildren();
    Array.from(categorySelect.options).forEach(option => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'catalog-filter';
        button.dataset.categoryFilter = option.value;
        button.textContent = option.value ? option.textContent.replace(/\s*Jersey$/, '') : 'All Products';
        button.setAttribute('aria-pressed', String(categorySelect.value === option.value));
        button.addEventListener('click', () => {
            categorySelect.value = option.value;
            categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        categoryFilters.appendChild(button);
    });

    if (!productsList.dataset.storefrontEventsReady) {
        productsList.addEventListener('click', event => {
            if (!event.target.closest('[data-clear-catalog]')) return;
            document.getElementById('searchProducts').value = '';
            categorySelect.value = '';
            filterProducts();
        });
        productsList.dataset.storefrontEventsReady = 'true';
    }

    syncStorefrontCategoryState(categorySelect.value);
}

function syncStorefrontCategoryState(selectedCategory) {
    document.querySelectorAll('#storefrontCategoryFilters [data-category-filter]').forEach(button => {
        const isSelected = button.dataset.categoryFilter === selectedCategory;
        button.classList.toggle('active', isSelected);
        button.setAttribute('aria-pressed', String(isSelected));
    });
}

function syncStorefrontCatalog(visibleProducts) {
    const count = document.getElementById('storefrontProductCount');
    const heroImage = document.getElementById('storefrontHeroImage');
    const productCount = Array.isArray(visibleProducts) ? visibleProducts.length : 0;

    if (count) count.textContent = `${productCount} ${productCount === 1 ? 'product' : 'products'}`;

    const featuredProduct = Array.isArray(appData.products)
           ? appData.products.find(product => product && (product.thumbnailUrl || product.image || (Array.isArray(product.images) && product.images.length)))
        : null;
    const featuredImage = appData.storefrontHero?.image || (featuredProduct
           ? (featuredProduct.thumbnailUrl || (Array.isArray(featuredProduct.images) && featuredProduct.images.length ? featuredProduct.images[0] : featuredProduct.image))
        : '');

    if (heroImage && featuredImage) {
        heroImage.src = featuredImage;
        heroImage.alt = appData.storefrontHero?.image ? 'Shop hero photo' : `${featuredProduct.name || 'KingPin'} jersey`;
        heroImage.hidden = false;
    }
}

function updateStorefrontHeroDisplay() {
    const hero = appData.storefrontHero || {};
    const title = document.getElementById('storefrontHeroTitle');
    const subtitle = document.querySelector('.storefront-hero-copy > p');
    const image = document.getElementById('storefrontHeroImage');

    if (title) title.textContent = hero.title || 'Your team. Your identity.';
    if (subtitle) subtitle.textContent = hero.subtitle || 'Custom jerseys & teamwear';
    if (image && hero.image) {
        image.src = hero.image;
        image.alt = 'Shop hero photo';
        image.hidden = false;
    } else {
        syncStorefrontCatalog(appData.products);
    }
}

function normalizeStorefrontHero(hero) {
    return {
        title: String(hero?.title || 'Your team. Your identity.').trim().slice(0, 90),
        subtitle: String(hero?.subtitle || 'Custom jerseys & teamwear').trim().slice(0, 140),
        image: String(hero?.image || '')
    };
}

function cacheStorefrontHero() {
    try {
        safeStorageSet(localStorage, 'kingpinStorefrontHero', JSON.stringify(appData.storefrontHero));
    } catch (error) {
        console.warn('Unable to cache the hero banner locally.', error);
    }
}

function populateStorefrontHeroForm() {
    const form = document.getElementById('storefrontHeroForm');
    if (!form || form.dataset.heroDirty === 'true') return;

    const hero = normalizeStorefrontHero(appData.storefrontHero);
    document.getElementById('storefrontHeroTitleInput').value = hero.title;
    document.getElementById('storefrontHeroSubtitleInput').value = hero.subtitle;
    document.getElementById('storefrontHeroUseCatalogImage').checked = !hero.image;
    const preview = document.getElementById('storefrontHeroPreview');
        const firstProduct = appData.products.find(product => product && (product.thumbnailUrl || product.image || product.images?.length));
    const previewImage = hero.image || (firstProduct ? (firstProduct.thumbnailUrl || firstProduct.images?.[0] || firstProduct.image) : '');
    preview.hidden = !previewImage;
    if (previewImage) preview.src = previewImage;
}

async function loadStorefrontHero() {
    try {
        const cachedHero = JSON.parse(localStorage.getItem('kingpinStorefrontHero') || 'null');
        if (cachedHero) appData.storefrontHero = normalizeStorefrontHero(cachedHero);
    } catch (error) {
        console.warn('Unable to read the cached hero banner.', error);
    }
    updateStorefrontHeroDisplay();

    try {
        const response = await fetch('/.netlify/functions/shop-hero', { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.hero) throw new Error(result.error || 'Unable to load the shop hero banner.');
        appData.storefrontHero = normalizeStorefrontHero(result.hero);
        cacheStorefrontHero();
        updateStorefrontHeroDisplay();
        populateStorefrontHeroForm();
    } catch (error) {
        console.warn('Unable to load shared shop hero settings; using the saved copy.', error);
    }
}

async function saveStorefrontHero(event) {
    event.preventDefault();
    if (appData.currentRole !== 'admin') return;

    const title = document.getElementById('storefrontHeroTitleInput').value.trim();
    const subtitle = document.getElementById('storefrontHeroSubtitleInput').value.trim();
    const imageFile = document.getElementById('storefrontHeroImageInput').files[0];
    const useCatalogImage = document.getElementById('storefrontHeroUseCatalogImage').checked;
    const message = document.getElementById('storefrontHeroMessage');
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');

    if (!title || title.length > 90 || subtitle.length > 140) {
        message.className = 'message error';
        message.textContent = 'Enter a heading up to 90 characters and a subtitle up to 140 characters.';
        return;
    }
    if (imageFile && (!/^image\/(png|jpeg|gif|webp)$/.test(imageFile.type) || imageFile.size > 3 * 1024 * 1024)) {
        message.className = 'message error';
        message.textContent = 'Choose a PNG, JPG, GIF, or WebP image up to 3 MB.';
        return;
    }

    message.className = 'message';
    message.textContent = 'Saving hero banner...';
    if (submitButton) submitButton.disabled = true;

    try {
        let image = useCatalogImage ? '' : appData.storefrontHero.image;
        if (imageFile) {
            image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('Unable to read the selected hero photo.'));
                reader.readAsDataURL(imageFile);
            });
        }

        const hero = normalizeStorefrontHero({ title, subtitle, image });
        const response = await fetch('/.netlify/functions/shop-hero', {
            method: 'POST',
            headers: getAuthenticatedHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(hero)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok !== true || !result.hero) {
            throw new Error(result.error || 'Unable to save the shared hero banner.');
        }

        appData.storefrontHero = normalizeStorefrontHero(result.hero);
        cacheStorefrontHero();
        updateStorefrontHeroDisplay();
        syncStorefrontCatalog(appData.products);
        document.getElementById('storefrontHeroImageInput').value = '';
        event.currentTarget.dataset.heroDirty = 'false';
        populateStorefrontHeroForm();
        message.className = 'message success';
        message.textContent = 'Hero banner saved and shared with customers.';
    } catch (error) {
        message.className = 'message error';
        message.textContent = `Hero banner was not saved: ${error.message}`;
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function updateStorefrontNavigation(activeDestination) {
    const bottomNavigation = document.getElementById('storefrontBottomNav');
    const customerPage = document.getElementById('customerPage');
    const isCustomerPage = appData.currentRole === 'customer'
        && customerPage
        && customerPage.style.display !== 'none';

    if (bottomNavigation) bottomNavigation.hidden = !isCustomerPage;

    const destination = activeDestination
        || (document.getElementById('productsSection')?.style.display !== 'none' ? 'shop'
            : document.getElementById('ordersSection')?.style.display === 'block' ? 'orders'
                : document.getElementById('customerServiceSection')?.style.display === 'block' ? 'support'
                    : document.getElementById('customerSettingsSection')?.style.display === 'block' ? 'account'
                        : '');
    document.querySelectorAll('[data-shop-destination]').forEach(button => {
        const isActive = isCustomerPage && button.dataset.shopDestination === destination;
        button.classList.toggle('active', isActive);
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });

    const menuToggle = document.querySelector('#customerPage .nav-menu-toggle');
    const menuOpen = document.getElementById('customerNavMenu')?.classList.contains('visible') || false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(menuOpen));
}

function navigateStorefront(destination) {
    if (appData.currentRole !== 'customer' || !appData.currentUser) {
        requireCustomerLogin(destination);
        return;
    }

    if (destination === 'shop') {
        document.getElementById('designSection').style.display = 'none';
        goBackToShop();
    }
    else if (destination === 'orders') viewOrders();
    else if (destination === 'support') viewCustomerService();
    else if (destination === 'account') viewCustomerSettings();
    else return;

    updateStorefrontNavigation(destination);
    if (typeof closeCustomerNavMenu === 'function') closeCustomerNavMenu();
}

document.addEventListener('DOMContentLoaded', () => {
    setupStorefrontCatalog();
    loadStorefrontHero();
    updateStorefrontNavigation();

    const heroForm = document.getElementById('storefrontHeroForm');
    if (heroForm) {
        heroForm.addEventListener('input', () => {
            heroForm.dataset.heroDirty = 'true';
        });
    }

    const customerPage = document.getElementById('customerPage');
    const watchedSections = [
        customerPage,
        document.getElementById('productsSection'),
        document.getElementById('ordersSection'),
        document.getElementById('customerServiceSection'),
        document.getElementById('customerSettingsSection')
    ].filter(Boolean);

    new MutationObserver(() => updateStorefrontNavigation()).observe(customerPage, {
        attributes: true,
        attributeFilter: ['style']
    });
    watchedSections.slice(1).forEach(section => {
        new MutationObserver(() => updateStorefrontNavigation()).observe(section, {
            attributes: true,
            attributeFilter: ['style']
        });
    });

    const menu = document.getElementById('customerNavMenu');
    const menuToggle = document.querySelector('#customerPage .nav-menu-toggle');
    if (menu && menuToggle) {
        new MutationObserver(() => {
            menuToggle.setAttribute('aria-expanded', String(menu.classList.contains('visible')));
        }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    }
});