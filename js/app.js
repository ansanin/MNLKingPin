// KINGPIN - Clothing Management System
// Main Application JavaScript

// Data Storage
const appData = {
    currentUser: null,
    currentRole: null,
    currentUserProfile: null,
    products: [],
    cart: [],
    orders: [],
    selectedProduct: null,
    customers: [],
    notifications: [],
    editingCartIndex: null,
    shopLogo: null,
    gcashQRCode: null,
    shopName: 'KingPin Custom Ph® CamSur',
    adminCredentials: {
        username: 'admin',
        password: 'admin123'
    }
};

let sharedProductsRequest = null;

function applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-mode', isLight);
    document.querySelectorAll('.theme-toggle').forEach(button => {
        button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
        const icon = button.querySelector('.theme-toggle-icon');
        const label = button.querySelector('.theme-toggle-label');
        if (icon) icon.textContent = isLight ? '🌙' : '☀️';
        if (label) label.textContent = isLight ? 'Dark Mode' : 'Light Mode';
    });
}

function toggleTheme() {
    const nextTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    localStorage.setItem('kingpinTheme', nextTheme);
    applyTheme(nextTheme);
}

function closeCustomerNavMenu() {
    const navMenu = document.getElementById('customerNavMenu');
    if (!navMenu) return;
    navMenu.classList.remove('visible');
    navMenu.style.display = 'none';
}

function closeAdminNavMenu() {
    const navMenu = document.getElementById('adminNavMenu');
    if (!navMenu) return;
    navMenu.classList.remove('visible');
    navMenu.style.display = 'none';
}

function toggleNavMenu() {
    const navMenu = document.getElementById('customerNavMenu');
    if (!navMenu) return;

    const isOpen = navMenu.classList.contains('visible');
    navMenu.classList.toggle('visible', !isOpen);
    navMenu.style.display = isOpen ? 'none' : 'flex';
    navMenu.style.position = 'fixed';
    navMenu.style.top = '62px';
    navMenu.style.right = '12px';
    navMenu.style.left = 'auto';
    navMenu.style.zIndex = '2147483647';
}

function toggleAdminNavMenu() {
    const navMenu = document.getElementById('adminNavMenu');
    if (!navMenu) return;

    const isOpen = navMenu.classList.contains('visible');
    navMenu.classList.toggle('visible', !isOpen);
    navMenu.style.display = isOpen ? 'none' : 'flex';
    navMenu.style.position = 'fixed';
    navMenu.style.top = '62px';
    navMenu.style.right = '12px';
    navMenu.style.left = 'auto';
    navMenu.style.zIndex = '2147483647';
}

document.addEventListener('click', (event) => {
    const customerNavMenu = document.getElementById('customerNavMenu');
    const customerToggleButton = document.querySelector('.nav-menu-toggle');
    const adminNavMenu = document.getElementById('adminNavMenu');
    const adminToggleButton = document.querySelector('.admin-nav-menu-toggle');

    const customerClickedInside = customerNavMenu && customerNavMenu.contains(event.target);
    const customerClickedToggle = customerToggleButton && customerToggleButton.contains(event.target);
    const adminClickedInside = adminNavMenu && adminNavMenu.contains(event.target);
    const adminClickedToggle = adminToggleButton && adminToggleButton.contains(event.target);

    if (customerNavMenu && customerClickedInside && event.target.closest('button')) {
        closeCustomerNavMenu();
        return;
    }

    if (adminNavMenu && adminClickedInside && event.target.closest('button')) {
        closeAdminNavMenu();
        return;
    }

    if (customerNavMenu && !customerClickedInside && !customerClickedToggle) {
        closeCustomerNavMenu();
    }

    if (adminNavMenu && !adminClickedInside && !adminClickedToggle) {
        closeAdminNavMenu();
    }
});

applyTheme(localStorage.getItem('kingpinTheme') || 'dark');

// Notification System
function addNotification(type, message, orderId = null) {
    const notification = {
        id: Date.now(),
        type: type, // 'admin' or 'customer'
        message: message,
        orderId: orderId,
        read: false,
        timestamp: new Date().toLocaleString()
    };
    appData.notifications.push(notification);
    console.log('Added notification:', notification);
    updateNotificationBadges();
}

