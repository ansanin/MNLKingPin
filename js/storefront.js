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
        ? appData.products.find(product => product && (product.image || (Array.isArray(product.images) && product.images.length)))
        : null;
    const featuredImage = featuredProduct
        ? (Array.isArray(featuredProduct.images) && featuredProduct.images.length ? featuredProduct.images[0] : featuredProduct.image)
        : '';

    if (heroImage && featuredImage) {
        heroImage.src = featuredImage;
        heroImage.alt = `${featuredProduct.name || 'KingPin'} jersey`;
        heroImage.hidden = false;
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
}

function navigateStorefront(destination) {
    if (appData.currentRole !== 'customer') return;

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
    updateStorefrontNavigation();

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