// Show toast notification for real-time feedback
function showStatusUpdateToast(message) {
    // Remove existing toast if any
    const existingToast = document.getElementById('statusUpdateToast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create new toast element
    const toast = document.createElement('div');
    toast.id = 'statusUpdateToast';
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: #4caf50;
        color: white;
        padding: 16px 24px;
        border-radius: 5px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-weight: 600;
        z-index: 10000;
        animation: slideInToast 0.3s ease-out;
        max-width: 300px;
    `;
    toast.textContent = '✓ ' + message;
    
    document.body.appendChild(toast);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOutToast 0.3s ease-out';
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

function getUnreadNotifications(type) {
    return appData.notifications.filter(n => n.type === type && !n.read);
}

function getUnreadCount(type) {
    return getUnreadNotifications(type).length;
}

function markNotificationAsRead(id) {
    const notification = appData.notifications.find(n => n.id === id);
    if (notification) {
        notification.read = true;
        saveNotifications();
        if (notification.orderId && appData.currentRole === 'customer') {
            viewOrders();
        }
    }
    updateNotificationBadges();
}

function updateNotificationBadges() {
    const adminCount = getUnreadCount('admin');
    const customerCount = getUnreadNotifications('customer').filter(notification => notification.orderId).length;
    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    const unreadMessageCount = serviceMessages.filter(serviceMessage => !serviceMessage.read).length;
    
    const adminOrdersBadge = document.querySelector('[data-notification-badge="admin-orders"]');
    const customerNotificationBadge = document.querySelector('[data-notification-badge="customer-notifications"]');
    const adminMessagesBadge = document.querySelector('[data-notification-badge="admin-messages"]');
    
    if (adminOrdersBadge) {
        adminOrdersBadge.textContent = adminCount;
        adminOrdersBadge.style.display = adminCount > 0 ? 'inline-block' : 'none';
    }
    
    if (customerNotificationBadge) {
        customerNotificationBadge.textContent = customerCount;
        customerNotificationBadge.style.display = customerCount > 0 ? 'inline-block' : 'none';
    }

    if (adminMessagesBadge) {
        adminMessagesBadge.textContent = unreadMessageCount;
        adminMessagesBadge.style.display = unreadMessageCount > 0 ? 'inline-block' : 'none';
    }
}

// ===== LOCAL STORAGE MANAGEMENT =====
function compactOrderForStorage(order) {
    if (!order || typeof order !== 'object') return order;

    const compact = { ...order };

    if (compact.items && Array.isArray(compact.items)) {
        compact.items = compact.items.map(item => {
            const nextItem = { ...item };

            if (nextItem.image && typeof nextItem.image === 'string' && nextItem.image.startsWith('data:')) {
                delete nextItem.image;
            }

            if (nextItem.productImage && typeof nextItem.productImage === 'string' && nextItem.productImage.startsWith('data:')) {
                delete nextItem.productImage;
            }

            return nextItem;
        });
    }

    if (compact.gcashQRCode && typeof compact.gcashQRCode === 'string' && compact.gcashQRCode.startsWith('data:')) {
        compact.gcashQRCode = compact.gcashQRCode.length > 2000 ? null : compact.gcashQRCode;
    }

    return compact;
}

// Save orders to localStorage
function saveOrders() {
    const trimmedOrders = (appData.orders || []).slice(-200).map(compactOrderForStorage);

    try {
        localStorage.setItem('kingpinOrders', JSON.stringify(trimmedOrders));
        return;
    } catch (error) {
        console.warn('Quota exceeded while saving orders. Trimming older orders...', error);
    }

    const reducedOrders = trimmedOrders.slice(-60).map(compactOrderForStorage);

    try {
        localStorage.setItem('kingpinOrders', JSON.stringify(reducedOrders));
        return;
    } catch (secondError) {
        console.warn('Storage still full. Saving only essential order details...', secondError);
    }

    const minimalOrders = reducedOrders.map(order => ({
        id: order.id,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        totalAmount: order.totalAmount,
        status: order.status,
        date: order.date,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        items: (order.items || []).map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            customization: {
                size: item.customization?.size || '',
                color: item.customization?.color || '',
                name: item.customization?.name || '',
                number: item.customization?.number || ''
            }
        }))
    })).slice(-30);

    localStorage.setItem('kingpinOrders', JSON.stringify(minimalOrders));
}

// Load orders from localStorage
function loadOrders() {
    const stored = localStorage.getItem('kingpinOrders');
    if (stored) {
        appData.orders = JSON.parse(stored);
    }
}

async function fetchSharedOrders() {
    const endpoints = ['api/orders', 'api/orders.php', '/.netlify/functions/orders'];
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, { cache: 'no-store' });
            if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) continue;
            const result = await response.json();
            if (Array.isArray(result.orders)) return result.orders;
        } catch (error) {
            console.warn(`Unable to load shared orders from ${endpoint}:`, error);
        }
    }
    throw new Error('Shared order API unavailable');
}

async function saveOrderToSharedServer(order) {
    const endpoints = ['api/orders', 'api/orders.php', '/.netlify/functions/orders'];
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order)
            });
            if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) continue;
            const result = await response.json();
            if (result.ok === true) return true;
        } catch (error) {
            console.warn(`Unable to save shared order to ${endpoint}:`, error);
        }
    }
    throw new Error('Shared order API unavailable');
}

// Save notifications to localStorage
function saveNotifications() {
    localStorage.setItem('kingpinNotification', JSON.stringify(appData.notifications));
}

// Load notifications from localStorage
function loadNotifications() {
    const stored = localStorage.getItem('kingpinNotification');
    if (stored) {
        try {
            appData.notifications = JSON.parse(stored);
            appData.notifications = appData.notifications.map(notification => ({
                ...notification,
                message: notification.message
                    .replace(/\s+-\s+(GCash downpayment received|Cash on Delivery)\.?$/i, '')
            }));
            saveNotifications();
            console.log('Loaded notifications:', appData.notifications);
            // Update badges after a small delay to ensure DOM is ready
            setTimeout(() => {
                updateNotificationBadges();
                console.log('Updated notification badges');
            }, 100);
        } catch (e) {
            console.error('Error loading notifications:', e);
        }
    } else {
        console.log('No notifications found in localStorage');
    }
}

// ===== USER-SPECIFIC CART PERSISTENCE =====
// Save user's cart to localStorage
function saveUserCart() {
    if (!appData.currentUser) return;
    const key = `kingpinCart_${appData.currentUser}`;
    localStorage.setItem(key, JSON.stringify(appData.cart));
    console.log(`Cart saved for user: ${appData.currentUser}`);
}

// Load user's cart from localStorage
function loadUserCart() {
    if (!appData.currentUser) {
        appData.cart = [];
        return;
    }
    const key = `kingpinCart_${appData.currentUser}`;
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            appData.cart = JSON.parse(stored);
            console.log(`Cart loaded for user: ${appData.currentUser}`, appData.cart);
            updateCartCount();
            updateCartDisplay();
        } catch (e) {
            console.error('Error loading user cart:', e);
            appData.cart = [];
        }
    } else {
        appData.cart = [];
    }
}

// Clear user's cart from localStorage
function clearUserCart() {
    if (!appData.currentUser) return;
    const key = `kingpinCart_${appData.currentUser}`;
    localStorage.removeItem(key);
    appData.cart = [];
    console.log(`Cart cleared for user: ${appData.currentUser}`);
}

// Check for saved session and auto-login
function checkSavedSession() {
    const session = loadCurrentSession();
    if (!session) return; // No saved session
    
    try {
        // Check if session is still valid (less than 7 days old)
        const sessionAge = Date.now() - session.savedAt;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (sessionAge > sevenDaysMs) {
            clearCurrentSession();
            return;
        }
        
        // Auto-login based on role
        if (session.role === 'customer') {
            // Load customer accounts
            const accounts = loadCustomerAccounts();
            const customer = accounts[session.user];
            
            if (customer) {
                appData.currentUser = session.user;
                appData.currentRole = 'customer';
                appData.currentUserProfile = customer;
                
                // Load user's saved cart
                loadUserCart();
                
                // Auto-login
                initializeData();
                document.getElementById('loginPage').style.display = 'none';
                document.getElementById('customerPage').style.display = 'block';
                document.getElementById('adminPage').style.display = 'none';
                document.getElementById('productsSection').style.display = 'block';
                document.getElementById('cartSection').style.display = 'none';
                document.getElementById('ordersSection').style.display = 'none';
                document.getElementById('notificationsSection').style.display = 'none';
                document.getElementById('checkoutSection').style.display = 'none';
                
                // Display customer name in navbar
                const displayName = appData.currentUserProfile ? appData.currentUserProfile.fullName : appData.currentUser;
                document.getElementById('customerDisplayName').textContent = `Welcome, ${displayName}!`;
                
                loadProducts();
                setTimeout(() => {
                    updateNotificationBadges();
                }, 150);
                
                console.log('✓ Customer session restored for:', session.user);
            }
        } else if (session.role === 'admin') {
            // Verify admin credentials
            if (session.user === appData.adminCredentials.username) {
                appData.currentUser = session.user;
                appData.currentRole = 'admin';
                appData.currentUserProfile = null;
                
                // Auto-login
                initializeData();
                document.getElementById('loginPage').style.display = 'none';
                document.getElementById('customerPage').style.display = 'none';
                document.getElementById('adminPage').style.display = 'block';
                showAdminTab(localStorage.getItem('kingpinAdminTab') || 'products');
                loadAdminOrders();
                
                setTimeout(() => {
                    updateNotificationBadges();
                }, 150);
                
                console.log('✓ Admin session restored');
            }
        }
    } catch (e) {
        console.error('Error checking saved session:', e);
        clearCurrentSession();
    }
}

// Initialize all data from localStorage on page load
function initializeData() {
    loadOrders();
    loadNotifications();
    loadProductsFromStorage();
    loadCustomers();
    loadShopLogo();
    loadGCashQRCode();
}

// Load products from localStorage
function fetchSharedProducts() {
    if (sharedProductsRequest) return sharedProductsRequest;

    const isLocalServer = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const endpoints = isLocalServer
        ? ['api/products.php', 'api/products']
        : ['api/products', '/.netlify/functions/products', 'api/products.php'];

    sharedProductsRequest = (async () => {
        let lastError = new Error('Product API is not available on this host');

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { cache: 'no-store' });
                const contentType = response.headers.get('content-type') || '';
                if (!response.ok || !contentType.includes('application/json')) {
                    lastError = new Error(`Product API returned ${response.status}`);
                    continue;
                }

                const data = await response.json();
                if (Array.isArray(data.products)) return data.products;
                lastError = new Error('Product API returned invalid product data');
            } catch (error) {
                lastError = error;
            }
        }

        const staticResponse = await fetch('uploads/products.json', { cache: 'no-store' });
        if (!staticResponse.ok) throw lastError;

        const data = await staticResponse.json();
        if (!Array.isArray(data.products)) throw lastError;
        return data.products;
    })().catch(error => {
        sharedProductsRequest = null;
        throw error;
    });

    return sharedProductsRequest;
}

function loadProductsFromStorage() {
    const stored = localStorage.getItem('kingpinProducts');
    if (stored) {
        try {
            appData.products = JSON.parse(stored);
            if (Array.isArray(appData.products)) {
                displayProducts(appData.products);
            }
        } catch (e) {
            console.error('Error loading products:', e);
        }
    }

    return fetchSharedProducts()
        .then(products => {
            appData.products = products;
            localStorage.setItem('kingpinProducts', JSON.stringify(appData.products));
            displayProducts(appData.products);
            if (appData.currentRole === 'admin') {
                loadAdminInventoryProducts();
            }
        })
        .catch(error => {
            console.warn('Unable to load products from server; using local copy.', error);
            if (Array.isArray(appData.products) && appData.products.length > 0) {
                displayProducts(appData.products);
            }
            return appData.products;
        });
}

// Save shop logo and name to localStorage
function saveShopLogo() {
    localStorage.setItem('kingpinShopLogo', appData.shopLogo || '');
    localStorage.setItem('kingpinShopName', appData.shopName);
    console.log('Shop logo saved to localStorage');
}

// Load shop logo from localStorage
function loadShopLogo() {
    const logo = localStorage.getItem('kingpinShopLogo');
    const name = localStorage.getItem('kingpinShopName');
    if (logo) appData.shopLogo = logo;
    if (name) appData.shopName = name;
    console.log('Shop logo loaded from storage:', appData.shopLogo ? 'Yes' : 'No');
    updateShopLogoDisplay();
    updateLoginLogo();
}

// Update login page logo display
function updateLoginLogo() {
    const loginLogo = document.getElementById('loginLogo');
    const loginShopName = document.getElementById('loginShopName');
    
    if (loginLogo && loginShopName) {
        if (appData.shopLogo) {
            // Show logo, hide text
            loginLogo.src = appData.shopLogo;
            loginLogo.classList.add('active');
            loginShopName.classList.add('hidden');
        } else {
            // Hide logo, show text
            loginLogo.classList.remove('active');
            loginShopName.classList.remove('hidden');
            if (appData.shopName) {
                loginShopName.textContent = appData.shopName;
            } else {
                loginShopName.textContent = 'KingPin Custom Ph® CamSur';
            }
        }
    }
}

// Update shop logo display in navbar
function updateShopLogoDisplay() {
    const customerNavbarLogo = document.getElementById('customerNavbarLogo');
    const adminNavbarLogo = document.getElementById('adminNavbarLogo');
    
    // Update customer navbar emblem
    if (customerNavbarLogo) {
        if (appData.shopLogo) {
            customerNavbarLogo.src = appData.shopLogo;
            customerNavbarLogo.classList.add('active');
        } else {
            customerNavbarLogo.classList.remove('active');
        }
    }
    
    // Update admin navbar emblem
    if (adminNavbarLogo) {
        if (appData.shopLogo) {
            adminNavbarLogo.src = appData.shopLogo;
            adminNavbarLogo.classList.add('active');
        } else {
            adminNavbarLogo.classList.remove('active');
        }
    }
}

// ===== AUTHENTICATION =====

// Save customers to localStorage
function saveCustomers() {
    localStorage.setItem('kingpinCustomers', JSON.stringify(appData.customers));
}

// Load customers from localStorage
function loadCustomers() {
    const stored = localStorage.getItem('kingpinCustomers');
    if (stored) {
        try {
            appData.customers = JSON.parse(stored);
        } catch (e) {
            console.error('Error loading customers:', e);
            appData.customers = [];
        }
    }
}

// Show Customer Auth Section
function showCustomerAuth() {
    document.getElementById('customerAuthSection').style.display = 'block';
    document.getElementById('customerLoginForm').style.display = 'block';
    document.getElementById('customerSignupForm').style.display = 'none';
    document.getElementById('adminLoginForm').style.display = 'none';
    document.querySelectorAll('.auth-option').forEach(button => button.classList.remove('active'));
    document.querySelector('.auth-option:first-child')?.classList.add('active');
    updateQuickLoginButton();
    document.getElementById('customerLoginEmail').focus();
}

// Hide Customer Auth Section
function hideCustomerAuth() {
    document.getElementById('customerAuthSection').style.display = 'none';
    document.getElementById('customerLoginForm').style.display = 'block';
    document.getElementById('customerSignupForm').style.display = 'none';
    document.getElementById('customerLoginFormElement').reset();
    document.getElementById('customerSignupFormElement').reset();
    document.getElementById('customerLoginErrorMessage').textContent = '';
    document.getElementById('customerSignupErrorMessage').textContent = '';
}

// Show Customer Login Form
function showCustomerLogin() {
    document.getElementById('customerLoginForm').style.display = 'block';
    document.getElementById('customerSignupForm').style.display = 'none';
    document.getElementById('customerLoginErrorMessage').textContent = '';
    document.getElementById('customerLoginEmail').focus();
}

// Show Customer Signup Form
function showCustomerSignup() {
    document.getElementById('customerLoginForm').style.display = 'none';
    document.getElementById('customerSignupForm').style.display = 'block';
    document.getElementById('customerSignupErrorMessage').textContent = '';
    document.getElementById('customerSignupName').focus();
}

// Register new customer
// Customer accounts storage
function loadCustomerAccounts() {
    const stored = localStorage.getItem('kingpinCustomerAccounts');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Error loading customer accounts:', e);
            return {};
        }
    }
    return {};
}

function saveCustomerAccounts(accounts) {
    localStorage.setItem('kingpinCustomerAccounts', JSON.stringify(accounts));
}

// Save current session
function saveCurrentSession() {
    const session = {
        user: appData.currentUser,
        role: appData.currentRole,
        userProfile: appData.currentUserProfile,
        savedAt: Date.now()
    };
    localStorage.setItem('kingpinCurrentSession', JSON.stringify(session));
}

function rememberQuickLogin() {
    if (appData.currentRole === 'customer' && appData.currentUser) {
        localStorage.setItem('kingpinQuickLoginUser', appData.currentUser);
    }
}

function updateQuickLoginButton() {
    const button = document.getElementById('quickLoginBtn');
    if (!button) return;

    const email = localStorage.getItem('kingpinQuickLoginUser');
    const accounts = loadCustomerAccounts();
    const account = email ? accounts[email] : null;

    if (account) {
        button.textContent = `Quick Login as ${account.fullName || email}`;
        button.style.display = 'block';
    } else {
        localStorage.removeItem('kingpinQuickLoginUser');
        button.style.display = 'none';
    }
}

function quickLogin() {
    const email = localStorage.getItem('kingpinQuickLoginUser');
    const accounts = loadCustomerAccounts();
    const account = email ? accounts[email] : null;

    if (!account) {
        updateQuickLoginButton();
        return;
    }

    appData.currentUser = email;
    appData.currentRole = 'customer';
    appData.currentUserProfile = account;
    rememberQuickLogin();
    saveCurrentSession();
    loadUserCart();
    hideCustomerAuth();
    showCustomerDashboard();
}

// Load current session
function loadCurrentSession() {
    const stored = localStorage.getItem('kingpinCurrentSession');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Error loading session:', e);
            return null;
        }
    }
    return null;
}

// Clear current session
function clearCurrentSession() {
    localStorage.removeItem('kingpinCurrentSession');
}

// Sign up customer
function signupCustomer(e) {
    e.preventDefault();
    
    const username = document.getElementById('customerSignupUsername').value.trim();
    const fullName = document.getElementById('customerSignupName').value.trim();
    const email = document.getElementById('customerSignupEmail').value.trim().toLowerCase();
    const phone = document.getElementById('customerSignupPhone').value.trim();
    const password = document.getElementById('customerSignupPassword').value;
    const errorMessage = document.getElementById('customerSignupErrorMessage');
    
    // Validate inputs
    if (!username || !fullName || !email || !password) {
        errorMessage.textContent = 'Username, name, email, and password are required.';
        return;
    }

    if (!email.includes('@')) {
        errorMessage.textContent = 'Please enter a valid email address.';
        return;
    }

    if (password.length < 6) {
        errorMessage.textContent = 'Password must be at least 6 characters.';
        return;
    }
    
    // Load existing accounts
    const accounts = loadCustomerAccounts();
    
    // Check if email already exists
    if (accounts[email]) {
        document.getElementById('customerSignupErrorMessage').textContent = 'This email is already registered. Please login instead.';
        return;
    }
    
    // Create new account
    const newAccount = {
        username: username,
        email: email,
        fullName: fullName,
        phone: phone,
        password: password,
        createdAt: new Date().toLocaleDateString()
    };
    
    accounts[email] = newAccount;
    saveCustomerAccounts(accounts);
    
    // Auto login
    appData.currentUser = email;
    appData.currentRole = 'customer';
    appData.currentUserProfile = newAccount;
    rememberQuickLogin();
    
    // Save session
    saveCurrentSession();
    
    // Initialize empty cart
    appData.cart = [];
    saveUserCart();
    
    // Clear form and hide auth
    document.getElementById('customerSignupFormElement').reset();
    document.getElementById('customerSignupErrorMessage').textContent = '';
    hideCustomerAuth();
    showCustomerDashboard();
}

// Login customer
function loginCustomer(e) {
    e.preventDefault();
    
    const email = document.getElementById('customerLoginEmail').value.trim().toLowerCase();
    const password = document.getElementById('customerLoginPassword').value;
    
    if (!email) {
        document.getElementById('customerLoginErrorMessage').textContent = 'Please enter your email or use Gmail login';
        return;
    }
    
    // Validate email format
    if (!email.includes('@')) {
        document.getElementById('customerLoginErrorMessage').textContent = 'Please enter a valid email address';
        return;
    }
    
    // Load accounts
    const accounts = loadCustomerAccounts();
    
    // Check if account exists
    if (!accounts[email]) {
        document.getElementById('customerLoginErrorMessage').textContent = 'Account not found. Please create an account first.';
        return;
    }

    if (accounts[email].password && accounts[email].password !== password) {
        document.getElementById('customerLoginErrorMessage').textContent = 'Incorrect password.';
        return;
    }
    
    // Login successful
    appData.currentUser = email;
    appData.currentRole = 'customer';
    appData.currentUserProfile = accounts[email];
    rememberQuickLogin();
    
    // Save session
    saveCurrentSession();
    
    // Load user's saved cart from localStorage
    loadUserCart();
    
    document.getElementById('customerLoginFormElement').reset();
    document.getElementById('customerLoginErrorMessage').textContent = '';
    hideCustomerAuth();
    showCustomerDashboard();
}

// Simple Google Sign-In Handler (Fallback)
function loginWithGmail() {
    // Show Gmail login modal
    const gmailEmail = prompt('Enter your Gmail address (example: yourname@gmail.com):', '') || '';
    
    if (!gmailEmail.trim()) {
        return;
    }
    
    processGmailLogin(gmailEmail);
}

// Process Gmail Login
function processGmailLogin(email) {
    const emailLower = email.toLowerCase().trim();
    
    // Validate email format
    if (!emailLower.includes('@')) {
        showStatusUpdateToast('❌ Please enter a valid email address');
        return;
    }
    
    // Load accounts
    const accounts = loadCustomerAccounts();
    
    // Extract name from email
    const nameFromEmail = emailLower.split('@')[0].replace(/[._]/g, ' ');
    const fullName = nameFromEmail.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    
    // Check if account exists
    if (accounts[emailLower]) {
        // Login existing account
        appData.currentUser = emailLower;
        appData.currentRole = 'customer';
        appData.currentUserProfile = accounts[emailLower];
        rememberQuickLogin();
        
        saveCurrentSession();
        loadUserCart();
        
        document.getElementById('customerLoginFormElement').reset();
        document.getElementById('customerLoginErrorMessage').textContent = '';
        hideCustomerAuth();
        showCustomerDashboard();
        
        showStatusUpdateToast(`✓ Welcome back, ${accounts[emailLower].fullName}!`);
    } else {
        // Create new account
        const newAccount = {
            email: emailLower,
            fullName: fullName,
            phone: '',
            loginMethod: 'gmail',
            createdAt: new Date().toLocaleDateString()
        };
        
        accounts[emailLower] = newAccount;
        saveCustomerAccounts(accounts);
        
        appData.currentUser = emailLower;
        appData.currentRole = 'customer';
        appData.currentUserProfile = newAccount;
        rememberQuickLogin();
        
        saveCurrentSession();
        appData.cart = [];
        saveUserCart();
        
        document.getElementById('customerLoginFormElement').reset();
        document.getElementById('customerLoginErrorMessage').textContent = '';
        hideCustomerAuth();
        showCustomerDashboard();
        
        showStatusUpdateToast(`✓ Account created and logged in as ${fullName}!`);
    }
}

// Show admin login form
function showAdminLogin() {
    document.getElementById('adminLoginForm').style.display = 'block';
    document.getElementById('customerAuthSection').style.display = 'none';
    document.querySelectorAll('.auth-option').forEach(button => button.classList.remove('active'));
    document.querySelector('.auth-option:last-child')?.classList.add('active');
    document.getElementById('adminUsername').focus();
}

// Hide admin login form
function hideAdminLogin() {
    document.getElementById('adminLoginForm').style.display = 'none';
    document.getElementById('adminForm').reset();
    document.getElementById('adminErrorMessage').style.display = 'none';
}

// Admin login
function loginAdmin(e) {
    e.preventDefault();

    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    const errorMessage = document.getElementById('adminErrorMessage');

    if (username !== appData.adminCredentials.username || password !== appData.adminCredentials.password) {
        errorMessage.textContent = 'Incorrect admin username or password.';
        errorMessage.style.display = 'block';
        return;
    }

    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
    appData.currentUser = 'admin';
    appData.currentRole = 'admin';
    appData.currentUserProfile = null;
    
    // Save session
    saveCurrentSession();
    
    document.getElementById('adminForm').reset();
    hideAdminLogin();
    showAdminDashboard();
}

function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    button.textContent = isPassword ? '○' : '◉';
}

function forgotPassword() {
    const email = document.getElementById('customerLoginEmail').value.trim();
    const message = email ? `Password reset instructions would be sent to ${email}.` : 'Enter your email first, then select Forgot password.';
    showStatusUpdateToast(message);
}

function logout() {
    closeCustomerNavMenu();

    // Clear all session data before switching the UI
    clearCurrentSession();
    localStorage.removeItem('kingpinSession');
    localStorage.removeItem('kingpinCurrentSession');
    localStorage.removeItem('kingpinForceLogin');

    // Save cart before logging out
    if (appData.currentUser) {
        saveUserCart();
    }

    appData.currentUser = null;
    appData.currentRole = null;
    appData.currentUserProfile = null;
    updateQuickLoginButton();
    appData.cart = [];

    const loginPage = document.getElementById('loginPage');
    const customerPage = document.getElementById('customerPage');
    const adminPage = document.getElementById('adminPage');
    if (loginPage) loginPage.style.display = 'block';
    if (customerPage) customerPage.style.display = 'none';
    if (adminPage) adminPage.style.display = 'none';
    updateFloatingBackButton();

    if (document.getElementById('customerLoginFormElement')) {
        document.getElementById('customerLoginFormElement').reset();
    }

    if (typeof showCustomerAuth === 'function') {
        showCustomerAuth();
    }
}

// Update Admin Credentials
function updateAdminCredentials(e) {
    e.preventDefault();
    
    const currentPass = document.getElementById('currentPassword').value;
    const newUsername = document.getElementById('newUsername').value || appData.adminCredentials.username;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const message = document.getElementById('credentialsMessage');

    // Verify current password
    if (currentPass !== appData.adminCredentials.password) {
        message.className = 'message error';
        message.textContent = '❌ Current password is incorrect';
        message.style.display = 'block';
        return;
    }

    // Validate new password
    if (newPassword.length < 6) {
        message.className = 'message error';
        message.textContent = '❌ Password must be at least 6 characters';
        message.style.display = 'block';
        return;
    }

    if (newPassword !== confirmPassword) {
        message.className = 'message error';
        message.textContent = '❌ Passwords do not match';
        message.style.display = 'block';
        return;
    }

    // Update credentials
    appData.adminCredentials.username = newUsername;
    appData.adminCredentials.password = newPassword;

    message.className = 'message success';
    message.textContent = '✓ Admin credentials updated successfully! You will need to log in again.';
    message.style.display = 'block';

    // Reset form
    document.getElementById('credentialsForm').reset();

    // Log out after 2 seconds
    setTimeout(() => {
        logout();
    }, 2000);
}

// Upload Shop Logo
function uploadShopLogo(e) {
    e.preventDefault();
    
    const logoFile = document.getElementById('shopLogoFile').files[0];
    const logoName = document.getElementById('shopLogoName').value.trim();
    const message = document.getElementById('logoMessage');
    
    if (!logoFile) {
        message.className = 'message error';
        message.textContent = '❌ Please select a logo image';
        message.style.display = 'block';
        return;
    }
    
    if (!logoName) {
        message.className = 'message error';
        message.textContent = '❌ Please enter shop name';
        message.style.display = 'block';
        return;
    }
    
    // Convert image to base64
    const reader = new FileReader();
    reader.onload = function(e) {
        appData.shopLogo = e.target.result;
        appData.shopName = logoName;
        saveShopLogo();
        updateShopLogoDisplay();
        updateLoginLogo();
        
        message.className = 'message success';
        message.textContent = '✓ Shop logo updated successfully!';
        message.style.display = 'block';
        
        // Reset form
        document.getElementById('logoUploadForm').reset();
        
        // Hide message after 3 seconds
        setTimeout(() => {
            message.style.display = 'none';
        }, 3000);
    };
    
    reader.onerror = function(e) {
        message.className = 'message error';
        message.textContent = '❌ Error reading file. Please try again.';
        message.style.display = 'block';
    };
    
    reader.readAsDataURL(logoFile);
}

// Upload GCash QR Code
function uploadGCashQRCode(e) {
    e.preventDefault();
    
    const qrFile = document.getElementById('adminGCashQRCode').files[0];
    const message = document.getElementById('gcashQRMessage');
    
    if (!qrFile) {
        message.className = 'message error';
        message.textContent = '❌ Please select a QR code image';
        message.style.display = 'block';
        return;
    }

    if (qrFile.size > 3 * 1024 * 1024) {
        message.className = 'message error';
        message.textContent = '❌ QR image must be smaller than 3MB.';
        message.style.display = 'block';
        return;
    }
    
    // Convert image to base64
    const reader = new FileReader();
    reader.onload = async function(e) {
        appData.gcashQRCode = e.target.result;
        saveGCashQRCode();
        const sharedSaved = await saveSharedGcashQRCode();
        window.dispatchEvent(new CustomEvent('kingpin-gcash-qr-updated'));
        displayGCashQRPreview();
        
        message.className = 'message success';
        message.textContent = sharedSaved
            ? '✓ GCash QR Code updated successfully! It will be shown to all customers on their orders.'
            : '✓ GCash QR Code saved on this device. Start the server to share it with customers on other devices.';
        message.style.display = 'block';
        
        // Reset form
        document.getElementById('gcashQRForm').reset();
        
        // Hide message after 3 seconds
        setTimeout(() => {
            message.style.display = 'none';
        }, 3000);
    };
    
    reader.onerror = function(e) {
        message.className = 'message error';
        message.textContent = '❌ Error reading file. Please try again.';
        message.style.display = 'block';
    };
    
    reader.readAsDataURL(qrFile);
}

// Display GCash QR Code preview in settings
function displayGCashQRPreview() {
    if (appData.gcashQRCode) {
        const previewContainer = document.getElementById('gcashQRPreviewContainer');
        const previewImg = document.getElementById('adminGCashQRPreview');
        previewImg.src = appData.gcashQRCode;
        previewContainer.style.display = 'block';
    }
}

function setLogoPreviewDevice(device) {
    const frame = document.getElementById('logoPreviewFrame');
    const buttons = document.querySelectorAll('.preview-device-btn');
    if (!frame) return;

    frame.classList.toggle('preview-phone', device === 'phone');
    frame.classList.toggle('preview-computer', device !== 'phone');
    buttons.forEach(button => {
        button.classList.toggle('active', button.dataset.previewDevice === device);
    });
}

// Save GCash QR Code to localStorage
function saveGCashQRCode() {
    localStorage.setItem('kingpinGCashQR', appData.gcashQRCode);
}

async function saveSharedGcashQRCode() {
    try {
        const payload = JSON.stringify({ gcashQRCode: appData.gcashQRCode });
        for (const endpoint of ['api/gcash-qr.php', 'api/gcash-qr']) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                });
                if (!response.ok) continue;
                const result = await response.json();
                if (result.ok === true) return true;
            } catch (error) {
                continue;
            }
        }
        return false;
    } catch (error) {
        console.warn('Unable to save shared GCash QR code:', error);
        return false;
    }
}

// Load GCash QR Code from localStorage
function loadGCashQRCode() {
    const stored = localStorage.getItem('kingpinGCashQR');
    if (stored) {
        appData.gcashQRCode = stored;
        displayGCashQRPreview();
    }
}

// Display Store's GCash QR Code in Checkout
function displayStoreGcashQRCode() {
    const storeQRImage = document.getElementById('storeGcashQRImage');
    const noQRMessage = document.getElementById('noStoreQRMessage');
    const storeQRLink = document.getElementById('storeGcashQRLink');
    const storedQRCode = localStorage.getItem('kingpinGCashQR');

    if (storedQRCode) {
        appData.gcashQRCode = storedQRCode;
    }
    
    if (storeQRImage && noQRMessage && appData.gcashQRCode) {
        storeQRImage.src = appData.gcashQRCode;
        storeQRImage.style.display = 'block';
        if (storeQRLink) {
            storeQRLink.href = appData.gcashQRCode;
            storeQRLink.style.display = 'inline-block';
        }
        noQRMessage.style.display = 'none';
    } else {
        if (storeQRImage) storeQRImage.style.display = 'none';
        if (storeQRLink) storeQRLink.style.display = 'none';
        if (noQRMessage) noQRMessage.style.display = 'block';
    }
}

// Setup GCash Payment Proof Preview
function setupGcashPaymentPreview() {
    const fileInput = document.getElementById('customerGcashQRCode');
    const previewContainer = document.getElementById('gcashPreviewContainer');
    const previewImage = document.getElementById('gcashPreviewImage');
    
    // Remove any previous listener
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);
    
    newFileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            // Validate file type
            const validImageTypes = ['image/jpeg', 'image/jpg', 'image/jfif', 'image/png', 'image/gif', 'image/webp'];
            const validImageExtension = /\.(jpe?g|jfif|png|gif|webp)$/i.test(file.name);
            if (!validImageTypes.includes(file.type) && !validImageExtension) {
                alert('Please upload a valid image file (JPG, JFIF, PNG, GIF, or WEBP)');
                this.value = '';
                previewContainer.style.display = 'none';
                return;
            }
            
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                alert('File size must be less than 5MB');
                this.value = '';
                previewContainer.style.display = 'none';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(event) {
                previewImage.src = event.target.result;
                previewContainer.style.display = 'block';
                
                // Clear any error messages
                const messageDiv = document.getElementById('gcashPaymentMessage');
                messageDiv.style.display = 'none';
            };
            reader.readAsDataURL(file);
        } else {
            previewContainer.style.display = 'none';
        }
    });
}

function updatePaymentMethodUI() {
    const paymentMethod = document.getElementById('paymentMethod');
    const proofInput = document.getElementById('customerGcashQRCode');
    const instruction = document.getElementById('gcashPaymentInstruction');
    const qrContainer = document.getElementById('storeGcashQRContainer');
    const proofContainer = proofInput ? proofInput.closest('.form-group') : null;
    const isGcash = !paymentMethod || paymentMethod.value === 'gcash';

    if (proofInput) proofInput.required = isGcash;
    if (instruction) instruction.style.display = isGcash ? 'block' : 'none';
    if (qrContainer) qrContainer.parentElement.style.display = isGcash ? 'block' : 'none';
    if (proofContainer) proofContainer.style.display = isGcash ? 'block' : 'none';
    if (isGcash) {
        displayStoreGcashQRCode();
    } else {
        const previewContainer = document.getElementById('gcashPreviewContainer');
        if (previewContainer) previewContainer.style.display = 'none';
    }
}

// ===== NAVIGATION FUNCTIONS =====

function showCustomerDashboard() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('customerPage').style.display = 'block';
    document.getElementById('adminPage').style.display = 'none';
    document.getElementById('productsSection').style.display = 'block';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';

    const cachedProducts = localStorage.getItem('kingpinProducts');
    if (cachedProducts) {
        try {
            const products = JSON.parse(cachedProducts);
            if (Array.isArray(products) && products.length > 0) {
                appData.products = products;
                displayProducts(products);
            }
        } catch (error) {
            console.warn('Unable to render cached products after customer login:', error);
        }
    }

    try {
        initializeData();
    } catch (error) {
        console.error('Customer dashboard data initialization failed:', error);
    }
    
    // Display customer name in navbar
    const displayName = appData.currentUserProfile ? appData.currentUserProfile.fullName : appData.currentUser;
    document.getElementById('customerDisplayName').textContent = `Welcome, ${displayName}!`;
    
    // Update logo display
    updateShopLogoDisplay();
    
    loadProducts();
    updateFloatingBackButton();
    
    // Update badges after UI is shown
    setTimeout(() => {
        updateNotificationBadges();
    }, 150);
}

async function showAdminDashboard() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('customerPage').style.display = 'none';
    document.getElementById('adminPage').style.display = 'block';

    try {
        initializeData();
    } catch (error) {
        console.error('Admin dashboard data initialization failed:', error);
    }

    await loadProductsFromStorage();
    showAdminTab('products');
    loadAdminOrders();
    updateFloatingBackButton();
    
    // Update logo display
    updateShopLogoDisplay();
    
    // Update badges after UI is shown
    setTimeout(() => {
        updateNotificationBadges();
    }, 150);
}

function showAdminTab(tabName) {
    localStorage.setItem('kingpinAdminTab', tabName);
    document.getElementById('productsTab').style.display = tabName === 'products' ? 'block' : 'none';
    document.getElementById('ordersTab').style.display = tabName === 'orders' ? 'block' : 'none';
    document.getElementById('messagesTab').style.display = tabName === 'messages' ? 'block' : 'none';
    document.getElementById('historyTab').style.display = tabName === 'history' ? 'block' : 'none';
    document.getElementById('reportsTab').style.display = tabName === 'reports' ? 'block' : 'none';
    document.getElementById('settingsTab').style.display = tabName === 'settings' ? 'block' : 'none';
    
    // Load data when tabs are clicked
    if (tabName === 'products') {
        console.log('Loading products tab. Current appData.products:', appData.products);
        loadAdminInventoryProducts();
    } else if (tabName === 'orders') {
        loadNotifications();
        loadAdminOrders();
    } else if (tabName === 'messages') {
        loadAdminMessages();
    } else if (tabName === 'reports') {
        generateReports();
    }
}

function loadAdminMessages() {
    const messageList = document.getElementById('adminMessagesList');
    if (!messageList) return;

    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    messageList.innerHTML = '';

    if (serviceMessages.length === 0) {
        messageList.innerHTML = '<p style="text-align: center; padding: 40px; color: #a0a0a0;">No customer messages</p>';
        return;
    }

    serviceMessages.slice().reverse().forEach(serviceMessage => {
        const messageItem = document.createElement('div');
        messageItem.className = `admin-message-item ${serviceMessage.read ? 'read' : 'unread'}`;
        messageItem.innerHTML = `
            <div class="admin-message-item-top"><strong>${serviceMessage.customerName || serviceMessage.customerUsername || 'Unknown customer'}</strong><span>${serviceMessage.date || ''}</span></div>
            <div class="admin-message-subject">${serviceMessage.subject || 'Customer concern'}</div>
            <div class="admin-message-preview">${serviceMessage.message || ''}</div>
        `;
        messageItem.onclick = () => selectAdminMessage(serviceMessage.id);
        messageList.appendChild(messageItem);
    });
}

function selectAdminMessage(messageId) {
    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    const message = serviceMessages.find(serviceMessage => serviceMessage.id === messageId);
    if (!message) return;

    markCustomerMessageAsRead(messageId);
    const details = document.getElementById('adminMessageDetails');
    details.innerHTML = `
        <div class="admin-message-details-header">
            <div>
                <h3>${message.subject || 'Customer concern'}</h3>
                <p>From ${message.customerName || message.customerUsername || 'Unknown customer'}</p>
            </div>
            <span class="message-status">${message.status || 'open'}</span>
        </div>
        <div class="admin-message-meta">
            <span>${message.customerEmail || 'No email'}</span>
            <span>${message.orderId ? `Order #${message.orderId}` : 'General concern'}</span>
            <span>${message.date || ''}</span>
        </div>
        <div class="admin-message-body">${message.message || ''}</div>
        <div class="admin-message-replies">${(message.replies || []).map(reply => `
            <div class="admin-message-reply">
                <strong>${reply.sender === 'admin' ? 'You' : (message.customerName || 'Customer')}</strong>
                <span>${reply.date || ''}</span>
                <p>${reply.message || ''}</p>
            </div>
        `).join('')}</div>
        <button type="button" class="btn btn-primary" onclick="toggleAdminReplyBox()">Reply</button>
        <div id="adminReplyBox" class="admin-reply-box" style="display: none;">
            <textarea id="adminReplyInput" rows="4" placeholder="Write a reply to the customer..."></textarea>
            <button type="button" class="btn btn-primary" onclick="sendAdminMessageReply(${message.id})">Send Reply</button>
        </div>
    `;
}

function toggleAdminReplyBox() {
    const replyBox = document.getElementById('adminReplyBox');
    if (!replyBox) return;
    replyBox.style.display = replyBox.style.display === 'none' ? 'block' : 'none';
    if (replyBox.style.display === 'block') document.getElementById('adminReplyInput').focus();
}

function sendAdminMessageReply(messageId) {
    const replyInput = document.getElementById('adminReplyInput');
    const replyText = replyInput ? replyInput.value.trim() : '';
    if (!replyText) return;

    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    const message = serviceMessages.find(serviceMessage => serviceMessage.id === messageId);
    if (!message) return;

    message.replies = message.replies || [];
    message.replies.push({
        sender: 'admin',
        message: replyText,
        date: new Date().toLocaleString()
    });
    message.read = true;
    localStorage.setItem('kingpinCustomerServiceMessages', JSON.stringify(serviceMessages));

    addNotification('customer', `💬 Admin reply to "${message.subject}": ${replyText}`, message.orderId);
    saveNotifications();
    selectAdminMessage(messageId);
}

function markCustomerMessageAsRead(messageId) {
    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    const message = serviceMessages.find(serviceMessage => serviceMessage.id === messageId);
    if (!message) return;

    message.read = true;
    localStorage.setItem('kingpinCustomerServiceMessages', JSON.stringify(serviceMessages));

    const notification = appData.notifications.find(item =>
        item.type === 'admin' && item.orderId === message.orderId && item.message.includes(message.subject)
    );
    if (notification) notification.read = true;
    saveNotifications();
    loadAdminMessages();
    updateNotificationBadges();
}

function toggleCart() {
    const showCart = document.getElementById('cartSection').style.display === 'none';
    document.getElementById('productsSection').style.display = showCart ? 'none' : 'block';
    document.getElementById('cartSection').style.display = showCart ? 'block' : 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    
    if (showCart) {
        updateCartDisplay();
    }
}

function viewOrders() {
    appData.notifications.forEach(notification => {
        if (notification.type === 'customer') {
            notification.read = true;
        }
    });
    saveNotifications();
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'block';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';
    loadCustomerOrders();
    updateNotificationBadges();
    updateFloatingBackButton();
}

function viewPurchaseHistory() {
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'block';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';
    loadPurchaseHistory();
    updateFloatingBackButton();
}

function goBackToShop() {
    document.getElementById('productsSection').style.display = 'block';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'none';
    document.getElementById('customerSettingsSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';
    updateFloatingBackButton();
}

// Manage floating back button visibility
function updateFloatingBackButton() {
    const floatingBtn = document.getElementById('floatingBackButton');
    if (!floatingBtn) return;
    
    const productsVisible = document.getElementById('productsSection')?.style.display !== 'none';
    const isOnLoginPage = document.getElementById('loginPage')?.style.display !== 'none';
    const isLoggedIn = Boolean(appData.currentRole);
    
    // Show floating back button when NOT on products page and NOT on login page
    if (isLoggedIn && !productsVisible && !isOnLoginPage) {
        floatingBtn.style.display = 'block';
    } else {
        floatingBtn.style.display = 'none';
    }
}

function viewCustomerNotifications() {
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'block';
    document.getElementById('customerSettingsSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';
    loadCustomerNotifications();
    updateFloatingBackButton();
}

function viewCustomerService() {
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'none';
    document.getElementById('customerSettingsSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'block';
    updateFloatingBackButton();

    const orderSelect = document.getElementById('serviceOrderId');
    orderSelect.innerHTML = '<option value="">General concern</option>';
    appData.orders
        .filter(order => order.customerUsername === appData.currentUser)
        .sort((firstOrder, secondOrder) => Number(secondOrder.id) - Number(firstOrder.id))
        .forEach(order => {
            orderSelect.insertAdjacentHTML('beforeend', `<option value="${order.id}">Order #${order.id}</option>`);
        });
    document.getElementById('customerServiceStatus').textContent = '';
}

function sendCustomerServiceMessage(event) {
    event.preventDefault();
    const subject = document.getElementById('serviceSubject').value;
    const message = document.getElementById('serviceMessage').value.trim();
    const orderId = document.getElementById('serviceOrderId').value || null;
    if (!subject || !message) return;

    const serviceMessages = JSON.parse(localStorage.getItem('kingpinCustomerServiceMessages') || '[]');
    const serviceMessage = {
        id: Date.now(),
        customerUsername: appData.currentUser,
        customerName: appData.currentUserProfile?.fullName || appData.currentUser,
        customerEmail: appData.currentUserProfile?.email || appData.currentUser,
        orderId,
        subject,
        message,
        status: 'open',
        read: false,
        date: new Date().toLocaleString()
    };
    serviceMessages.push(serviceMessage);
    localStorage.setItem('kingpinCustomerServiceMessages', JSON.stringify(serviceMessages));

    addNotification('admin', `💬 Customer service message: ${subject}${orderId ? ` for order #${orderId}` : ''}`, orderId);
    addNotification('customer', `✓ Your message to Customer Service was sent: ${subject}.`, orderId);
    saveNotifications();

    const status = document.getElementById('customerServiceStatus');
    status.className = 'status-message success';
    status.textContent = 'Message sent to the seller successfully.';
    document.getElementById('customerServiceForm').reset();
}

function viewCustomerSettings() {
    if (appData.currentRole !== 'customer' || !appData.currentUser) return;

    const accounts = loadCustomerAccounts();
    const profile = appData.currentUserProfile || accounts[appData.currentUser] || {};
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'none';
    document.getElementById('customerSettingsSection').style.display = 'block';
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('customerServiceSection').style.display = 'none';
    updateFloatingBackButton();

    document.getElementById('settingsUsername').value = profile.username || appData.currentUser;
    document.getElementById('settingsFullName').value = profile.fullName || '';
    document.getElementById('settingsEmail').value = profile.email || appData.currentUser;
    document.getElementById('settingsPhone').value = profile.phone || '';
    document.getElementById('settingsAddress').value = profile.address || '';
    document.getElementById('customerSettingsMessage').textContent = '';
}

function saveCustomerSettings(e) {
    e.preventDefault();

    if (appData.currentRole !== 'customer' || !appData.currentUser) return;

    const email = appData.currentUser;
    const accounts = loadCustomerAccounts();
    const account = accounts[email] || {};
    const updatedAccount = {
        ...account,
        username: document.getElementById('settingsUsername').value.trim(),
        fullName: document.getElementById('settingsFullName').value.trim(),
        email: document.getElementById('settingsEmail').value.trim().toLowerCase(),
        phone: document.getElementById('settingsPhone').value.trim(),
        address: document.getElementById('settingsAddress').value.trim()
    };
    const message = document.getElementById('customerSettingsMessage');

    if (!updatedAccount.username || !updatedAccount.fullName || !updatedAccount.email || !updatedAccount.phone || !updatedAccount.address) {
        message.className = 'status-message error';
        message.textContent = 'Please complete all account and delivery fields.';
        return;
    }

    if (!updatedAccount.email.includes('@')) {
        message.className = 'status-message error';
        message.textContent = 'Please enter a valid email address.';
        return;
    }

    if (updatedAccount.email !== email && accounts[updatedAccount.email]) {
        message.className = 'status-message error';
        message.textContent = 'That email address is already registered.';
        return;
    }

    delete accounts[email];
    accounts[updatedAccount.email] = updatedAccount;
    saveCustomerAccounts(accounts);

    appData.currentUser = updatedAccount.email;
    appData.currentUserProfile = updatedAccount;
    saveCurrentSession();
    rememberQuickLogin();
    document.getElementById('customerDisplayName').textContent = `Welcome, ${updatedAccount.fullName}!`;

    message.className = 'status-message success';
    message.textContent = 'Account information updated successfully.';
}

function loadCustomerNotifications() {
    const notificationList = document.getElementById('notificationsList');
    notificationList.innerHTML = '';

    const customerNotifications = appData.notifications.filter(n => n.type === 'customer');
    
    if (customerNotifications.length === 0) {
        notificationList.innerHTML = '<p style="text-align: center; padding: 40px; color: #a0a0a0;">No notifications</p>';
        return;
    }

    customerNotifications.forEach(notification => {
        const notifItem = document.createElement('div');
        notifItem.className = 'notification-item ' + (notification.read ? 'read' : 'unread');
        notifItem.innerHTML = `
            <p><strong>${notification.message}</strong></p>
            <p class="notification-timestamp">${notification.timestamp}</p>
        `;
        notifItem.onclick = () => markNotificationAsRead(notification.id);
        notificationList.appendChild(notifItem);
    });
}

function checkout() {
    if (appData.cart.length === 0) {
        alert('Your cart is empty!');
        return;
    }

    const placeOrderButton = document.getElementById('placeCustomerOrderButton');
    if (placeOrderButton) {
        placeOrderButton.disabled = false;
        placeOrderButton.style.opacity = '1';
        placeOrderButton.style.cursor = 'pointer';
    }
    
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'block';
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    
    // Load the shared QR before displaying checkout payment instructions.
    loadSharedGcashQRCode();
    
    // Setup file preview for customer's payment proof
    updatePaymentMethodUI();
    
    // Clear previous messages
    document.getElementById('gcashPaymentMessage').style.display = 'none';
    document.getElementById('gcashPaymentMessage').textContent = '';
    
    updateCheckoutDisplay();
    
    // Scroll to top of checkout
    document.getElementById('checkoutSection').scrollIntoView({ behavior: 'smooth' });
}

// ===== PRODUCT MANAGEMENT =====

function prepareProductImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => {
            const image = new Image();
            image.onload = () => {
                const maxDimension = 1400;
                const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.onerror = () => reject(new Error('Unable to read the selected image'));
            image.src = event.target.result;
        };
        reader.onerror = () => reject(new Error('Unable to read the selected image'));
        reader.readAsDataURL(file);
    });
}

// Save products to localStorage
async function saveProducts() {
    localStorage.setItem('kingpinProducts', JSON.stringify(appData.products));
    console.log('Products saved to localStorage:', appData.products);

    const payload = JSON.stringify({ products: appData.products });
    const endpoints = ['api/products', 'api/products.php', '/.netlify/functions/products'];

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            });
            if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) continue;

            const result = await response.json();
            if (result.ok === true) {
                console.log('Products synced to shared server.');
                return true;
            }
        } catch (error) {
            console.warn(`Unable to sync products through ${endpoint}:`, error);
        }
    }

    throw new Error('Shared product API unavailable');
}

function saveProductsWithoutBlocking() {
    saveProducts().catch(error => {
        console.warn('Unable to sync products to server; local copy was saved.', error);
    });
}

// Load Products for Customer
async function loadProducts() {
    const cachedProducts = Array.isArray(appData.products) ? appData.products : [];
    if (cachedProducts.length > 0) {
        displayProducts(cachedProducts);
    }

    try {
        // The server is shared by all customers, so it is the source of truth.
        appData.products = await fetchSharedProducts();
        localStorage.setItem('kingpinProducts', JSON.stringify(appData.products));
    } catch (error) {
        console.warn('Unable to load shared products; using local copy.', error);

        const stored = localStorage.getItem('kingpinProducts');
        if (stored) {
            try {
                appData.products = JSON.parse(stored);
            } catch (storageError) {
                console.error('Error loading products from localStorage:', storageError);
            }
        }

        if (!Array.isArray(appData.products) || appData.products.length === 0) {
            loadDefaultProducts();
        }
    }

    displayProducts(appData.products);
    setupSearchAndFilter();
}

function loadDefaultProducts() {
    // Sample products - Premium Quality Jerseys
    appData.products = [
            {
                id: 1,
                name: 'Pro Basketball Jersey',
                type: 'basketball',
                price: 1299,
                stock: 25,
                description: 'Premium quality basketball jersey with custom embroidery. Breathable, lightweight, professional finish.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%234472C4" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EBasketball Jersey%3C/text%3E%3C/svg%3E',
                availableColors: ['Red', 'Blue', 'Black', 'White', 'Yellow']
            },
            {
                id: 2,
                name: 'Volleyball Jersey',
                type: 'volleyball',
                price: 1199,
                stock: 20,
                description: 'Official volleyball jersey with high-quality printing. Comfortable fit for athletes.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23E74856" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EVolleyball Jersey%3C/text%3E%3C/svg%3E',
                availableColors: ['Red', 'Blue', 'Black', 'White', 'Yellow', 'Green']
            },
            {
                id: 3,
                name: 'Premium Longsleeve Warmer',
                type: 'longsleeve',
                price: 1599,
                stock: 18,
                description: 'Warm, comfortable longsleeve with custom design. Perfect for training and casual wear.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23222222" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3ELongsleeve Warmer%3C/text%3E%3C/svg%3E',
                availableColors: ['Black', 'Navy', 'Gray', 'Maroon', 'Dark Blue']
            },
            {
                id: 4,
                name: 'Varsity Jacket',
                type: 'varsity',
                price: 2899,
                stock: 12,
                description: 'Premium varsity jacket with embroidered design. High-quality material, professional appearance.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23654321" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EVarsity Jacket%3C/text%3E%3C/svg%3E',
                availableColors: ['Black', 'Navy', 'Maroon', 'Gold']
            },
            {
                id: 5,
                name: 'Rider Jersey',
                type: 'rider',
                price: 1399,
                stock: 16,
                description: 'Specialized rider jersey with ergonomic design. Comfortable for cycling and motor sports.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23FF9500" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3ERider Jersey%3C/text%3E%3C/svg%3E',
                availableColors: ['Red', 'Blue', 'Orange', 'Yellow', 'Black']
            },
            {
                id: 6,
                name: 'Premium T-Shirt',
                type: 'tshirt',
                price: 599,
                stock: 40,
                description: 'Quality cotton t-shirt with custom printing. Perfect for individual or corporate branding.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23009688" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3ET-Shirt%3C/text%3E%3C/svg%3E',
                availableColors: ['Red', 'Blue', 'Black', 'White', 'Yellow', 'Green', 'Purple', 'Gray']
            },
            {
                id: 7,
                name: 'Premium Polo Shirt',
                type: 'polo',
                price: 899,
                stock: 32,
                description: 'Professional polo shirt with embroidered logo. Ideal for corporate and casual wear.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%231976D2" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EPolo Shirt%3C/text%3E%3C/svg%3E',
                availableColors: ['Blue', 'White', 'Black', 'Navy', 'Maroon', 'Gray']
            },
            {
                id: 8,
                name: 'Club Uniform Jersey',
                type: 'club',
                price: 1499,
                stock: 24,
                description: 'Complete club uniform with matching numbers and emblem. Professional quality.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23512DA8" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EClub Uniform%3C/text%3E%3C/svg%3E',
                availableColors: ['Purple', 'Blue', 'Black', 'Navy', 'Gold']
            },
            {
                id: 9,
                name: 'Organization Uniform',
                type: 'organization',
                price: 1599,
                stock: 30,
                description: 'Official organization uniform with custom branding. Premium quality and perfect fit.',
                image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23C41C3B" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle"%3EOrganization Uniform%3C/text%3E%3C/svg%3E',
                availableColors: ['Red', 'White', 'Black', 'Blue', 'Maroon', 'Gold']
            }
        ];
        saveProductsWithoutBlocking();
    }

// Display Products
function displayProducts(products) {
    const productsList = document.getElementById('productsList');
    productsList.innerHTML = '';

    if (products.length === 0) {
        productsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px;">No products found</p>';
        return;
    }

    products.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        productCard.onclick = () => openProductModal(product);
        
        const stockClass = product.stock < 5 ? 'low' : '';
        const stockText = product.stock > 0 ? `Stock: ${product.stock}` : 'Out of Stock';
        const isOutOfStock = product.stock <= 0;

        // Type label mapping
        const typeLabels = {
            'basketball': '🏀 Basketball',
            'volleyball': '🏐 Volleyball',
            'longsleeve': '👕 Longsleeve',
            'varsity': '🎓 Varsity',
            'rider': '🏍️ Rider',
            'tshirt': '👕 T-Shirt',
            'polo': '👔 Polo',
            'club': '⚽ Club',
            'organization': '🏢 Organization'
        };

        productCard.innerHTML = `
            <img src="${product.image}" alt="${product.name}" class="product-image" loading="eager" fetchpriority="high" decoding="async">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p style="color: #4a9eff; font-weight: 600; margin-bottom: 8px;">${typeLabels[product.type] || product.type}</p>
                <p style="color: #a0a0a0; font-size: 0.85em; margin-bottom: 8px;">Premium Quality Jersey</p>
                <div class="product-price">₱${product.price.toFixed(2)}</div>
                <div class="product-stock ${stockClass}">${stockText}</div>
                <button class="btn btn-primary btn-small" ${isOutOfStock ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="openProductModal(${JSON.stringify(product).replace(/"/g, '&quot;')}); event.stopPropagation();">${isOutOfStock ? 'Out of Stock' : 'View Details'}</button>
            </div>
        `;

        productsList.appendChild(productCard);
    });
}

// Open Product Modal
function openProductModal(product) {
    appData.selectedProduct = product;
    document.getElementById('modalProductImage').src = product.image;
    document.getElementById('modalProductName').textContent = product.name;
    
    const typeLabels = {
        'basketball': '🏀 Basketball Jersey',
        'volleyball': '🏐 Volleyball Jersey',
        'longsleeve': '👕 Longsleeve Warmer',
        'varsity': '🎓 Varsity Jacket',
        'rider': '🏍️ Rider Jersey',
        'tshirt': '👕 T-Shirt',
        'polo': '👔 Polo Shirt',
        'club': '⚽ Club Uniform',
        'organization': '🏢 Organization Uniform'
    };
    
    document.getElementById('modalProductCategory').textContent = `Type: ${typeLabels[product.type] || product.type}`;
    document.getElementById('modalProductDescription').textContent = product.description;
    document.getElementById('modalProductPrice').textContent = product.price.toFixed(2);
    
    const stockElement = document.getElementById('modalProductStock');
    const stockClass = product.stock < 5 ? 'low' : '';
    stockElement.className = `stock ${stockClass}`;
    stockElement.textContent = product.stock > 0 ? `Stock Available: ${product.stock}` : 'Out of Stock';
    
    document.getElementById('modalProductQuantity').value = 1;
    document.getElementById('modalProductQuantity').max = product.stock;
    
    const sizeSelect = document.getElementById('customSize');
    const colorSelect = document.getElementById('customColor');
    if (sizeSelect) sizeSelect.value = '';
    if (colorSelect) {
        colorSelect.innerHTML = '<option value="">-- Select Color --</option>';
        const availableColors = product.availableColors || [];
        const allColors = ['Red', 'Blue', 'Black', 'White', 'Yellow', 'Green', 'Orange', 'Purple', 'Gray', 'Navy', 'Maroon', 'Pink', 'Cyan', 'Gold', 'Silver'];

        if (availableColors.length > 0) {
            allColors.forEach(color => {
                if (availableColors.includes(color)) {
                    const option = document.createElement('option');
                    option.value = color;
                    option.textContent = color;
                    colorSelect.appendChild(option);
                }
            });
        } else {
            allColors.forEach(color => {
                const option = document.createElement('option');
                option.value = color;
                option.textContent = color;
                colorSelect.appendChild(option);
            });
        }
    }
    
    // Display ratings
    displayProductRatings(product);
    
    document.getElementById('productModal').style.display = 'block';
}

// Close Product Modal
function closeProductModal() {
    document.getElementById('productModal').style.display = 'none';
    appData.selectedProduct = null;
}

// ===== PRODUCT RATINGS SYSTEM =====

// Load product ratings from localStorage
function loadProductRatings() {
    const stored = localStorage.getItem('kingpinProductRatings');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Error loading ratings:', e);
            return {};
        }
    }
    return {};
}

// Save product ratings to localStorage
function saveProductRatings(ratings) {
    localStorage.setItem('kingpinProductRatings', JSON.stringify(ratings));
}

// Initialize ratings for a product if not exists
function ensureProductRatings(productId) {
    const ratings = loadProductRatings();
    if (!ratings[productId]) {
        ratings[productId] = [];
        saveProductRatings(ratings);
    }
    return ratings[productId];
}

// Calculate average rating for a product
function getAverageRating(productId) {
    const ratings = ensureProductRatings(productId);
    if (ratings.length === 0) return 0;
    const sum = ratings.reduce((acc, r) => acc + r.stars, 0);
    return sum / ratings.length;
}

// Get rating statistics
function getRatingStats(productId) {
    const ratings = ensureProductRatings(productId);
    const average = getAverageRating(productId);
    return {
        average: average,
        count: ratings.length,
        ratings: ratings
    };
}

// Get total quantity sold for a product (from completed or delivered orders)
function getSuccessfulOrdersCount(productId) {
    let totalSold = 0;
    appData.orders.forEach(order => {
        const isCompleted = order.status === 'completed' || order.status === 'delivered';
        if (isCompleted && order.items) {
            order.items.forEach(item => {
                if (Number(item.id) === Number(productId)) {
                    totalSold += Number(item.quantity) || 1;
                }
            });
        }
    });
    return totalSold;
}

// Check if current customer has a completed order for this product
function getCustomerCompletedOrderForProduct(productId) {
    const currentUserEmail = appData.currentUser || '';
    const order = appData.orders.find(order => {
        const userMatches = order.customerUsername === currentUserEmail || order.customerEmail === currentUserEmail;
        const isCompleted = order.status === 'completed' || order.status === 'delivered';
        const hasProduct = order.items && order.items.some(item => Number(item.id) === Number(productId));
        return userMatches && isCompleted && hasProduct;
    });
    return order || null;
}

// Check if customer already reviewed this product from a specific order
function hasCustomerReviewedOrder(orderId) {
    const ratings = loadProductRatings();
    for (const productRatings of Object.values(ratings)) {
        const existing = productRatings.find(r => r.orderId === orderId);
        if (existing) return true;
    }
    return false;
}

// Display ratings in product modal
function displayProductRatings(product) {
    const stats = getRatingStats(product.id);
    const average = stats.average.toFixed(1);
    const successfulOrders = getSuccessfulOrdersCount(product.id);
    const customerOrder = getCustomerCompletedOrderForProduct(product.id);
    const customerAlreadyReviewed = customerOrder ? hasCustomerReviewedOrder(customerOrder.id) : false;
    
    // Display average rating
    const averageStars = '★'.repeat(Math.round(average)) + '☆'.repeat(5 - Math.round(average));
    document.getElementById('averageRatingStars').textContent = averageStars;
    document.getElementById('averageRatingScore').textContent = average;
    document.getElementById('totalRatingsCount').textContent = stats.count;
    
    // Display successful orders count
    const successfulOrdersElement = document.getElementById('successfulOrdersCount');
    if (successfulOrdersElement) {
        successfulOrdersElement.textContent = successfulOrders;
    }

    // Display individual ratings (only from completed orders)
    const ratingsList = document.getElementById('individualRatingsList');
    const completedOrderRatings = stats.ratings.filter(r => r.orderStatus === 'completed' || r.orderStatus === 'delivered');
    
    if (completedOrderRatings.length === 0) {
        ratingsList.innerHTML = '<p style="text-align: center; color: #a0a0a0;">No verified customer reviews yet. Reviews appear after customers receive their orders.</p>';
    } else {
        ratingsList.innerHTML = completedOrderRatings.slice(-5).reverse().map(rating => `
            <div style="padding: 10px; border-bottom: 1px solid #333;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <div style="color: #d4af37; font-size: 14px;">${'★'.repeat(rating.stars)}${'☆'.repeat(5 - rating.stars)}</div>
                    <small style="color: #a0a0a0;">${rating.date}</small>
                </div>
                ${rating.comment ? `<p style="font-size: 13px; color: #e0e0e0; margin: 5px 0;">"${rating.comment}"</p>` : ''}
                <small style="color: #4caf50;">✓ Verified Purchase</small><br>
                <small style="color: #888;">- ${rating.customerName || 'Anonymous'}</small>
            </div>
        `).join('');
    }
    
    // Hide the add rating form - reviews are submitted from My Orders only
    const addRatingForm = document.getElementById('addRatingForm');
    if (addRatingForm) {
        addRatingForm.style.display = 'none';
    }
}

// Update rating star selection UI
function updateRatingStars(rating) {
    const stars = document.querySelectorAll('.rating-star');
    stars.forEach(star => {
        const starRating = parseInt(star.dataset.rating);
        if (starRating <= rating) {
            star.textContent = '★';
            star.style.color = '#d4af37';
        } else {
            star.textContent = '☆';
            star.style.color = '#fff';
        }
    });
}

// Set product rating (star click handler)
function setProductRating(rating) {
    document.getElementById('selectedRating').value = rating;
    updateRatingStars(rating);
}

// Submit product rating
function submitProductRating() {
    if (!appData.selectedProduct) return;
    
    const selectedRating = parseInt(document.getElementById('selectedRating').value);
    if (selectedRating === 0) {
        alert('Please select a rating before submitting.');
        return;
    }
    
    const orderId = parseInt(document.getElementById('customerOrderId').value) || 0;
    if (orderId === 0) {
        alert('No valid order found. Please verify your completed order.');
        return;
    }
    
    // Verify order exists and is completed
    const order = appData.orders.find(o => o.id === orderId);
    if (!order || (order.status !== 'completed' && order.status !== 'delivered')) {
        alert('This order is not marked as completed yet.');
        return;
    }
    
    // Check if already reviewed
    if (hasCustomerReviewedOrder(orderId)) {
        alert('You have already reviewed this product from this order.');
        return;
    }
    
    const comment = document.getElementById('ratingComment').value.trim();
    const customerName = appData.currentUserProfile ? appData.currentUserProfile.fullName : 'Anonymous';
    
    const ratings = loadProductRatings();
    if (!ratings[appData.selectedProduct.id]) {
        ratings[appData.selectedProduct.id] = [];
    }
    
    // Add new rating with order context
    ratings[appData.selectedProduct.id].push({
        stars: selectedRating,
        comment: comment || null,
        customerName: customerName,
        orderId: orderId,
        orderStatus: order.status,
        date: new Date().toLocaleDateString(),
        timestamp: Date.now()
    });
    
    saveProductRatings(ratings);
    
    // Show success message
    showStatusUpdateToast(`✓ Thank you for your review! Your ${selectedRating} star rating has been recorded as a verified purchase.`);
    
    // Refresh ratings display
    displayProductRatings(appData.selectedProduct);
}

// Add to Cart
function addToCart() {
    if (!appData.selectedProduct) return;

    const quantity = parseInt(document.getElementById('modalProductQuantity').value);
    const customName = '';
    const customNumber = '';
    const customSizeElement = document.getElementById('customSize');
    const customColorElement = document.getElementById('customColor');
    const customSize = customSizeElement ? customSizeElement.value.trim() : '';
    const customColor = customColorElement ? customColorElement.value.trim() : '';
    
    // Size and color are selected in the checkout/order step, not in the product popup.
    if (customSizeElement && !customSize) {
        alert('Please select a size');
        return;
    }
    if (customColorElement && !customColor) {
        alert('Please select a color');
        return;
    }
    
    // Check if product is in stock
    if (appData.selectedProduct.stock <= 0) {
        alert('This product is out of stock');
        return;
    }
    
    if (quantity < 1 || quantity > appData.selectedProduct.stock) {
        alert(`Invalid quantity. Available stock: ${appData.selectedProduct.stock}`);
        return;
    }

    // Check if product with same customization already in cart
    const existingItem = appData.cart.find(item => 
        item.id === appData.selectedProduct.id &&
        item.customization.size === customSize &&
        item.customization.color === customColor &&
        item.customization.name === customName &&
        item.customization.number === customNumber
    );
    
    if (existingItem) {
        // Check if adding more would exceed available stock
        const totalRequested = existingItem.quantity + quantity;
        if (totalRequested > appData.selectedProduct.stock) {
            alert(`Cannot add more. Available stock: ${appData.selectedProduct.stock}`);
            return;
        }
        existingItem.quantity += quantity;
    } else {
        appData.cart.push({
            ...appData.selectedProduct,
            quantity: quantity,
            customization: {
                name: customName,
                number: customNumber,
                size: customSize,
                color: customColor
            }
        });
    }

    // Build customization message
    let customMsg = ` (${customSize}, ${customColor})`;
    if (customName || customNumber) {
        customMsg += ' - ';
        if (customName) customMsg += `Name: ${customName}`;
        if (customName && customNumber) customMsg += ', ';
        if (customNumber) customMsg += `#${customNumber}`;
    }

    showStatusUpdateToast(`${appData.selectedProduct.name}${customMsg} added to cart!`);
    closeProductModal();
    updateCartCount();
    saveUserCart();  // Save cart to localStorage
}

// Place Order Directly (from product modal)
function placeOrderDirect() {
    if (!appData.selectedProduct) {
        alert('Please select a product first');
        return;
    }

    const quantity = parseInt(document.getElementById('modalProductQuantity').value);
    const customName = '';
    const customNumber = '';
    const customSizeElement = document.getElementById('customSize');
    const customColorElement = document.getElementById('customColor');
    const customSize = customSizeElement ? customSizeElement.value.trim() : '';
    const customColor = customColorElement ? customColorElement.value.trim() : '';

    if (customSizeElement && !customSize) {
        alert('Please select a size');
        return;
    }
    if (customColorElement && !customColor) {
        alert('Please select a color');
        return;
    }
    
    // Check if product is in stock
    if (appData.selectedProduct.stock <= 0) {
        alert('This product is out of stock');
        return;
    }
    
    if (quantity < 1 || quantity > appData.selectedProduct.stock) {
        alert(`Invalid quantity. Available stock: ${appData.selectedProduct.stock}`);
        return;
    }

    // Add to cart
    appData.cart = [];  // Clear cart for direct order
    appData.cart.push({
        ...appData.selectedProduct,
        quantity: quantity,
        customization: {
            name: customName,
            number: customNumber,
            size: customSize || '',
            color: customColor || ''
        }
    });

    const checkoutSize = document.getElementById('checkoutSize');
    const checkoutColor = document.getElementById('checkoutColor');
    if (checkoutSize && customSize) checkoutSize.value = customSize;
    if (checkoutColor && customColor) checkoutColor.value = customColor;
    if (customSize) fillMeasurementsFromSize(customSize);

    // Close modal
    closeProductModal();
    
    // Update cart display
    updateCartCount();
    updateCartDisplay();
    
    // Open payment checkout directly after the first Place Order click.
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'block';
    loadSharedGcashQRCode();
    updateCheckoutDisplay();
    updatePaymentMethodUI();
}

// Update Cart Count
function updateCartCount() {
    const totalItems = appData.cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cartCount').textContent = totalItems;
}

// Update Cart Display
function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');

    if (appData.cart.length === 0) {
        cartItems.innerHTML = '<div class="empty-cart">Your cart is empty</div>';
        cartTotal.textContent = '0.00';
        return;
    }

    cartItems.innerHTML = '';
    let total = 0;

    appData.cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        // Build customization display
        let customizationHTML = '';
        
        // Handle custom design items
        if (item.type === 'custom-design' && item.details) {
            customizationHTML = '<div class="cart-customization design-details">';
            const details = item.details;
            
            if (item.designType === 'custom') {
                // Custom designed tops or bottoms
                if (details.clothingType === 'top') {
                    customizationHTML += `<span>👕 Type: Custom Top</span>`;
                    customizationHTML += `<span>🎨 Base Color: <strong>${details.baseColor}</strong></span>`;
                    customizationHTML += `<span>Accent: <strong>${details.accentColor}</strong></span>`;
                    customizationHTML += `<span>Fabric: <strong>${details.fabricType}</strong></span>`;
                    customizationHTML += `<span>Size: <strong>${details.size}</strong></span>`;
                    if (details.frontDesign) customizationHTML += `<span>Front Design: <strong>${details.frontDesign.substring(0, 30)}...</strong></span>`;
                } else if (details.clothingType === 'bottoms') {
                    customizationHTML += `<span>👖 Type: Custom Bottoms</span>`;
                    customizationHTML += `<span>🎨 Base Color: <strong>${details.baseColor}</strong></span>`;
                    customizationHTML += `<span>Fabric: <strong>${details.fabricType}</strong></span>`;
                    customizationHTML += `<span>Size: <strong>${details.size}</strong></span>`;
                    customizationHTML += `<span>Side Stripe: <strong>${details.sideStripe}</strong></span>`;
                }
            } else if (item.designType === 'preset') {
                // Preset design
                customizationHTML += `<span>📋 Template: <strong>${details.name}</strong></span>`;
                customizationHTML += `<span>🎨 Color: <strong>${details.color}</strong></span>`;
                customizationHTML += `<span>Category: <strong>${details.category}</strong></span>`;
            } else if (item.designType === 'uploaded') {
                // Uploaded design
                customizationHTML += `<span>📤 Uploaded Design</span>`;
                customizationHTML += `<span>Type: <strong>${details.clothingType}</strong></span>`;
                customizationHTML += `<span>Item: <strong>${details.itemDescription}</strong></span>`;
                customizationHTML += `<span>File: <strong>${details.fileName}</strong></span>`;
            }
            customizationHTML += '</div>';
        } else if (item.customization) {
            // Standard product customization
            customizationHTML = '<div class="cart-customization">';
            if (item.customization.size) customizationHTML += `<span>📏 Size: <strong>${item.customization.size}</strong></span>`;
            if (item.customization.color) customizationHTML += `<span>🎨 Color: <strong>${item.customization.color}</strong></span>`;
            if (item.customization.name) customizationHTML += `<span>👤 Name: <strong>${item.customization.name}</strong></span>`;
            if (item.customization.number) customizationHTML += `<span>🔢 #<strong>${item.customization.number}</strong></span>`;
            customizationHTML += '</div>';
        }

        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                ${customizationHTML}
                <div class="cart-item-price">₱${item.price.toFixed(2)} each</div>
            </div>
            <div class="cart-item-quantity">
                <button onclick="updateCartQuantity(${index}, -1)" class="btn btn-small">-</button>
                <input type="number" value="${item.quantity}" onchange="updateCartQuantityDirect(${index}, this.value)" min="1">
                <button onclick="updateCartQuantity(${index}, 1)" class="btn btn-small">+</button>
            </div>
            <div style="color: #4a9eff; font-weight: bold;">₱${itemTotal.toFixed(2)}</div>
            <div style="display: flex; gap: 5px;">
                ${item.type === 'custom-design' ? '' : '<button class="cart-item-edit" onclick="openEditCustomizationModal(' + index + ')">Edit Custom</button>'}
                <button class="cart-item-remove" onclick="removeFromCart(${index})">Remove</button>
            </div>
        `;
        cartItems.appendChild(cartItem);
    });

    cartTotal.textContent = total.toFixed(2);
}

// Open Edit Customization Modal
function openEditCustomizationModal(cartIndex) {
    appData.editingCartIndex = cartIndex;
    const item = appData.cart[cartIndex];
    
    // Set the item name heading
    document.getElementById('editItemName').textContent = `Editing: ${item.name}`;
    
    // Fill in current customization values
    document.getElementById('editCustomSize').value = item.customization?.size || '';
    document.getElementById('editCustomColor').value = item.customization?.color || '';
    document.getElementById('editCustomName').value = item.customization?.name || '';
    document.getElementById('editCustomNumber').value = item.customization?.number || '';
    
    // Show modal
    document.getElementById('editCustomizationModal').style.display = 'block';
}

// Close Edit Customization Modal
function closeEditCustomizationModal() {
    document.getElementById('editCustomizationModal').style.display = 'none';
    appData.editingCartIndex = null;
    document.getElementById('editCustomSize').value = '';
    document.getElementById('editCustomColor').value = '';
    document.getElementById('editCustomName').value = '';
    document.getElementById('editCustomNumber').value = '';
}

// Save Customization Edit
function saveCustomizationEdit() {
    const index = appData.editingCartIndex;
    if (index === null || index === undefined) return;
    
    const cartItem = appData.cart[index];
    const customSize = document.getElementById('editCustomSize').value.trim();
    const customColor = document.getElementById('editCustomColor').value.trim();
    const customName = document.getElementById('editCustomName').value.trim();
    const customNumber = document.getElementById('editCustomNumber').value.trim();
    
    // Validate size and color
    if (!customSize) {
        alert('Please select a size');
        return;
    }
    if (!customColor) {
        alert('Please select a color');
        return;
    }
    
    // Update customization
    if (!cartItem.customization) {
        cartItem.customization = {};
    }
    cartItem.customization.size = customSize;
    cartItem.customization.color = customColor;
    cartItem.customization.name = customName;
    cartItem.customization.number = customNumber;
    
    // Show confirmation
    alert('✓ Customization updated successfully!');
    
    // Close modal and update display
    closeEditCustomizationModal();
    updateCartDisplay();
    updateCheckoutDisplay();
    saveUserCart();  // Save cart to localStorage
}

// Update Cart Quantity
function updateCartQuantity(index, change) {
    const newQuantity = appData.cart[index].quantity + change;
    if (newQuantity < 1) {
        removeFromCart(index);
    } else if (newQuantity <= appData.cart[index].stock) {
        appData.cart[index].quantity = newQuantity;
        updateCartDisplay();
        updateCartCount();
        saveUserCart();  // Save cart to localStorage
    }
}

function updateCartQuantityDirect(index, value) {
    const newQuantity = parseInt(value);
    if (newQuantity < 1 || newQuantity > appData.cart[index].stock) {
        updateCartDisplay();
        return;
    }
    appData.cart[index].quantity = newQuantity;
    updateCartDisplay();
    updateCartCount();
    saveUserCart();  // Save cart to localStorage
}

// Remove from Cart
function removeFromCart(index) {
    appData.cart.splice(index, 1);
    updateCartDisplay();
    updateCartCount();
    saveUserCart();  // Save cart to localStorage
}

// Setup Search and Filter
function setupSearchAndFilter() {
    const searchInput = document.getElementById('searchProducts');
    const categoryFilter = document.getElementById('categoryFilter');

    searchInput.addEventListener('input', filterProducts);
    categoryFilter.addEventListener('change', filterProducts);
}

// Filter Products
function filterProducts() {
    const searchTerm = document.getElementById('searchProducts').value.toLowerCase();
    const type = document.getElementById('categoryFilter').value;

    const filtered = appData.products.filter(product => {
        const matchesSearch = product.name.toLowerCase().includes(searchTerm) || 
                             product.description.toLowerCase().includes(searchTerm);
        const matchesType = !type || product.type === type;
        return matchesSearch && matchesType;
    });

    displayProducts(filtered);
}

// ===== CHECKOUT =====

// Update Checkout Display
function updateCheckoutDisplay() {
    const checkoutItems = document.getElementById('checkoutItemsList');
    const total = appData.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const accounts = loadCustomerAccounts();
    const profile = appData.currentUserProfile || accounts[appData.currentUser] || {};
    const customerName = document.getElementById('customerName');
    const customerEmail = document.getElementById('customerEmail');
    const customerPhone = document.getElementById('customerPhone');
    const customerAddress = document.getElementById('customerAddress');
    const checkoutName = document.getElementById('checkoutName');
    const checkoutNumber = document.getElementById('checkoutNumber');

    if (customerName && !customerName.value) customerName.value = profile.fullName || appData.currentUser || '';
    if (customerEmail && !customerEmail.value) customerEmail.value = profile.email || appData.currentUser || '';
    if (customerPhone && !customerPhone.value) customerPhone.value = profile.phone || '';
    if (customerAddress && !customerAddress.value) customerAddress.value = profile.address || '';
    if (checkoutName && !checkoutName.value && appData.cart.length > 0) {
        const firstItem = appData.cart[0];
        if (firstItem && firstItem.customization && firstItem.customization.name) {
            checkoutName.value = firstItem.customization.name;
        }
    }
    if (checkoutNumber && !checkoutNumber.value && appData.cart.length > 0) {
        const firstItem = appData.cart[0];
        if (firstItem && firstItem.customization && firstItem.customization.number) {
            checkoutNumber.value = firstItem.customization.number;
        }
    }
    syncOrderSelectionFromCart();
    
    if (!checkoutItems) {
        document.getElementById('checkoutTotal').textContent = total.toFixed(2);
        return;
    }

    checkoutItems.innerHTML = '';
    
    appData.cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        
        // Build customization display
        let customHTML = '';
        
        // Handle custom design items
        if (item.type === 'custom-design' && item.details) {
            customHTML = '<div style="background: #1f1f1f; padding: 10px; border-radius: 5px; margin-top: 8px; border: 1px solid #3a3a3a;">';
            const details = item.details;
            
            if (item.designType === 'custom') {
                customHTML += '<strong style="color: #d4af37;">Design Specifications:</strong><br>';
                if (details.clothingType === 'top') {
                    customHTML += `<span style="display: block; margin: 5px 0;">👕 <strong>Top Design</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">🎨 Base Color: <strong>${details.baseColor}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">Accent Color: <strong>${details.accentColor}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">📦 Fabric: <strong>${details.fabricType}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">📏 Size: <strong>${details.size}</strong></span>`;
                    if (details.frontDesign) customHTML += `<span style="display: block; margin: 5px 0;">Front Design: <em>${details.frontDesign}</em></span>`;
                    if (details.backDesign) customHTML += `<span style="display: block; margin: 5px 0;">Back Design: <em>${details.backDesign}</em></span>`;
                } else if (details.clothingType === 'bottoms') {
                    customHTML += `<span style="display: block; margin: 5px 0;">👖 <strong>Bottoms Design</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">🎨 Base Color: <strong>${details.baseColor}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">📦 Fabric: <strong>${details.fabricType}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">📏 Size: <strong>${details.size}</strong></span>`;
                    customHTML += `<span style="display: block; margin: 5px 0;">Side Stripe: <strong>${details.sideStripe}</strong></span>`;
                    if (details.design) customHTML += `<span style="display: block; margin: 5px 0;">Design: <em>${details.design}</em></span>`;
                }
            } else if (item.designType === 'preset') {
                customHTML += '<strong style="color: #d4af37;">Preset Template:</strong><br>';
                customHTML += `<span style="display: block; margin: 5px 0;">📋 <strong>${details.name}</strong></span>`;
                customHTML += `<span style="display: block; margin: 5px 0;">🎨 Color: <strong>${details.color}</strong></span>`;
                customHTML += `<span style="display: block; margin: 5px 0;">Category: <strong>${details.category}</strong></span>`;
            } else if (item.designType === 'uploaded') {
                customHTML += '<strong style="color: #d4af37;">Uploaded Custom Design:</strong><br>';
                customHTML += `<span style="display: block; margin: 5px 0;">📤 <strong>${details.itemDescription}</strong></span>`;
                customHTML += `<span style="display: block; margin: 5px 0;">Type: <strong>${details.clothingType}</strong></span>`;
                customHTML += `<span style="display: block; margin: 5px 0;">File: <strong>${details.fileName}</strong></span>`;
            }
            customHTML += '</div>';
        } else if (item.customization) {
            // Standard product customization
            customHTML = '<div style="color: #d4af37; font-size: 0.9em; margin-top: 5px;">';
            if (item.customization.size) customHTML += `📏 Size: <strong>${item.customization.size}</strong><br>`;
            if (item.customization.color) customHTML += `🎨 Color: <strong>${item.customization.color}</strong><br>`;
            if (item.customization.name) customHTML += `👤 Name: <strong>${item.customization.name}</strong><br>`;
            if (item.customization.number) customHTML += `🔢 Number: <strong>#${item.customization.number}</strong>`;
            customHTML += '</div>';
        }
        
        const itemElement = document.createElement('div');
        itemElement.className = 'checkout-item';
        itemElement.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 10px;">
                <div style="flex: 1;">
                    <strong>${item.name}</strong> × ${item.quantity}
                    ${customHTML}
                </div>
                <div style="text-align: right; min-width: 100px;">₱${itemTotal.toFixed(2)}</div>
            </div>
        `;
        checkoutItems.appendChild(itemElement);
    });
    
    document.getElementById('checkoutTotal').textContent = total.toFixed(2);
}


// GCash QR Code Preview Handler
document.addEventListener('DOMContentLoaded', function() {
    const loginPage = document.getElementById('loginPage');
    const customerPage = document.getElementById('customerPage');
    const adminPage = document.getElementById('adminPage');

    // Restore the active dashboard whenever a valid session exists.
    const savedSession = loadCurrentSession();
    const isAdminPortal = new URLSearchParams(window.location.search).get('portal') === 'admin';

    if (isAdminPortal) {
        document.getElementById('customerLoginOption')?.style.setProperty('display', 'none');
        document.getElementById('adminLoginOption')?.style.setProperty('display', 'block');
        document.getElementById('customerAuthSection')?.style.setProperty('display', 'none');
        document.getElementById('adminLoginForm')?.style.setProperty('display', 'block');
        document.querySelector('.login-divider')?.style.setProperty('display', 'none');
    } else {
        document.getElementById('adminLoginOption')?.style.setProperty('display', 'none');
    }

    if (savedSession && (savedSession.role === 'customer' || savedSession.role === 'admin')) {
        checkSavedSession();
    } else {
        clearCurrentSession();
        localStorage.removeItem('kingpinSession');
        localStorage.removeItem('kingpinCurrentSession');
        localStorage.removeItem('kingpinQuickLoginUser');
        localStorage.removeItem('kingpinForceLogin');
        if (customerPage) customerPage.style.display = 'none';
        if (adminPage) adminPage.style.display = 'none';
        if (loginPage) loginPage.style.display = 'block';
    }

    const customerName = document.getElementById('customerDisplayName');
    if (customerName) {
        customerName.textContent = 'Welcome, Customer!';
    }

    const checkoutSize = document.getElementById('checkoutSize');
    if (checkoutSize) {
        checkoutSize.addEventListener('change', function() {
            fillMeasurementsFromSize(this.value);
        });
    }

    const customSize = document.getElementById('customSize');
    if (customSize) {
        customSize.addEventListener('change', function() {
            const selectedSize = this.value;
            if (!selectedSize) return;

            const checkoutSizeField = document.getElementById('checkoutSize');
            if (checkoutSizeField) checkoutSizeField.value = selectedSize;
            fillMeasurementsFromSize(selectedSize);
        });
    }

    const gcashQRInput = document.getElementById('gcashQRCode');
    if (gcashQRInput) {
        gcashQRInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const preview = document.getElementById('gcashQRPreview');
                    const previewImage = document.getElementById('gcashQRImage');
                    previewImage.src = event.target.result;
                    preview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        });
    }
});

function placeCustomerOrder(event) {
    if (event) event.preventDefault();
    processCustomerOrder();
}

// Handle Checkout
function processCustomerOrder() {
    const orderProcessingKey = 'kingpinOrderProcessing';
    const lastOrderSuccessRaw = sessionStorage.getItem('kingpinLastOrderSuccess');
    let lastOrderSuccess = null;

    try {
        lastOrderSuccess = lastOrderSuccessRaw ? JSON.parse(lastOrderSuccessRaw) : null;
    } catch (error) {
        console.warn('Unable to parse last successful order:', error);
    }

    const isRecentSuccessfulOrder = lastOrderSuccess && (Date.now() - Number(lastOrderSuccess.timestamp || 0)) < 60000;

    if (sessionStorage.getItem(orderProcessingKey) === '1') {
        if (isRecentSuccessfulOrder) {
            sessionStorage.removeItem(orderProcessingKey);
        } else {
            console.warn('Duplicate order submission ignored to prevent reprocessing.');
            return;
        }
    }

    if (appData.cart.length === 0) {
        alert('Your cart is empty. Please add an item before placing an order.');
        return;
    }

    sessionStorage.setItem(orderProcessingKey, '1');
    const placeOrderButton = document.getElementById('placeCustomerOrderButton');
    if (placeOrderButton) {
        placeOrderButton.disabled = true;
        placeOrderButton.style.opacity = '0.7';
        placeOrderButton.style.cursor = 'not-allowed';
    }

    // Validate all required fields
    const customerName = document.getElementById('customerName').value.trim();
    const customerEmail = document.getElementById('customerEmail').value.trim();
    const customerPhone = document.getElementById('customerPhone').value.trim();
    const customerAddress = document.getElementById('customerAddress').value.trim();
    const checkoutName = document.getElementById('checkoutName') ? document.getElementById('checkoutName').value.trim() : '';
    const checkoutNumber = document.getElementById('checkoutNumber') ? document.getElementById('checkoutNumber').value.trim() : '';
    const checkoutSize = document.getElementById('checkoutSize') ? document.getElementById('checkoutSize').value.trim() : '';
    const checkoutColor = document.getElementById('checkoutColor') ? document.getElementById('checkoutColor').value.trim() : '';
    const paymentMethod = document.getElementById('paymentMethod').value;
    
    console.log('Order processing started', {
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        paymentMethod,
        checkoutName,
        checkoutNumber,
        checkoutSize,
        checkoutColor,
        cartLength: appData.cart.length
    });
    
    if (!customerName) {
        alert('Please enter your name');
        sessionStorage.removeItem('kingpinOrderProcessing');
        const placeOrderButtonReset = document.getElementById('placeCustomerOrderButton');
        if (placeOrderButtonReset) {
            placeOrderButtonReset.disabled = false;
            placeOrderButtonReset.style.opacity = '1';
            placeOrderButtonReset.style.cursor = 'pointer';
        }
        return;
    }
    
    if (!customerEmail) {
        alert('Please enter your email');
        sessionStorage.removeItem('kingpinOrderProcessing');
        const placeOrderButtonReset = document.getElementById('placeCustomerOrderButton');
        if (placeOrderButtonReset) {
            placeOrderButtonReset.disabled = false;
            placeOrderButtonReset.style.opacity = '1';
            placeOrderButtonReset.style.cursor = 'pointer';
        }
        return;
    }
    
    if (!customerPhone) {
        alert('Please enter your phone number');
        sessionStorage.removeItem('kingpinOrderProcessing');
        const placeOrderButtonReset = document.getElementById('placeCustomerOrderButton');
        if (placeOrderButtonReset) {
            placeOrderButtonReset.disabled = false;
            placeOrderButtonReset.style.opacity = '1';
            placeOrderButtonReset.style.cursor = 'pointer';
        }
        return;
    }
    
    if (!customerAddress) {
        alert('Please enter your delivery address');
        sessionStorage.removeItem('kingpinOrderProcessing');
        const placeOrderButtonReset = document.getElementById('placeCustomerOrderButton');
        if (placeOrderButtonReset) {
            placeOrderButtonReset.disabled = false;
            placeOrderButtonReset.style.opacity = '1';
            placeOrderButtonReset.style.cursor = 'pointer';
        }
        return;
    }
    
    try {
        const totalAmount = appData.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const downpaymentAmount = paymentMethod === 'gcash' ? Number(totalAmount) / 2 : 0;
        const normalizedCart = appData.cart.map(item => {
            const nextCustomization = {
                ...(item.customization || {}),
                name: checkoutName || item.customization?.name || '',
                number: checkoutNumber || item.customization?.number || '',
                size: checkoutSize || item.customization?.size || '',
                color: checkoutColor || item.customization?.color || ''
            };

            item.customization = nextCustomization;

            return {
                ...item,
                customization: nextCustomization
            };
        });
        const orderData = {
            id: Date.now(),
            customerUsername: appData.currentUser,
            customerName: customerName,
            customerEmail: customerEmail,
            customerPhone: customerPhone,
            customerAddress: customerAddress,
            items: normalizedCart,
            totalAmount: totalAmount,
            measurements: {
                chest: document.getElementById('chestMeasurement').value || 'Not provided',
                waist: document.getElementById('waistMeasurement').value || 'Not provided',
                length: document.getElementById('lengthMeasurement').value || 'Not provided'
            },
            status: 'pending',
            paymentMethod: paymentMethod,
            paymentStatus: paymentMethod === 'gcash' ? 'awaiting-proof' : 'pending',
            date: new Date().toLocaleDateString(),
            gcashPaymentProof: null,
            gcashQRCode: paymentMethod === 'gcash' ? (localStorage.getItem('kingpinGCashQR') || appData.gcashQRCode || null) : null,
            gcashDownpaymentAmount: paymentMethod === 'gcash' ? downpaymentAmount : 0
        };

        // Decrease stock for each item in the order
        appData.cart.forEach(cartItem => {
            const quantityToReduce = Number(cartItem.quantity) || 1;
            const productIndex = appData.products.findIndex(p => Number(p.id) === Number(cartItem.id));
            const fallbackIndex = productIndex === -1 ? appData.products.findIndex(p => p.name === cartItem.name) : -1;
            const targetIndex = productIndex !== -1 ? productIndex : fallbackIndex;

            if (targetIndex !== -1) {
                const product = appData.products[targetIndex];
                const currentStock = Number(product.stock) || 0;
                const nextStock = Math.max(0, currentStock - quantityToReduce);
                console.log(`Decreasing stock for ${product.name}: ${currentStock} -> ${nextStock}`);
                product.stock = nextStock;
            } else {
                console.warn('No matching product found for stock deduction:', cartItem);
            }
        });
        
        // Save updated products to localStorage
        console.log('Saving products:', appData.products);
        saveProductsWithoutBlocking();
        
        appData.orders.push(orderData);
        saveOrders();
        saveOrderToSharedServer(orderData).catch(error => {
            console.error('Order was saved locally but not shared with admin:', error);
        });
        saveOrderToHistory({ ...orderData }, false);
        appData.cart = [];
        
        // Clear user's saved cart from localStorage after order
        clearUserCart();
        
        // Add notification for admin with payment info
        addNotification('admin', `✓ New Order #${orderData.id} from ${orderData.customerName}`, orderData.id);
        addNotification('customer', paymentMethod === 'gcash'
            ? `✓ Order #${orderData.id} was placed. Please upload your GCash payment proof in My Orders.`
            : `✓ Your order #${orderData.id} was placed successfully. Total: ₱${orderData.totalAmount.toFixed(2)}. Payment: COD.`, orderData.id);
        saveNotifications();
        updateNotificationBadges();
        if (document.getElementById('notificationsList')) {
            loadCustomerNotifications();
        }
        
        // Show success message
        const messageDiv = document.getElementById('gcashPaymentMessage');
        if (messageDiv) {
            messageDiv.className = 'message success';
            messageDiv.textContent = '✓ Order placed successfully! Your Order ID: ' + orderData.id + ' - ' + (paymentMethod === 'gcash' ? 'Upload payment proof in My Orders' : 'Cash on Delivery');
            messageDiv.style.display = 'block';
        }

        sessionStorage.setItem('kingpinLastOrderSuccess', JSON.stringify({
            orderId: orderData.id,
            message: `✅ Order #${orderData.id} placed successfully! Receipt is ready.`,
            timestamp: Date.now()
        }));

        document.getElementById('checkoutSection').style.display = 'none';
        document.getElementById('productsSection').style.display = 'block';
        document.getElementById('cartSection').style.display = 'none';
        document.getElementById('ordersSection').style.display = 'none';
        document.getElementById('notificationsSection').style.display = 'none';
        updateFloatingBackButton();

        setTimeout(() => {
            showOrderReceipt(orderData);
        }, 150);
        
        // Clear form
        document.getElementById('checkoutForm').reset();
        updateCartCount();
        loadOrders();
        loadProducts();
        loadNotifications();
    } catch (error) {
        console.error('Error processing order:', error);
        alert('Error placing order: ' + error.message);
    } finally {
        sessionStorage.removeItem('kingpinOrderProcessing');
        const placeOrderButtonReset = document.getElementById('placeCustomerOrderButton');
        if (placeOrderButtonReset) {
            placeOrderButtonReset.disabled = false;
            placeOrderButtonReset.style.opacity = '1';
            placeOrderButtonReset.style.cursor = 'pointer';
        }
    }
}

function viewCustomerReceipt(orderId) {
    const order = appData.orders.find(item => item.id === orderId);
    if (order) showOrderReceipt(order, false, true);
}

function showOrderReceipt(order, isPreview = false, preserveCurrentView = false) {
    const itemsHtml = order.items.map(item => {
        const customization = item.customization || {};
        const color = customization.color || customization.colour || 'Not specified';
        const nameText = customization.name ? ` / ${customization.name}` : '';
        const numberText = customization.number ? ` #${customization.number}` : '';
        const colorText = color && color !== 'Not specified' ? ` / Color: ${color}` : '';

        return `
            <div style="display: flex; justify-content: space-between; gap: 15px; padding: 8px 0; border-bottom: 1px solid #444;">
                <span>${item.name} × ${item.quantity}${nameText}${numberText}${colorText}</span>
                <strong>₱${(item.price * item.quantity).toFixed(2)}</strong>
            </div>
        `;
    }).join('');
    const measurements = order.measurements || {};

    document.getElementById('orderDetailsContent').innerHTML = `
        <div style="display: block; padding: 20px; color: #f4f4f4;">
            <div style="text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 15px; margin-bottom: 18px;">
                <h2 style="color: #d4af37; margin: 0 0 6px;">${isPreview ? 'Order Review' : 'Order Receipt'}</h2>
                <div style="color: #e8e8e8;">${isPreview ? 'Review before payment' : `Order #${order.id}`}</div>
                <small style="color: #bcbcbc;">${order.date}</small>
            </div>
            <div style="margin-bottom: 18px; background: #1f1f1f; border: 1px solid #3a3a3a; border-radius: 8px; padding: 16px; color: #f4f4f4;">
                <h3 style="color: #f4f4f4; margin-top: 0; margin-bottom: 10px;">Customer Information</h3>
                <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Name:</strong> ${order.customerName}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Email:</strong> ${order.customerEmail}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Phone:</strong> ${order.customerPhone}</div>
                <div><strong style="color: #d4af37;">Delivery Location:</strong> ${order.customerAddress}</div>
            </div>
            <div style="margin-bottom: 18px;"><h3 style="color: #f4f4f4;">Order Items</h3>${itemsHtml}</div>
            <div style="margin-bottom: 18px; color: #f4f4f4;">
                <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Payment Method:</strong> ${order.paymentMethod.toUpperCase()}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Payment Status:</strong> ${order.paymentStatus.replace('-', ' ')}</div>
                <div><strong style="color: #d4af37;">Measurements:</strong> Chest ${measurements.chest}, Waist ${measurements.waist}, Length ${measurements.length} cm</div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 1.2em; color: #d4af37; border-top: 2px solid #d4af37; padding-top: 14px;">
                <strong>Total</strong><strong>₱${order.totalAmount.toFixed(2)}</strong>
            </div>
        </div>
    `;
    if (!isPreview && !preserveCurrentView) {
        document.getElementById('checkoutSection').style.display = 'none';
        document.getElementById('productsSection').style.display = 'block';
    }
    if (!preserveCurrentView) {
        document.getElementById('cartSection').style.display = 'none';
        document.getElementById('ordersSection').style.display = 'none';
        document.getElementById('notificationsSection').style.display = 'none';
    }
    const footer = document.querySelector('#orderDetailsModal .modal-footer');
    const footerMarkup = isPreview
        ? '<button class="btn btn-primary" onclick="continueToPayment()">Proceed to Payment</button><button class="btn btn-secondary" onclick="closeOrderReview()">Cancel</button>'
        : '<button class="btn btn-secondary" onclick="closeOrderDetailsModal()">Close</button>';

    if (footer) {
        footer.innerHTML = footerMarkup;
    } else {
        const modalContent = document.querySelector('#orderDetailsModal .modal-content');
        if (modalContent) {
            const fallbackFooter = document.createElement('div');
            fallbackFooter.className = 'modal-footer';
            fallbackFooter.innerHTML = footerMarkup;
            modalContent.appendChild(fallbackFooter);
        }
    }

    document.getElementById('orderDetailsModal').dataset.preview = isPreview ? 'true' : 'false';
    document.getElementById('orderDetailsModal').style.display = 'block';
}

function continueToPayment() {
    closeOrderDetailsModal();
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('ordersSection').style.display = 'none';
    document.getElementById('purchaseHistorySection').style.display = 'none';
    document.getElementById('notificationsSection').style.display = 'none';
    document.getElementById('checkoutSection').style.display = 'block';
    loadSharedGcashQRCode();
    updateCheckoutDisplay();
    updatePaymentMethodUI();
}

function closeOrderReview() {
    closeOrderDetailsModal();
    appData.cart = [];
    updateCartCount();
    updateCartDisplay();
    saveUserCart();
}

// Load Customer Orders (filtered by logged-in customer)
function normalizePaymentMethod(value) {
    return String(value || 'gcash').toLowerCase();
}

function isOrderInPurchaseHistory(order) {
    return ['completed', 'delivered', 'cancelled'].includes(order.status);
}

function loadCustomerOrders() {
    const ordersList = document.getElementById('ordersList');
    if (!ordersList) return;
    ordersList.innerHTML = '';

    const currentUserEmail = appData.currentUser || '';
    const customerOrders = appData.orders
        .filter(order => {
            const matchesUsername = order.customerUsername === currentUserEmail;
            const matchesEmail = order.customerEmail === currentUserEmail;
            const isActive = !isOrderInPurchaseHistory(order);
            return (matchesUsername || matchesEmail) && isActive;
        })
        .sort((firstOrder, secondOrder) => Number(secondOrder.id) - Number(firstOrder.id));

    if (customerOrders.length === 0) {
        ordersList.innerHTML = '<p style="text-align: center; padding: 40px; color: #a0a0a0;">No active orders. <a href="javascript:viewPurchaseHistory()" style="color: #d4af37; text-decoration: underline;">View purchase history</a></p>';
        return;
    }

    customerOrders.forEach(order => {
        // Build items list with customization
        const itemsList = order.items.map(item => {
            let customStr = '';
            if (item.customization) {
                customStr = ' [';
                if (item.customization.size) customStr += `${item.customization.size}`;
                if (item.customization.name || item.customization.number) {
                    if (item.customization.size) customStr += ', ';
                    if (item.customization.name) customStr += `${item.customization.name}`;
                    if (item.customization.name && item.customization.number) customStr += ' ';
                    if (item.customization.number) customStr += `#${item.customization.number}`;
                }
                customStr += ']';
            }
            return `${item.name} (x${item.quantity})${customStr}`;
        }).join(', ');
        
        const orderItem = document.createElement('div');
        orderItem.className = 'order-item';

        const paymentMethod = normalizePaymentMethod(order.paymentMethod);
        const requiredDownpayment = Number(order.gcashDownpaymentAmount ?? ((Number(order.totalAmount || 0) / 2) || 0));
        const orderGcashQr = order.gcashQRCode || (paymentMethod === 'gcash' ? (appData.gcashQRCode || localStorage.getItem('kingpinGCashQR')) : null);
        const gcashProofHtml = order.gcashPaymentProof
            ? `<p style="color: #4caf50;">✓ Proof uploaded</p><img src="${order.gcashPaymentProof}" alt="GCash payment proof">`
            : '<p style="color: #ffb74d;">Proof not uploaded yet</p>';
        
        // Determine status progress
        const statuses = ['design-approval', 'printing', 'completed'];
        const currentStatusIndex = statuses.indexOf(order.status);
        
        let statusHtml = '<div class="order-tracking">';
        statuses.forEach((status, index) => {
            const isActive = index <= currentStatusIndex;
            const statusLabel = status === 'design-approval' ? 'Design Review' : 
                               status === 'printing' ? 'Printing' : 'Completed';
            statusHtml += `<div class="tracking-step ${isActive ? 'active' : ''}">
                <div class="tracking-circle">${index + 1}</div>
                <div class="tracking-label">${statusLabel}</div>
            </div>`;
        });
        statusHtml += '</div>';
        
        orderItem.innerHTML = `
            <div class="order-header">
                <span class="order-id">Order #${order.id}</span>
                <span class="order-status ${order.status}">${order.status.toUpperCase().replace('-', ' ')}</span>
            </div>
            <div class="order-details">
                <p><strong>Customer:</strong> ${order.customerName}</p>
                <p><strong>Email:</strong> ${order.customerEmail}</p>
                <p><strong>Products:</strong> ${itemsList}</p>
                <p><strong>Delivery Address:</strong> ${order.customerAddress}</p>
                <p><strong>Order Date:</strong> ${order.date}</p>
                <p><strong>Payment Method:</strong> ${(order.paymentMethod || 'gcash').toUpperCase()}</p>
                ${order.measurements ? `<p><strong>Measurements:</strong> Chest: ${order.measurements.chest}cm, Waist: ${order.measurements.waist}cm, Length: ${order.measurements.length}cm</p>` : ''}
            </div>
            ${statusHtml}
            <div class="order-total">Total: ₱${order.totalAmount.toFixed(2)}</div>
            <button type="button" class="btn btn-small view-receipt-button" onclick="viewCustomerReceipt(${order.id})">View Receipt</button>
            ${paymentMethod === 'gcash' && orderGcashQr ? `<div class="order-gcash-qr"><strong>GCash Installment QR:</strong><a href="${orderGcashQr}" target="_blank" rel="noopener">Open payment QR</a><img src="${orderGcashQr}" alt="GCash installment QR code"></div>` : ''}
            ${paymentMethod === 'gcash' ? `<div class="order-payment-proof"><strong>GCash Payment Proof:</strong><p class="half-payment-notice">Required downpayment: ₱${requiredDownpayment.toFixed(2)}</p><label for="gcashDownpayment-${order.id}" style="display:block; margin-top:8px; color:#d4af37; font-weight:600;">Amount to pay:</label><input id="gcashDownpayment-${order.id}" type="number" step="0.01" min="0" value="${requiredDownpayment.toFixed(2)}" onchange="updateOrderDownpayment(${order.id}, this.value)" style="width: 100%; margin-top: 6px; margin-bottom: 10px; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #111; color: #fff;" />${gcashProofHtml}<input type="file" accept="image/*" onchange="uploadOrderPaymentProof(${order.id}, this)"></div>` : ''}
            <div class="order-actions"><strong>Order action:</strong><div class="order-action-buttons"><button type="button" class="btn btn-small" onclick="showOrderRequestReasons(${order.id}, 'cancel')">Cancel / Change of Mind</button><button type="button" class="btn btn-small" onclick="showOrderRequestReasons(${order.id}, 'refund')">Request Refund</button></div><div id="orderReason-${order.id}" class="order-reason-options"></div>${order.requestType ? `<p class="order-request-status">Request: ${order.requestType === 'cancel' ? 'Cancel / Change of Mind' : 'Refund'} (${order.requestStatus || 'pending'})</p>` : ''}</div>
            ${getOrderReviewsSection(order)}
        `;
        ordersList.appendChild(orderItem);
    });
}

// Load Purchase History (Completed/Delivered/Cancelled Orders)
function loadPurchaseHistory() {
    const historyList = document.getElementById('purchaseHistoryList');
    if (!historyList) return;
    historyList.innerHTML = '';

    const currentUserEmail = appData.currentUser || '';
    const purchaseHistory = appData.orders
        .filter(order => {
            const matchesUsername = order.customerUsername === currentUserEmail;
            const matchesEmail = order.customerEmail === currentUserEmail;
            return (matchesUsername || matchesEmail) && isOrderInPurchaseHistory(order);
        })
        .sort((firstOrder, secondOrder) => Number(secondOrder.id) - Number(firstOrder.id));

    if (purchaseHistory.length === 0) {
        historyList.innerHTML = '<p style="text-align: center; padding: 40px; color: #a0a0a0;">No purchase history yet</p>';
        return;
    }

    purchaseHistory.forEach(order => {
        // Build items list with customization
        const itemsList = order.items.map(item => {
            let customStr = '';
            if (item.customization) {
                customStr = ' [';
                if (item.customization.size) customStr += `${item.customization.size}`;
                if (item.customization.name || item.customization.number) {
                    if (item.customization.size) customStr += ', ';
                    if (item.customization.name) customStr += `${item.customization.name}`;
                    if (item.customization.name && item.customization.number) customStr += ' ';
                    if (item.customization.number) customStr += `#${item.customization.number}`;
                }
                customStr += ']';
            }
            return `${item.name} (x${item.quantity})${customStr}`;
        }).join(', ');
        
        const historyItem = document.createElement('div');
        historyItem.className = 'order-item';

        historyItem.innerHTML = `
            <div class="order-header">
                <span class="order-id">Order #${order.id}</span>
                <span class="order-status ${order.status}">${order.status.toUpperCase().replace('-', ' ')}</span>
            </div>
            <div class="order-details">
                <p><strong>Customer:</strong> ${order.customerName}</p>
                <p><strong>Email:</strong> ${order.customerEmail}</p>
                <p><strong>Products:</strong> ${itemsList}</p>
                <p><strong>Delivery Address:</strong> ${order.customerAddress}</p>
                <p><strong>Order Date:</strong> ${order.date}</p>
                <p><strong>Payment Method:</strong> ${(order.paymentMethod || 'gcash').toUpperCase()}</p>
                ${order.measurements ? `<p><strong>Measurements:</strong> Chest: ${order.measurements.chest}cm, Waist: ${order.measurements.waist}cm, Length: ${order.measurements.length}cm</p>` : ''}
            </div>
            <div class="order-total">Total: ₱${order.totalAmount.toFixed(2)}</div>
            <button type="button" class="btn btn-small view-receipt-button" onclick="viewCustomerReceipt(${order.id})">View Receipt</button>
            ${getOrderReviewsSection(order)}
        `;
        historyList.appendChild(historyItem);
    });
}

function showOrderRequestReasons(orderId, requestType) {
    const reasonContainer = document.getElementById(`orderReason-${orderId}`);
    if (!reasonContainer || !requestType) return;

    const reasons = requestType === 'cancel'
        ? ['Change of mind', 'No longer needed', 'Processing is taking too long', 'Other / Personal reason']
        : ['Product arrived damaged', 'Wrong item received', 'Product does not match the order', 'Other / Personal reason'];
    reasonContainer.innerHTML = `<label for="orderReasonSelect-${orderId}">Reason:</label><select id="orderReasonSelect-${orderId}">${reasons.map(reason => `<option value="${reason}">${reason}</option>`).join('')}</select><button type="button" class="btn btn-small" onclick="requestOrderAction(${orderId}, '${requestType}', document.getElementById('orderReasonSelect-${orderId}').value)">Submit Request</button>`;
}

// Generate review section for products in an order (for My Orders display)
function getOrderReviewsSection(order) {
    const isCompleted = order.status === 'completed' || order.status === 'delivered';
    if (!isCompleted) return ''; // No reviews for non-completed orders
    
    let reviewsHtml = '<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #444;"><h5 style="color: #d4af37; margin-bottom: 15px;">⭐ Leave Product Reviews</h5>';
    
    order.items.forEach(item => {
        const productId = item.id;
        const ratings = loadProductRatings();
        const productRatings = ratings[productId] || [];
        const alreadyReviewed = productRatings.some(r => r.orderId === order.id);
        
        if (alreadyReviewed) {
            const review = productRatings.find(r => r.orderId === order.id);
            reviewsHtml += `
                <div style="padding: 12px; background: #1b5e20; border-radius: 5px; margin-bottom: 10px;">
                    <p style="margin: 0 0 5px 0; color: #4caf50;"><strong>✓ ${item.name}</strong></p>
                    <p style="margin: 0; font-size: 14px; color: #a0a0a0;">Your ${review.stars} star review has been recorded</p>
                </div>
            `;
        } else {
            reviewsHtml += `
                <div style="padding: 12px; background: #2a2a2a; border-radius: 5px; margin-bottom: 10px;">
                    <p style="margin: 0 0 10px 0;"><strong>${item.name}</strong> <span style="color: #a0a0a0; font-size: 12px;">(x${item.quantity})</span></p>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <label style="display: block; margin-bottom: 6px; color: #e0e0e0; font-size: 13px;">Rating:</label>
                            <div style="display: flex; gap: 4px; font-size: 22px; cursor: pointer;">
                                <span class="review-star-${order.id}-${productId}" data-rating="1" onclick="setOrderReviewRating(${order.id}, ${productId}, 1)" style="cursor: pointer;">☆</span>
                                <span class="review-star-${order.id}-${productId}" data-rating="2" onclick="setOrderReviewRating(${order.id}, ${productId}, 2)" style="cursor: pointer;">☆</span>
                                <span class="review-star-${order.id}-${productId}" data-rating="3" onclick="setOrderReviewRating(${order.id}, ${productId}, 3)" style="cursor: pointer;">☆</span>
                                <span class="review-star-${order.id}-${productId}" data-rating="4" onclick="setOrderReviewRating(${order.id}, ${productId}, 4)" style="cursor: pointer;">☆</span>
                                <span class="review-star-${order.id}-${productId}" data-rating="5" onclick="setOrderReviewRating(${order.id}, ${productId}, 5)" style="cursor: pointer;">☆</span>
                            </div>
                        </div>
                        <div>
                            <label for="review-comment-${order.id}-${productId}" style="display: block; margin-bottom: 6px; color: #e0e0e0; font-size: 13px;">Comment:</label>
                            <textarea id="review-comment-${order.id}-${productId}" placeholder="Your feedback..." maxlength="150" style="width: 100%; height: 50px; padding: 6px; border-radius: 3px; border: 1px solid #444; background: #111; color: #fff; font-family: Arial, sans-serif; font-size: 12px;" onchange="storeReviewDraft(${order.id}, ${productId}, this.value)"></textarea>
                        </div>
                    </div>
                    <input type="hidden" class="review-rating-${order.id}-${productId}" value="0">
                    <button type="button" class="btn btn-small" onclick="submitOrderProductReview(${order.id}, ${productId}, '${item.name}')" style="width: 100%; margin-top: 8px;">Submit Review</button>
                </div>
            `;
        }
    });
    
    reviewsHtml += '</div>';
    return reviewsHtml;
}

// Set review rating when customer clicks stars in My Orders
function setOrderReviewRating(orderId, productId, rating) {
    const ratingInput = document.querySelector(`.review-rating-${orderId}-${productId}`);
    if (ratingInput) {
        ratingInput.value = rating;
    }
    
    // Update star display
    const stars = document.querySelectorAll(`.review-star-${orderId}-${productId}`);
    stars.forEach(star => {
        const starRating = parseInt(star.dataset.rating);
        if (starRating <= rating) {
            star.textContent = '★';
            star.style.color = '#d4af37';
        } else {
            star.textContent = '☆';
            star.style.color = '#fff';
        }
    });
}

// Store review draft (auto-save comment)
function storeReviewDraft(orderId, productId, comment) {
    sessionStorage.setItem(`review-draft-${orderId}-${productId}`, comment);
}

// Submit product review from My Orders
function submitOrderProductReview(orderId, productId, productName) {
    const rating = parseInt(document.querySelector(`.review-rating-${orderId}-${productId}`).value) || 0;
    if (rating === 0) {
        alert('Please select a rating for ' + productName);
        return;
    }
    
    const comment = document.getElementById(`review-comment-${orderId}-${productId}`).value.trim();
    const order = appData.orders.find(o => o.id === orderId);
    
    if (!order) {
        alert('Order not found.');
        return;
    }
    
    // Verify order is completed
    if (order.status !== 'completed' && order.status !== 'delivered') {
        alert('This order is not marked as completed yet.');
        return;
    }
    
    // Check if already reviewed from this order
    if (hasCustomerReviewedOrder(orderId)) {
        alert('You have already reviewed a product from this order.');
        return;
    }
    
    // Get customer name
    const customerName = appData.currentUserProfile ? appData.currentUserProfile.fullName : 'Anonymous';
    
    // Save review
    const ratings = loadProductRatings();
    if (!ratings[productId]) {
        ratings[productId] = [];
    }
    
    ratings[productId].push({
        stars: rating,
        comment: comment || null,
        customerName: customerName,
        orderId: orderId,
        orderStatus: order.status,
        date: new Date().toLocaleDateString(),
        timestamp: Date.now()
    });
    
    saveProductRatings(ratings);
    
    // Clear draft
    sessionStorage.removeItem(`review-draft-${orderId}-${productId}`);
    
    // Show success
    showStatusUpdateToast(`✓ Thank you! Your review for ${productName} has been recorded.`);
    
    // Refresh My Orders display
    loadCustomerOrders();
}

function requestOrderAction(orderId, requestType, reason) {
    if (!requestType) return;

    const order = appData.orders.find(item => item.id === orderId);
    if (!order) return;
    if (order.requestStatus === 'pending') {
        alert('This order already has a pending request.');
        loadCustomerOrders();
        return;
    }
    if (['completed', 'delivered', 'cancelled'].includes(order.status) && requestType === 'cancel') {
        alert('This order can no longer be cancelled.');
        loadCustomerOrders();
        return;
    }

    const requestLabel = requestType === 'cancel' ? 'Cancel / Change of Mind' : 'Refund';
    if (!reason) return;
    if (!confirm(`Submit a ${requestLabel} request for order #${orderId}?\nReason: ${reason}`)) {
        loadCustomerOrders();
        return;
    }

    order.requestType = requestType;
    order.requestReason = reason;
    order.requestDate = new Date().toLocaleString();

    if (requestType === 'cancel') {
        order.status = 'cancelled';
        order.requestStatus = 'approved';

        saveOrderToHistory({ ...order }, false);

        saveOrders();
        addNotification('admin', `⚠️ Customer cancelled order #${orderId}.`, orderId);
        addNotification('customer', `✓ Your order #${orderId} has been cancelled successfully.`, orderId);
        saveNotifications();
        loadCustomerOrders();
        loadAdminOrders();
        showStatusUpdateToast(`✓ Order #${orderId} has been cancelled.`);
        return;
    }

    order.requestStatus = 'pending';
    saveOrders();

    addNotification('admin', `⚠️ ${requestLabel} request for order #${orderId}.`, orderId);
    addNotification('customer', `✓ Your ${requestLabel.toLowerCase()} request for order #${orderId} was submitted.`, orderId);
    saveNotifications();
    loadCustomerOrders();
    showStatusUpdateToast(`✓ ${requestLabel} request submitted.`);
}

function updateOrderDownpayment(orderId, amountValue) {
    const order = appData.orders.find(item => item.id === orderId);
    if (!order) return;

    const parsedValue = Number(amountValue);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        alert('Please enter a valid downpayment amount.');
        return;
    }

    order.gcashDownpaymentAmount = parsedValue;
    saveOrders();
    showStatusUpdateToast(`✓ Downpayment for order #${orderId} updated to ₱${parsedValue.toFixed(2)}.`);
    loadCustomerOrders();
}

function uploadOrderPaymentProof(orderId, input) {
    const file = input.files[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/jfif', 'image/png', 'image/gif', 'image/webp'];
    const validExtension = /\.(jpe?g|jfif|png|gif|webp)$/i.test(file.name);
    if (!validTypes.includes(file.type) && !validExtension) {
        alert('Please upload a valid image file.');
        input.value = '';
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB.');
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const order = appData.orders.find(item => item.id === orderId);
        if (!order || normalizePaymentMethod(order.paymentMethod) !== 'gcash') return;

        const targetAmount = Number(order.gcashDownpaymentAmount ?? ((Number(order.totalAmount || 0) / 2)));
        if (targetAmount <= 0) {
            order.gcashDownpaymentAmount = Number(order.totalAmount || 0) / 2;
        }

        order.gcashPaymentProof = event.target.result;
        order.paymentStatus = 'downpayment-received';
        saveOrders();
        addNotification('customer', `✓ Payment proof uploaded for order #${order.id}.`, order.id);
        saveNotifications();
        loadCustomerOrders();
        showStatusUpdateToast(`✓ Payment proof uploaded for order #${order.id}.`);
    };
    reader.readAsDataURL(file);
}

// ===== ADMIN FUNCTIONS =====

// Add new product to inventory table in real-time (with animation)
function addProductToInventoryTable(product, index) {
    const typeLabels = {
        'basketball': '🏀 Basketball Jersey',
        'volleyball': '🏐 Volleyball Jersey',
        'longsleeve': '👕 Longsleeve Warmer',
        'varsity': '🎓 Varsity Jacket',
        'rider': '🏍️ Rider Jersey',
        'tshirt': '👕 T-Shirt',
        'polo': '👔 Polo Shirt',
        'club': '⚽ Club Uniform',
        'organization': '🏢 Organization Uniform'
    };

    const row = document.createElement('tr');
    const typeDisplay = typeLabels[product.type] || product.type || 'N/A';
    
    // Add animation class
    row.className = 'new-product-row';
    
    row.innerHTML = `
        <td><img src="${product.image}" alt="${product.name}" class="product-thumbnail"></td>
        <td>${product.name}</td>
        <td>${typeDisplay}</td>
        <td>₱${product.price.toFixed(2)}</td>
        <td><strong>${product.stock}</strong></td>
        <td>
            <div class="action-buttons">
                <button class="btn-edit" onclick="editPrice(${index})" title="Edit Price">💰 Price</button>
                <button class="btn-edit" onclick="editProduct(${index})">Edit</button>
                <button class="btn-delete" onclick="deleteProduct(${index})">Delete</button>
            </div>
        </td>
    `;
    
    // Add to top of table with animation
    const adminProductsList = document.getElementById('adminProductsList');
    if (!adminProductsList) return;
    adminProductsList.insertBefore(row, adminProductsList.firstChild);
    
    // Trigger animation (highlight effect)
    setTimeout(() => {
        row.style.backgroundColor = '#4a7c59';
        row.style.transition = 'background-color 1.5s ease';
        setTimeout(() => {
            row.style.backgroundColor = '';
        }, 1500);
    }, 10);
}

// Handle Add Product with Image Upload
document.getElementById('addProductForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const uploadMessage = document.getElementById('uploadMessage');

    const productName = document.getElementById('productName').value;
    const type = document.getElementById('productType').value;
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value);
    const description = document.getElementById('productDescription').value;
    const imageFile = document.getElementById('productImage').files[0];
    
    // Get selected colors
    const selectedColorCheckboxes = document.querySelectorAll('input[name="productColors"]:checked');
    const availableColors = Array.from(selectedColorCheckboxes).map(cb => cb.value);

    if (!imageFile) {
        uploadMessage.className = 'message error';
        uploadMessage.textContent = 'Please select an image';
        uploadMessage.style.display = 'block';
        return;
    }
    
    if (availableColors.length === 0) {
        uploadMessage.className = 'message error';
        uploadMessage.textContent = 'Please select at least one color';
        uploadMessage.style.display = 'block';
        return;
    }

    prepareProductImage(imageFile).then(image => {
        const newProduct = {
            id: appData.products.length + 1,
            name: productName,
            type: type,
            price: price,
            stock: stock,
            description: description,
            image,
            availableColors: availableColors
        };

        console.log('Adding new product:', newProduct);
        appData.products.push(newProduct);
        console.log('Total products after add:', appData.products.length);
        saveProductsWithoutBlocking();
        
        // Add product to table INSTANTLY (real-time display)
        addProductToInventoryTable(newProduct, appData.products.length - 1);
        
        uploadMessage.className = 'message success';
        uploadMessage.textContent = '✓ Product added successfully! Total products: ' + appData.products.length;
        uploadMessage.style.display = 'block';
        
        // Reset form
        document.getElementById('addProductForm').reset();
        
        // Hide message after 2 seconds
        setTimeout(() => {
            uploadMessage.style.display = 'none';
        }, 2000);
    }).catch(error => {
        uploadMessage.className = 'message error';
        uploadMessage.textContent = error.message;
        uploadMessage.style.display = 'block';
    });
});

// Edit Product
function editProduct(index) {
    const product = appData.products[index];
    document.getElementById('productName').value = product.name;
    document.getElementById('productType').value = product.type;
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productStock').value = product.stock;
    document.getElementById('productDescription').value = product.description;
    
    // Scroll to form
    document.querySelector('.add-product-form').scrollIntoView({ behavior: 'smooth' });
    alert('Edit mode enabled. Update the form and submit to save changes.');
}

// Delete Product
function deleteProduct(index) {
    if (index < 0 || index >= appData.products.length) {
        alert('Invalid product index');
        return;
    }
    
    const productName = appData.products[index].name;
    if (confirm(`Are you sure you want to delete "${productName}"?`)) {
        appData.products.splice(index, 1);
        console.log('Product deleted. Remaining products:', appData.products.length);
        saveProductsWithoutBlocking();
        
        // Show success message
        const uploadMessage = document.getElementById('uploadMessage');
        if (uploadMessage) {
            uploadMessage.className = 'message success';
            uploadMessage.textContent = '✓ Product deleted successfully!';
            uploadMessage.style.display = 'block';
            setTimeout(() => {
                uploadMessage.style.display = 'none';
            }, 2000);
        }
    }
}

// Edit Product Price - Store the index globally
let currentEditPriceIndex = null;

function editPrice(index) {
    if (index < 0 || index >= appData.products.length) {
        alert('Invalid product index');
        return;
    }
    
    const product = appData.products[index];
    currentEditPriceIndex = index;
    
    // Set product info in modal
    document.getElementById('editProductInfo').textContent = `${product.name} (Current Price: ₱${product.price.toFixed(2)})`;
    document.getElementById('editPriceInput').value = product.price;
    document.getElementById('editPriceMessage').innerHTML = '';
    
    // Show modal
    document.getElementById('editPriceModal').style.display = 'block';
    
    // Focus on price input
    document.getElementById('editPriceInput').focus();
    document.getElementById('editPriceInput').select();
    
    console.log('Edit price modal opened for product index:', index);
}

function closeEditPriceModal() {
    document.getElementById('editPriceModal').style.display = 'none';
    currentEditPriceIndex = null;
    document.getElementById('editPriceMessage').innerHTML = '';
}

function saveEditedPrice() {
    if (currentEditPriceIndex === null || currentEditPriceIndex < 0) {
        alert('No product selected');
        return;
    }
    
    const newPrice = parseFloat(document.getElementById('editPriceInput').value);
    const messageDiv = document.getElementById('editPriceMessage');
    
    if (isNaN(newPrice) || newPrice < 0) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Please enter a valid price (must be a number ≥ 0)';
        messageDiv.style.display = 'block';
        return;
    }
    
    const product = appData.products[currentEditPriceIndex];
    const oldPrice = product.price;
    
    // Update price
    product.price = newPrice;
    console.log(`Product "${product.name}" price updated: ₱${oldPrice.toFixed(2)} → ₱${newPrice.toFixed(2)}`);
    
    // Save to storage
    saveProductsWithoutBlocking();
    
    // Show success message in modal
    messageDiv.className = 'message success';
    messageDiv.textContent = `✓ Price updated successfully! ₱${oldPrice.toFixed(2)} → ₱${newPrice.toFixed(2)}`;
    messageDiv.style.display = 'block';
    
    // Refresh table
    
    // Close modal after 1.5 seconds
    setTimeout(() => {
        closeEditPriceModal();
    }, 1500);
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('editPriceModal');
    if (event.target === modal) {
        closeEditPriceModal();
    }
}

// ===== ADMIN PRODUCT INVENTORY MANAGEMENT =====

// Load Admin Inventory Products
function loadAdminInventoryProducts() {
    const adminProductsList = document.getElementById('adminProductsList');
    if (!adminProductsList) return;
    
    adminProductsList.innerHTML = '';
    
    const typeLabels = {
        'basketball': '🏀 Basketball Jersey',
        'volleyball': '🏐 Volleyball Jersey',
        'longsleeve': '👕 Longsleeve Warmer',
        'varsity': '🎓 Varsity Jacket',
        'rider': '🏍️ Rider Jersey',
        'tshirt': '👕 T-Shirt',
        'polo': '👔 Polo Shirt',
        'club': '⚽ Club Uniform',
        'organization': '🏢 Organization Uniform'
    };
    
    if (appData.products.length === 0) {
        adminProductsList.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No products added yet</td></tr>';
        return;
    }
    
    appData.products.forEach((product, index) => {
        const typeDisplay = typeLabels[product.type] || product.type || 'N/A';
        const stockStatus = product.stock > 0 ? 'In Stock' : 'Out of Stock';
        const statusClass = product.stock > 0 ? 'in-stock' : 'out-of-stock';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><img src="${product.image}" alt="${product.name}" class="product-thumbnail" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;"></td>
            <td>${product.name}</td>
            <td>${typeDisplay}</td>
            <td>₱${product.price.toFixed(2)}</td>
            <td><strong>${product.stock}</strong></td>
            <td><span class="status-badge ${statusClass}">${stockStatus}</span></td>
            <td>
                <div class="action-buttons" style="display: flex; gap: 5px; flex-wrap: wrap;">
                    <button class="btn-sm" onclick="openEditProductModal(${index})" style="background-color: #5a9fd4; padding: 6px 10px; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">✏️ Edit</button>
                    <button class="btn-sm" onclick="toggleProductStock(${index})" style="background-color: #d4a255; padding: 6px 10px; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">${product.stock > 0 ? '📦 Out Stock' : '✅ Restock'}</button>
                    <button class="btn-sm" onclick="deleteAdminProduct(${index})" style="background-color: #d45a5a; padding: 6px 10px; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">🗑️ Delete</button>
                </div>
            </td>
        `;
        adminProductsList.appendChild(row);
    });
}

// Open Edit Product Modal
let currentEditProductIndex = null;

function openEditProductModal(index) {
    if (index < 0 || index >= appData.products.length) {
        alert('Invalid product index');
        return;
    }
    
    const product = appData.products[index];
    currentEditProductIndex = index;
    
    // Populate form
    document.getElementById('editProductName').value = product.name;
    document.getElementById('editProductType').value = product.type;
    document.getElementById('editProductPrice').value = product.price;
    document.getElementById('editProductStock').value = product.stock;
    document.getElementById('editProductDescription').value = product.description || '';
    
    // Show current product image preview
    const imagePreview = document.getElementById('editProductImagePreview');
    imagePreview.src = product.image;
    
    // Reset file input
    document.getElementById('editProductImage').value = '';
    
    // Clear message
    const messageDiv = document.getElementById('editProductMessage');
    messageDiv.textContent = '';
    messageDiv.style.display = 'none';
    
    // Set available colors checkboxes
    const colorCheckboxes = document.querySelectorAll('input[name="editProductColors"]');
    const availableColors = product.availableColors || [];
    colorCheckboxes.forEach(checkbox => {
        checkbox.checked = availableColors.includes(checkbox.value);
    });
    
    // Add file input change listener for image preview
    const fileInput = document.getElementById('editProductImage');
    fileInput.onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                imagePreview.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };
    
    // Show modal
    document.getElementById('editProductModal').style.display = 'block';
}

// Close Edit Product Modal
function closeEditProductModal() {
    document.getElementById('editProductModal').style.display = 'none';
    currentEditProductIndex = null;
}

// Save Product Edit
function saveProductEdit() {
    if (currentEditProductIndex === null) {
        alert('No product selected');
        return;
    }
    
    const name = document.getElementById('editProductName').value.trim();
    const type = document.getElementById('editProductType').value;
    const price = parseFloat(document.getElementById('editProductPrice').value);
    const stock = parseInt(document.getElementById('editProductStock').value);
    const description = document.getElementById('editProductDescription').value.trim();
    const imageFile = document.getElementById('editProductImage').files[0];
    
    // Get selected colors
    const selectedColorCheckboxes = document.querySelectorAll('input[name="editProductColors"]:checked');
    const availableColors = Array.from(selectedColorCheckboxes).map(cb => cb.value);
    
    const messageDiv = document.getElementById('editProductMessage');
    
    // Validation
    if (!name) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Product name is required';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (!type) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Product type is required';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (availableColors.length === 0) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Please select at least one color';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (isNaN(price) || price < 0) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Please enter a valid price';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (isNaN(stock) || stock < 0) {
        messageDiv.className = 'message error';
        messageDiv.textContent = '❌ Please enter a valid stock amount';
        messageDiv.style.display = 'block';
        return;
    }
    
    // If an image file is selected, convert it to a compact shared image.
    if (imageFile) {
        prepareProductImage(imageFile).then(image => {
            const product = appData.products[currentEditProductIndex];
            product.name = name;
            product.type = type;
            product.price = price;
            product.stock = stock;
            product.description = description;
            product.image = image;
            product.availableColors = availableColors;
            
            // Save to storage
            saveProductsWithoutBlocking();
            
            // Show success message
            messageDiv.className = 'message success';
            messageDiv.textContent = '✓ Product updated successfully!';
            messageDiv.style.display = 'block';
            
            // Reload inventory table
            loadAdminInventoryProducts();
            
            // Close modal after 1.5 seconds
            setTimeout(() => {
                closeEditProductModal();
            }, 1500);
        }).catch(error => {
            messageDiv.className = 'message error';
            messageDiv.textContent = error.message;
            messageDiv.style.display = 'block';
        });
    } else {
        // Update product without changing image
        const product = appData.products[currentEditProductIndex];
        product.name = name;
        product.type = type;
        product.price = price;
        product.stock = stock;
        product.description = description;
        product.availableColors = availableColors;
        
        // Save to storage
        saveProductsWithoutBlocking();
        
        // Show success message
        messageDiv.className = 'message success';
        messageDiv.textContent = '✓ Product updated successfully!';
        messageDiv.style.display = 'block';
        
        // Reload inventory table
        loadAdminInventoryProducts();
        
        // Close modal after 1.5 seconds
        setTimeout(() => {
            closeEditProductModal();
        }, 1500);
    }
}

// Toggle Product Stock (Mark as Out of Stock / Restock)
function toggleProductStock(index) {
    if (index < 0 || index >= appData.products.length) {
        alert('Invalid product index');
        return;
    }
    
    const product = appData.products[index];
    
    if (product.stock > 0) {
        // Mark as out of stock
        if (confirm(`Mark "${product.name}" as out of stock?`)) {
            product.stock = 0;
            saveProductsWithoutBlocking();
            loadAdminInventoryProducts();
            alert('✓ Product marked as out of stock');
        }
    } else {
        // Restock - Ask for quantity
        const quantity = prompt('Enter restock quantity:', '10');
        if (quantity !== null && !isNaN(quantity) && quantity > 0) {
            product.stock = parseInt(quantity);
            saveProductsWithoutBlocking();
            loadAdminInventoryProducts();
            alert(`✓ Product restocked with ${quantity} units`);
        }
    }
}

// Delete Admin Product
function deleteAdminProduct(index) {
    if (index < 0 || index >= appData.products.length) {
        alert('Invalid product index');
        return;
    }
    
    const product = appData.products[index];
    if (confirm(`Are you sure you want to delete "${product.name}"? This cannot be undone.`)) {
        appData.products.splice(index, 1);
        saveProductsWithoutBlocking();
        loadAdminInventoryProducts();
        alert('✓ Product deleted successfully');
    }
}

// Close modal when clicking outside
window.onload = function() {
    const editProductModal = document.getElementById('editProductModal');
    if (editProductModal) {
        window.addEventListener('click', function(event) {
            if (event.target === editProductModal) {
                closeEditProductModal();
            }
        });
    }
}

// Load Admin Orders
function loadAdminOrders() {
    loadOrders();
    renderAdminOrders();
    fetchSharedOrders().then(sharedOrders => {
        const sharedIds = new Set(sharedOrders.map(order => String(order.id)));
        const localOnlyOrders = appData.orders.filter(order => !sharedIds.has(String(order.id)));
        appData.orders = [...sharedOrders, ...localOnlyOrders];
        saveOrders();
        localOnlyOrders.forEach(order => {
            saveOrderToSharedServer(order).catch(error => {
                console.error('Unable to migrate local order to shared storage:', error);
            });
        });
        renderAdminOrders();
    }).catch(error => {
        console.warn('Using local orders because shared orders could not be loaded:', error);
    });
}

function renderAdminOrders() {
    const ordersList = document.getElementById('adminOrdersList');
    if (!ordersList) return;
    ordersList.innerHTML = '';

    const activeOrders = [...appData.orders]
        .filter(order => order.status !== 'completed' && order.status !== 'delivered')
        .sort((firstOrder, secondOrder) => {
            const firstValue = Number(firstOrder.id) || 0;
            const secondValue = Number(secondOrder.id) || 0;
            return secondValue - firstValue;
        });

    if (activeOrders.length === 0) {
        ordersList.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No active or cancelled orders yet</td></tr>';
        return;
    }

    activeOrders.forEach(order => {
        // Build items list with images and customization details
        const itemsList = order.items.map(item => {
            let customStr = '';
            if (item.customization) {
                customStr = '<br><small style="color: #d4af37;">';
                if (item.customization.size) customStr += `📏 ${item.customization.size}`;
                if (item.customization.name || item.customization.number) {
                    if (item.customization.size) customStr += ' | ';
                    if (item.customization.name) customStr += `👤 ${item.customization.name}`;
                    if (item.customization.name && item.customization.number) customStr += ' ';
                    if (item.customization.number) customStr += `🔢 #${item.customization.number}`;
                }
                customStr += '</small>';
            }
            
            // Add product image if available
            let imgHtml = '';
            if (item.image) {
                imgHtml = `<img src="${item.image}" alt="${item.name}" style="width: 60px; height: 60px; border-radius: 5px; margin-bottom: 8px;"><br>`;
            }
            
            return `${imgHtml}<strong>${item.name}</strong> (Qty: ${item.quantity}) - ₱${(item.price * item.quantity).toFixed(2)}${customStr}`;
        }).join('<br><br>');
        
        // Ensure order data exists
        const customerName = order.customerName || 'N/A';
        const customerEmail = order.customerEmail || 'N/A';
        const customerPhone = order.customerPhone || 'N/A';
        const customerAddress = order.customerAddress || 'N/A';
        const totalAmount = order.totalAmount || 0;
        const paymentMethod = normalizePaymentMethod(order.paymentMethod);
        const paymentProofHtml = paymentMethod === 'gcash'
            ? order.gcashPaymentProof
                ? `<div style="margin-top: 8px; color: #4caf50;"><strong>GCash Proof:</strong> Uploaded<br><a href="${order.gcashPaymentProof}" target="_blank" rel="noopener"><img src="${order.gcashPaymentProof}" alt="GCash payment proof for order #${order.id}" style="width: 90px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid #4caf50; margin-top: 5px;"></a></div>`
                : '<div style="margin-top: 8px; color: #ffb74d;"><strong>GCash Proof:</strong> Waiting for customer upload</div>'
            : '';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>#${order.id}</strong></td>
            <td>
                <strong>${customerName}</strong><br>
                <small>📧 ${customerEmail}</small><br>
                <small>📱 ${customerPhone}</small><br>
                <small>📍 ${customerAddress}</small>
            </td>
            <td style="max-width: 300px;">${itemsList}</td>
            <td><strong>₱${totalAmount.toFixed(2)}</strong></td>
            <td><span class="order-status ${order.status}">${order.status.toUpperCase().replace('-', ' ')}</span></td>
            <td>${order.date}</td>
            <td>
                <div><strong>Payment:</strong> ${paymentMethod.toUpperCase()}</div>
                ${paymentProofHtml}
                <select class="status-dropdown" onchange="changeOrderStatus(${order.id}, this.value)">
                    <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
                    <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                    <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
                <button class="btn btn-small" onclick="viewOrderDetails(${JSON.stringify(order).replace(/"/g, '&quot;')})" style="margin-top: 8px; background: #4caf50; padding: 4px 8px; font-size: 0.85em; width: 100%;">👁️ View</button>
            </td>
        `;
        document.getElementById('adminOrdersList').appendChild(row);
    });
}

// Change Order Status
function changeOrderStatus(orderId, newStatus) {
    const order = appData.orders.find(o => o.id === orderId);
    if (!order) return;

    const oldStatus = order.status;
    order.status = newStatus;
    
    // Save to localStorage
    saveOrders();

    if (isOrderInPurchaseHistory(order)) {
        saveOrderToHistory({ ...order });
    }
    
    // Add notification for customer
    const statusMessages = {
        'processing': `Your order #${orderId} is now being processed`,
        'completed': `Your order #${orderId} has been completed and is ready!`,
        'delivered': `Your order #${orderId} has been delivered`,
        'cancelled': `Your order #${orderId} has been cancelled`
    };
    
    if (statusMessages[newStatus]) {
    addNotification('customer', statusMessages[newStatus], orderId);
    saveNotifications();

    console.log('📧 Calling sendOrderNotification:', {
        orderId: orderId,
        customerEmail: order.customerEmail,
        newStatus: newStatus
    });

    sendOrderNotification(order, newStatus);
}
    
    // Real-time update for admin - highlight the changed row
    const orderRows = document.querySelectorAll('tr');
    orderRows.forEach(row => {
        const orderIdCell = row.querySelector('td');
        if (orderIdCell && orderIdCell.textContent.includes('#' + orderId)) {
            // Add flash animation
            row.style.backgroundColor = '#4a7c59';
            row.style.transition = 'background-color 0.5s ease';
            setTimeout(() => {
                row.style.backgroundColor = '';
            }, 1000);
        }
    });
    
    // Show real-time toast notification
    showStatusUpdateToast(`Order #${orderId} status changed to ${newStatus.toUpperCase()}`);
    
    // Reload orders display for complete accuracy
    loadAdminOrders();
    
    // Update customer view if they have the Notifications tab open
    setTimeout(() => {
        if (document.getElementById('notificationsSection').style.display === 'block') {
            loadCustomerNotifications();
        }
    }, 100);
}

// Update Order Status (legacy function - kept for compatibility)
function updateOrderStatus(orderId) {
    const order = appData.orders.find(o => o.id === orderId);
    if (!order) return;

    const statuses = ['design-approval', 'printing', 'completed'];
    const currentIndex = statuses.indexOf(order.status);
    const nextStatus = statuses[(currentIndex + 1) % statuses.length];

    order.status = nextStatus;
    
    // Update in history if exists
    let history = JSON.parse(localStorage.getItem('orderHistory')) || [];
    const historyOrder = history.find(h => h.id === orderId);
    if (historyOrder) {
        historyOrder.status = nextStatus;
        localStorage.setItem('orderHistory', JSON.stringify(history));
    }
    
    // Send notification
    sendOrderNotification(order, nextStatus);
    
    loadAdminOrders();
    alert(`Order #${orderId} status updated to: ${nextStatus.toUpperCase().replace('-', ' ')}\n\nNotification sent to customer`);
}

// View Order Details Modal
function viewOrderDetails(orderStr) {
    try {
        // Handle JSON string (from button onclick)
        let order = orderStr;
        if (typeof orderStr === 'string') {
            order = JSON.parse(decodeURIComponent(orderStr));
        }
        
        // Build the order details HTML
        let itemsHtml = '';
        if (order.items && order.items.length > 0) {
            itemsHtml = order.items.map(item => {
                let customStr = '';
                if (item.customization) {
                    customStr = '<br><small style="color: #888;">';
                    if (item.customization.size) customStr += `📏 Size: ${item.customization.size}`;
                    if (item.customization.name || item.customization.number) {
                        if (item.customization.size) customStr += ' | ';
                        if (item.customization.name) customStr += `👤 Name: ${item.customization.name}`;
                        if (item.customization.name && item.customization.number) customStr += ' ';
                        if (item.customization.number) customStr += `🔢 #${item.customization.number}`;
                    }
                    customStr += '</small>';
                }
                return `<div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #eee;">
                    <strong>${item.name}</strong> (Qty: ${item.quantity})<br>
                    Price: ₱${(item.price).toFixed(2)} each = ₱${(item.price * item.quantity).toFixed(2)}
                    ${customStr}
                </div>`;
            }).join('');
        }
        
        // GCash QR Code display
        let qrCodeHtml = '';
        if (order.gcashQRCode) {
            qrCodeHtml = `<div style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 15px;">
                <h3>💳 GCash Payment Proof</h3>
                <img src="${order.gcashQRCode}" alt="GCash QR Code" style="max-width: 300px; height: auto; border: 1px solid #ddd; border-radius: 5px;">
            </div>`;
        }
        
        const contentHtml = `
            <div style="padding: 15px 0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div>
                        <strong>Order ID:</strong> #${order.id}
                    </div>
                    <div>
                        <strong>Date:</strong> ${order.date}
                    </div>
                    <div>
                        <strong>Status:</strong> <span class="order-status ${order.status}">${order.status.toUpperCase().replace('-', ' ')}</span>
                    </div>
                    <div>
                        <strong>Total:</strong> ₱${order.totalAmount.toFixed(2)}
                    </div>
                </div>
                
                <div style="background: #1f1f1f; color: #f4f4f4; padding: 16px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #3a3a3a;">
                    <h3 style="color: #f4f4f4; margin-top: 0; margin-bottom: 10px;">Customer Information</h3>
                    <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Name:</strong> ${order.customerName || 'N/A'}</div>
                    <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Email:</strong> ${order.customerEmail || 'N/A'}</div>
                    <div style="margin-bottom: 6px;"><strong style="color: #d4af37;">Phone:</strong> ${order.customerPhone || 'N/A'}</div>
                    <div><strong style="color: #d4af37;">Address:</strong> ${order.customerAddress || 'N/A'}</div>
                </div>
                
                <div>
                    <h3>Order Items</h3>
                    ${itemsHtml}
                </div>
                
                ${qrCodeHtml}
            </div>
        `;
        
        document.getElementById('orderDetailsContent').innerHTML = contentHtml;
        document.getElementById('orderDetailsModal').style.display = 'block';
    } catch (e) {
        console.error('Error viewing order details:', e);
        alert('Error loading order details');
    }
}

function closeOrderDetailsModal() {
    document.getElementById('orderDetailsModal').style.display = 'none';
}

// Send Order Notification
function sendOrderNotification(order, newStatus) {
    const statusMessages = {
        'processing': 'Your order is now being processed.',
        'completed': 'Great news! Your order has been completed and is ready for delivery.',
        'delivered': 'Your order has been delivered.',
        'cancelled': 'Your order has been cancelled.'
    };

    const notificationData = {
        orderId: order.id,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        status: newStatus,
        message: statusMessages[newStatus] || 'Your order status has been updated.',
        timestamp: new Date().toLocaleString(),
        notificationType: 'order-update'
    };

    // Save notification to local storage
    let notifications = JSON.parse(localStorage.getItem('notifications')) || [];
    notifications.push(notificationData);
    localStorage.setItem('notifications', JSON.stringify(notifications));

    // Send email notification to customer
    console.log('📧 Sending order email:', notificationData);

    fetch('/KingPinSystem/api/notification/order-status.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(notificationData)
    })
    .then(response => response.json().then(result => ({
        ok: response.ok,
        result: result
    })))
    .then(({ ok, result }) => {
        if (!ok) {
            throw new Error(result.error || 'Notification request failed');
        }

        console.log('✅ Order email result:', result);
    })
    .catch(error => {
        console.error('❌ Order email failed:', error);
        showStatusUpdateToast('Order updated, but email could not be sent');
    });
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('productModal');
    if (event.target === modal) {
        closeProductModal();
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    updateCartCount();
    setupHistorySearch();
});

// ===== MEASUREMENTS & SIZE CHART =====

const sizeMeasurementMap = {
    XS: { chest: 80, waist: 70, length: 160 },
    S: { chest: 85, waist: 75, length: 165 },
    M: { chest: 90, waist: 80, length: 170 },
    L: { chest: 95, waist: 85, length: 175 },
    XL: { chest: 100, waist: 90, length: 180 },
    '2XL': { chest: 105, waist: 95, length: 185 },
    XXL: { chest: 105, waist: 95, length: 185 },
    '3XL': { chest: 110, waist: 100, length: 190 }
};

function fillMeasurementsFromSize(size) {
    if (!size) return;

    const normalized = String(size).trim().toUpperCase();
    const measurements = sizeMeasurementMap[normalized] || sizeMeasurementMap[normalized.replace('XXL', '2XL')];

    if (!measurements) return;

    const chestInput = document.getElementById('chestMeasurement');
    const waistInput = document.getElementById('waistMeasurement');
    const lengthInput = document.getElementById('lengthMeasurement');
    const checkoutSize = document.getElementById('checkoutSize');

    if (chestInput) chestInput.value = measurements.chest;
    if (waistInput) waistInput.value = measurements.waist;
    if (lengthInput) lengthInput.value = measurements.length;
    if (checkoutSize) checkoutSize.value = size;

    const suggestionDiv = document.getElementById('suggestedSize');
    const sizeText = document.getElementById('suggestedSizeText');
    const sizeNotes = document.getElementById('sizeNotes');

    if (suggestionDiv && sizeText && sizeNotes) {
        sizeText.textContent = String(size).toUpperCase();
        sizeNotes.textContent = `Selected size ${String(size).toUpperCase()} matches the standard chest ${measurements.chest}cm, waist ${measurements.waist}cm, and length ${measurements.length}cm.`;
        suggestionDiv.style.display = 'block';
    }
}

function syncOrderSelectionFromCart() {
    if (!appData.cart || appData.cart.length === 0) return;

    const checkoutSize = document.getElementById('checkoutSize');
    const checkoutColor = document.getElementById('checkoutColor');
    const firstItem = appData.cart[0];
    const selectedSize = firstItem.customization?.size || '';
    const selectedColor = firstItem.customization?.color || '';

    if (checkoutSize && selectedSize) {
        checkoutSize.value = selectedSize;
        fillMeasurementsFromSize(selectedSize);
    }

    if (checkoutColor && selectedColor) {
        checkoutColor.value = selectedColor;
    }
}

// Size Chart Database
const sizeChart = {
    shirts: {
        XS: { chest: '80-85', waist: '70-75', length: '160-165' },
        S: { chest: '85-90', waist: '75-80', length: '165-170' },
        M: { chest: '90-95', waist: '80-85', length: '170-175' },
        L: { chest: '95-100', waist: '85-90', length: '175-180' },
        XL: { chest: '100-105', waist: '90-95', length: '180-185' },
        XXL: { chest: '105-110', waist: '95-100', length: '185-190' }
    },
    pants: {
        XS: { chest: '75-80', waist: '65-70', length: '165-170' },
        S: { chest: '80-85', waist: '70-75', length: '170-175' },
        M: { chest: '85-90', waist: '75-80', length: '175-180' },
        L: { chest: '90-95', waist: '80-85', length: '180-185' },
        XL: { chest: '95-100', waist: '85-90', length: '185-190' },
        XXL: { chest: '100-105', waist: '90-95', length: '190-195' }
    }
};

// Calculate Suggested Size
function calculateSuggestedSize() {
    const chest = parseFloat(document.getElementById('chestMeasurement').value);
    const waist = parseFloat(document.getElementById('waistMeasurement').value);
    const length = parseFloat(document.getElementById('lengthMeasurement').value);

    if (!chest || !waist || !length) {
        alert('Please enter all measurements');
        return;
    }

    // Simple size calculation logic
    let suggestedSize = 'M'; // Default

    if (chest < 87.5 && waist < 77.5) {
        suggestedSize = chest < 82.5 ? 'XS' : 'S';
    } else if (chest < 97.5 && waist < 87.5) {
        suggestedSize = 'M';
    } else if (chest < 102.5 && waist < 92.5) {
        suggestedSize = 'L';
    } else {
        suggestedSize = chest > 105 ? 'XXL' : 'XL';
    }

    // Display suggestion
    const suggestionDiv = document.getElementById('suggestedSize');
    const sizeText = document.getElementById('suggestedSizeText');
    const sizeNotes = document.getElementById('sizeNotes');

    sizeText.textContent = suggestedSize;
    sizeNotes.textContent = `Based on your measurements (Chest: ${chest}cm, Waist: ${waist}cm, Length: ${length}cm), we recommend size ${suggestedSize} for optimal fit and comfort.`;
    
    suggestionDiv.style.display = 'block';
}

// Save Order to History
function saveOrderToHistory(orderData, updateCustomerProfile = true) {
    let history = JSON.parse(localStorage.getItem('orderHistory')) || [];
    const existingIndex = history.findIndex(item => Number(item.id) === Number(orderData.id));

    if (existingIndex >= 0) {
        history[existingIndex] = orderData;
    } else {
        history.push(orderData);
    }

    try {
        localStorage.setItem('orderHistory', JSON.stringify(history.slice(-200)));
    } catch (error) {
        console.warn('orderHistory quota exceeded; trimming older history entries.', error);
        localStorage.setItem('orderHistory', JSON.stringify(history.slice(-50)));
    }
    
    if (updateCustomerProfile) {
        saveCustomerProfile(orderData);
    }
}

// Save Customer Profile
function saveCustomerProfile(orderData) {
    let customers = JSON.parse(localStorage.getItem('customerDatabase')) || [];
    
    // Check if customer already exists
    const existingCustomer = customers.find(c => c.email === orderData.customerEmail);
    
    if (existingCustomer) {
        // Update existing customer
        existingCustomer.name = orderData.customerName;
        existingCustomer.phone = orderData.customerPhone;
        existingCustomer.address = orderData.customerAddress;
        existingCustomer.lastOrderDate = orderData.date;
        existingCustomer.totalOrders = (existingCustomer.totalOrders || 0) + 1;
        existingCustomer.totalSpent = (existingCustomer.totalSpent || 0) + orderData.totalAmount;
        
        // Update measurements if provided
        if (orderData.measurements && orderData.measurements.chest !== 'Not provided') {
            existingCustomer.measurements = orderData.measurements;
        }
        
        // Add to order history
        existingCustomer.orderHistory = existingCustomer.orderHistory || [];
        existingCustomer.orderHistory.push({
            orderId: orderData.id,
            date: orderData.date,
            amount: orderData.totalAmount,
            status: orderData.status
        });
        
        // Keep only last 10 orders
        if (existingCustomer.orderHistory.length > 10) {
            existingCustomer.orderHistory = existingCustomer.orderHistory.slice(-10);
        }
    } else {
        // Create new customer
        const newCustomer = {
            email: orderData.customerEmail,
            name: orderData.customerName,
            phone: orderData.customerPhone,
            address: orderData.customerAddress,
            measurements: orderData.measurements || {},
            preferences: {
                favoriteCategories: [],
                favoriteProducts: []
            },
            totalOrders: 1,
            totalSpent: orderData.totalAmount,
            registrationDate: orderData.date,
            lastOrderDate: orderData.date,
            orderHistory: [{
                orderId: orderData.id,
                date: orderData.date,
                amount: orderData.totalAmount,
                status: orderData.status
            }]
        };
        customers.push(newCustomer);
    }
    
    localStorage.setItem('customerDatabase', JSON.stringify(customers));
}

// ===== ADMIN: HISTORY MANAGEMENT =====

// Load History Tab - Update
function updateShowAdminTab() {
    // This function is deprecated - using main showAdminTab instead
}

// Load Customers Table
function loadCustomersTable() {
    const customersList = document.getElementById('customersList');
    const customers = JSON.parse(localStorage.getItem('customerDatabase')) || [];

    customersList.innerHTML = '';

    if (customers.length === 0) {
        customersList.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No customers yet</td></tr>';
        return;
    }

    customers.forEach((customer, index) => {
        const row = document.createElement('tr');
        const measurements = customer.measurements ? 
            `C: ${customer.measurements.chest}, W: ${customer.measurements.waist}, L: ${customer.measurements.length}` : 
            'Not provided';
        
        row.innerHTML = `
            <td>${customer.name}</td>
            <td>${customer.email}</td>
            <td>${customer.phone}</td>
            <td><strong>${customer.totalOrders}</strong></td>
            <td>₱${customer.totalSpent.toFixed(2)}</td>
            <td>${customer.lastOrderDate}</td>
            <td style="font-size: 0.85em;">${measurements}</td>
            <td>
                <button class="btn-edit" onclick="viewCustomerDetails(${index})">View</button>
            </td>
        `;
        customersList.appendChild(row);
    });

    setupCustomerSearch();
}

// View Customer Details
function viewCustomerDetails(index) {
    const customers = JSON.parse(localStorage.getItem('customerDatabase')) || [];
    const customer = customers[index];
    
    const orderHistory = customer.orderHistory ? 
        customer.orderHistory.map(o => `#${o.orderId} (${o.date}: ₱${o.amount.toFixed(2)})`).join(', ') :
        'No orders';
    
    alert(`CUSTOMER PROFILE\n\nName: ${customer.name}\nEmail: ${customer.email}\nPhone: ${customer.phone}\nAddress: ${customer.address}\n\nMeasurements:\nChest: ${customer.measurements?.chest || 'N/A'}cm\nWaist: ${customer.measurements?.waist || 'N/A'}cm\nLength: ${customer.measurements?.length || 'N/A'}cm\n\nTotal Orders: ${customer.totalOrders}\nTotal Spent: ₱${customer.totalSpent.toFixed(2)}\nReg Date: ${customer.registrationDate}\nLast Order: ${customer.lastOrderDate}`);
}

// Setup Customer Search
function setupCustomerSearch() {
    const searchInput = document.getElementById('customerSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const rows = document.getElementById('customersList').querySelectorAll('tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        });
    }
}

// Export Customers to CSV
function exportCustomersToCSV() {
    const customers = JSON.parse(localStorage.getItem('customerDatabase')) || [];

    if (customers.length === 0) {
        alert('No customers to export');
        return;
    }

    let csv = 'Name,Email,Phone,Address,Total Orders,Total Spent,Measurements,Registration Date\n';

    customers.forEach(customer => {
        const measurements = customer.measurements ? 
            `Chest:${customer.measurements.chest}cm Waist:${customer.measurements.waist}cm Length:${customer.measurements.length}cm` :
            'Not provided';
        csv += `"${customer.name}","${customer.email}","${customer.phone}","${customer.address}",${customer.totalOrders},${customer.totalSpent},"${measurements}","${customer.registrationDate}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `customers-${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    alert('Customers exported successfully!');
}

// Load History Table
function loadHistoryTable() {
    const historyList = document.getElementById('historyList');
    const storedHistory = JSON.parse(localStorage.getItem('orderHistory')) || [];
    const liveCompletedOrders = (appData.orders || [])
        .filter(order => isOrderInPurchaseHistory(order))
        .map(order => ({ ...order }));
    const history = [
        ...storedHistory,
        ...liveCompletedOrders.filter(order => !storedHistory.some(item => Number(item.id) === Number(order.id)))
    ];
    
    const selectedYear = document.getElementById('yearSelector').value;
    const selectedMonth = document.getElementById('monthSelector').value;

    historyList.innerHTML = '';

    if (history.length === 0) {
        historyList.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">No purchase history yet</td></tr>';
        return;
    }

    // Filter orders by year and month if selected
    let filteredHistory = history.filter(order => {
        const orderDate = new Date(order.date);
        const orderYear = String(orderDate.getFullYear());
        const orderMonth = String(orderDate.getMonth() + 1).padStart(2, '0');
        
        const yearMatch = !selectedYear || orderYear === selectedYear;
        const monthMatch = selectedMonth === 'all' || orderMonth === selectedMonth;
        
        return yearMatch && monthMatch;
    });

    if (filteredHistory.length === 0) {
        const yearText = selectedYear ? ` in ${selectedYear}` : '';
        const monthText = selectedMonth !== 'all' ? ` for ${new Date(2000, parseInt(selectedMonth) - 1).toLocaleString('default', { month: 'long' })}` : '';
        historyList.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;">No orders${monthText}${yearText}</td></tr>`;
        return;
    }

    // Sort by date (newest first)
    filteredHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    filteredHistory.forEach(order => {
        const itemsList = order.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${order.id}</td>
            <td>${order.customerName}</td>
            <td>${order.customerEmail}</td>
            <td>${itemsList}</td>
            <td>₱${order.totalAmount.toFixed(2)}</td>
            <td><span class="order-status ${order.status}">${order.status}</span></td>
            <td>${order.date}</td>
            <td>${order.customerAddress}</td>
        `;
        historyList.appendChild(row);
    });
}

// Search History
function setupHistorySearch() {
    const searchInput = document.getElementById('historySearch');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const historyList = document.getElementById('historyList');
            const rows = historyList.querySelectorAll('tr');

            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        });
    }
}

// Export History to CSV
function exportHistoryToCSV() {
    const history = JSON.parse(localStorage.getItem('orderHistory')) || [];

    if (history.length === 0) {
        alert('No history to export');
        return;
    }

    let csv = 'Order ID,Customer Name,Email,Products,Total Amount,Status,Date,Address\n';

    history.forEach(order => {
        const itemsList = order.items.map(item => `${item.name} (x${item.quantity})`).join('; ');
        csv += `${order.id},"${order.customerName}","${order.customerEmail}","${itemsList}",${order.totalAmount},"${order.status}","${order.date}","${order.customerAddress}"\n`;
    });

    // Create a blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `order-history-${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    alert('History exported successfully!');
}

// ===== ADMIN: REPORTS & ANALYTICS =====

function getReportOrders() {
    const storedHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    const ordersById = new Map();

    [...storedHistory, ...(appData.orders || [])].forEach(order => {
        if (order && order.id != null) {
            ordersById.set(String(order.id), order);
        }
    });

    return [...ordersById.values()];
}

function getSoldOrders() {
    return getReportOrders().filter(order => ['completed', 'delivered'].includes(order.status));
}

// Generate Reports
function generateReports() {
    loadOrders();
    const allOrders = getReportOrders();
    const soldOrders = getSoldOrders();

    // Calculate metrics
    const totalSales = soldOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const totalOrders = soldOrders.length;
    const uniqueCustomers = new Set(soldOrders.map(order => order.customerEmail)).size;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Update report cards
    document.getElementById('totalSales').textContent = totalSales.toFixed(2);
    document.getElementById('totalOrders').textContent = totalOrders;
    document.getElementById('totalCustomers').textContent = uniqueCustomers;
    document.getElementById('avgOrderValue').textContent = avgOrderValue.toFixed(2);

    // Generate top products report
    generateTopProductsReport(soldOrders);

    // Generate status report
    generateStatusReport(allOrders);
}

// Generate Top Products Report
function generateTopProductsReport(orders) {
    const productSales = {};

    orders.forEach(order => {
        order.items.forEach(item => {
            if (!productSales[item.name]) {
                productSales[item.name] = { count: 0, revenue: 0 };
            }
            productSales[item.name].count += item.quantity;
            productSales[item.name].revenue += item.price * item.quantity;
        });
    });

    const sorted = Object.entries(productSales)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 10);

    const topProductsList = document.getElementById('topProductsList');
    topProductsList.innerHTML = '';

    sorted.forEach(([productName, data]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${productName}</td>
            <td>${data.count}</td>
            <td>₱${data.revenue.toFixed(2)}</td>
        `;
        topProductsList.appendChild(row);
    });
}

// Generate Status Report
function generateStatusReport(orders) {
    const statusData = {};

    orders.forEach(order => {
        const status = order.status || 'pending';
        if (!statusData[status]) {
            statusData[status] = { count: 0, revenue: 0 };
        }
        statusData[status].count += 1;
        statusData[status].revenue += order.totalAmount;
    });

    const statusList = document.getElementById('statusList');
    statusList.innerHTML = '';

    Object.entries(statusData).forEach(([status, data]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="order-status ${status}">${status.toUpperCase()}</span></td>
            <td>${data.count}</td>
            <td>₱${data.revenue.toFixed(2)}</td>
        `;
        statusList.appendChild(row);
    });
}

// Generate Full Report (PDF) - Basic implementation
function generateFullReport() {
    loadOrders();
    const allOrders = getReportOrders();
    const soldOrders = getSoldOrders();

    if (allOrders.length === 0) {
        alert('No data to generate report');
        return;
    }

    const reportDate = new Date().toLocaleDateString();
    const totalSales = soldOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const totalOrders = soldOrders.length;
    const uniqueCustomers = new Set(soldOrders.map(order => order.customerEmail)).size;

    let reportContent = `
KINGPIN CLOTHING MANAGEMENT SYSTEM
Sales & Performance Report
Generated: ${reportDate}

=== EXECUTIVE SUMMARY ===
Total Sales: ₱${totalSales.toFixed(2)}
Total Orders: ${totalOrders}
Unique Customers: ${uniqueCustomers}
Average Order Value: ₱${(totalSales / totalOrders).toFixed(2)}

=== ORDER DETAILS ===
    `;

    allOrders.forEach(order => {
        const itemsList = order.items.map(item => `${item.name} (x${item.quantity})`).join(', ');
        reportContent += `\nOrder #${order.id}
Customer: ${order.customerName}
Email: ${order.customerEmail}
Products: ${itemsList}
Total: ₱${order.totalAmount.toFixed(2)}
Status: ${order.status}
Date: ${order.date}
---`;
    });

    // Download as text file
    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `KINGPIN-Report-${reportDate}.txt`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    alert('Report generated and downloaded successfully!');
}

// Logo file preview handler
document.addEventListener('DOMContentLoaded', function() {
    const logoFileInput = document.getElementById('shopLogoFile');
    if (logoFileInput) {
        logoFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const preview = document.getElementById('logoPreview');
                    const container = document.getElementById('logoPreviewContainer');
                    if (preview && container) {
                        preview.src = event.target.result;
                        container.style.display = 'block';
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
});

// ===== NOTIFICATION & ORDER TRACKING =====

async function loadSharedGcashQRCode() {
    try {
        for (const endpoint of ['api/gcash-qr.php', 'api/gcash-qr']) {
            try {
                const response = await fetch(endpoint, { cache: 'no-store' });
                if (!response.ok) continue;

                const data = await response.json();
                if (data.gcashQRCode) {
                    appData.gcashQRCode = data.gcashQRCode;
                    saveGCashQRCode();
                    displayStoreGcashQRCode();
                    return;
                }
            } catch (error) {
                continue;
            }
        }
    } catch (error) {
        console.warn('Unable to load shared GCash QR code:', error);
    }

    displayStoreGcashQRCode();
}

window.addEventListener('storage', event => {
    if (event.key === 'kingpinProducts') {
        loadProductsFromStorage();
    }

    if (event.key === 'kingpinOrders') {
        loadOrders();
        if (document.getElementById('adminPage')?.style.display === 'block') {
            loadAdminOrders();
        }
        if (document.getElementById('ordersSection')?.style.display === 'block') {
            loadCustomerOrders();
        }
        if (document.getElementById('purchaseHistorySection')?.style.display === 'block') {
            loadPurchaseHistory();
        }
        if (document.getElementById('reportsTab')?.style.display === 'block') {
            generateReports();
        }
        if (document.getElementById('historyTab')?.style.display === 'block') {
            loadHistoryTable();
        }
    }

    if (event.key === 'kingpinNotification') {
        loadNotifications();
        if (document.getElementById('notificationsSection')?.style.display === 'block') {
            loadCustomerNotifications();
        }
        updateNotificationBadges();
    }

    if (event.key === 'kingpinGCashQR' && event.newValue) {
        appData.gcashQRCode = event.newValue;
        displayStoreGcashQRCode();
    }
});

window.addEventListener('kingpin-gcash-qr-updated', () => {
    loadSharedGcashQRCode();
});

document.getElementById('checkoutForm').addEventListener('submit', function(e) {
    e.preventDefault();
    processCustomerOrder();
});