// DESIGN INTERFACE FUNCTIONS
// Custom Design System for KingPin

// Design Data Storage
const designData = {
    currentDesignMode: 'customize',
    currentClothingType: 'tops',
    uploadedDesignFile: null,
    presets: [
        {
            id: 1,
            name: 'Classic Team Jersey',
            description: 'Standard team uniform design',
            category: 'sports',
            color: 'Blue',
            price: 450
        },
        {
            id: 2,
            name: 'Casual Crew Neck',
            description: 'Comfortable everyday wear',
            category: 'casual',
            color: 'Black',
            price: 350
        },
        {
            id: 3,
            name: 'Performance Athletic',
            description: 'High-performance sports design',
            category: 'sports',
            color: 'Red',
            price: 550
        },
        {
            id: 4,
            name: 'Vintage Retro',
            description: 'Classic retro style design',
            category: 'vintage',
            color: 'Maroon',
            price: 400
        },
        {
            id: 5,
            name: 'Minimalist Modern',
            description: 'Clean and simple design',
            category: 'modern',
            color: 'White',
            price: 300
        },
        {
            id: 6,
            name: 'Striped Athletic',
            description: 'Bold striped design',
            category: 'sports',
            color: 'Navy',
            price: 500
        }
    ]
};

function hideAllSections() {
    const sectionIds = [
        'productsSection',
        'designSection',
        'cartSection',
        'ordersSection',
        'purchaseHistorySection',
        'notificationsSection',
        'customerSettingsSection',
        'checkoutSection',
        'customerServiceSection'
    ];

    sectionIds.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.style.display = 'none';
        }
    });
}

// Toggle Design Interface
function toggleDesignInterface() {
    const designSection = document.getElementById('designSection');
    
    if (designSection && designSection.style.display === 'none') {
        // Show design section
        hideAllSections();
        designSection.style.display = 'block';
        
        // Initialize design interface
        initializeDesignInterface();
    } else {
        // Hide design section
        hideAllSections();
        const productsSection = document.getElementById('productsSection');
        if (productsSection) {
            productsSection.style.display = 'block';
        }
    }
}

// Initialize Design Interface
function initializeDesignInterface() {
    setupFileUploadPreview();
}

// Set Design Mode
function setDesignMode(mode) {
    const allowedModes = ['customize', 'upload'];
    if (!allowedModes.includes(mode)) {
        return;
    }

    designData.currentDesignMode = mode;
    
    // Update button states
    document.querySelectorAll('.design-mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const selectedBtn = document.querySelector(`[data-mode="${mode}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
    
    // Show/hide mode contents
    document.getElementById('customizeDesignMode').style.display = mode === 'customize' ? 'block' : 'none';
    document.getElementById('uploadDesignMode').style.display = mode === 'upload' ? 'block' : 'none';
}

// Set Clothing Type (Top, Bottom, or Both)
function setClothingType(type) {
    designData.currentClothingType = type;
    
    // Update button states
    document.querySelectorAll('.clothing-type-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const selectedButton = document.querySelector(`[data-type="${type}"]`);
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
    
    const showTops = type === 'tops' || type === 'both';
    const showBottoms = type === 'bottoms' || type === 'both';

    document.getElementById('topsDesignForm').style.display = showTops ? 'block' : 'none';
    document.getElementById('bottomsDesignForm').style.display = showBottoms ? 'block' : 'none';
}

// Add Customized Top to Cart
function addTopsToCart() {
    const color = document.getElementById('topColor').value;
    const fabric = document.getElementById('topFabric').value;
    const accentColor = document.getElementById('topAccentColor').value;
    const frontDesign = document.getElementById('topPrintDesign').value;
    const backDesign = document.getElementById('topBackDesign').value;
    
    // Validation
    if (!color || !fabric) {
        alert('Please fill in all required fields (Color and Fabric)');
        return;
    }
    
    const cartItem = {
        id: Date.now(),
        name: `Custom Top - ${color}`,
        type: 'custom-design',
        quantity: 1,
        price: 500, // Base price for custom design
        designType: 'custom',
        details: {
            clothingType: 'top',
            baseColor: color,
            accentColor: accentColor || 'None',
            fabricType: fabric,
            frontDesign: frontDesign,
            backDesign: backDesign,
            customizationDate: new Date().toLocaleString()
        }
    };
    
    appData.cart.push(cartItem);
    saveUserCart();
    updateCartCount();
    
    showStatusUpdateToast('✓ Custom top added to cart!');
    
    // Reset form
    document.getElementById('topsDesignForm').reset();
    
    // Switch back to shop
    document.getElementById('designSection').style.display = 'none';
    document.getElementById('productsSection').style.display = 'block';
    updateCartDisplay();
}

// Add Customized Bottoms to Cart
function addBottomsToCart() {
    const color = document.getElementById('bottomColor').value;
    const fabric = document.getElementById('bottomFabric').value;
    const sideStripe = document.getElementById('bottomSideStripe').value;
    const design = document.getElementById('bottomDesign').value;
    
    // Validation
    if (!color || !fabric) {
        alert('Please fill in all required fields (Color and Fabric)');
        return;
    }
    
    const cartItem = {
        id: Date.now(),
        name: `Custom Bottoms - ${color}`,
        type: 'custom-design',
        quantity: 1,
        price: 450, // Base price for custom bottoms
        designType: 'custom',
        details: {
            clothingType: 'bottoms',
            baseColor: color,
            fabricType: fabric,
            sideStripe: sideStripe || 'None',
            design: design,
            customizationDate: new Date().toLocaleString()
        }
    };
    
    appData.cart.push(cartItem);
    saveUserCart();
    updateCartCount();
    
    showStatusUpdateToast('✓ Custom bottoms added to cart!');
    
    // Reset form
    document.getElementById('bottomsDesignForm').reset();
    
    // Switch back to shop
    document.getElementById('designSection').style.display = 'none';
    document.getElementById('productsSection').style.display = 'block';
    updateCartDisplay();
}

// Setup File Upload Preview
function setupFileUploadPreview() {
    const fileInput = document.getElementById('uploadDesignFile');
    const previewContainer = document.getElementById('uploadDesignPreview');
    const previewImage = document.getElementById('uploadDesignPreviewImage');
    
    if (!fileInput) return;
    
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        
        if (file) {
            // Validate file size (10MB max)
            if (file.size > 10 * 1024 * 1024) {
                alert('File size exceeds 10MB limit');
                fileInput.value = '';
                previewContainer.style.display = 'none';
                return;
            }
            
            // Store file and show preview
            designData.uploadedDesignFile = file;
            const reader = new FileReader();
            
            reader.onload = function(e) {
                if (file.type.startsWith('image/')) {
                    previewImage.src = e.target.result;
                    previewContainer.style.display = 'block';
                } else {
                    previewContainer.style.display = 'none';
                }
            };
            
            reader.readAsDataURL(file);
        }
    });
}

function readDesignFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Unable to read the uploaded file.'));
        reader.readAsDataURL(file);
    });
}

async function prepareUploadedDesignFile(file) {
    const originalData = await readDesignFileAsDataUrl(file);
    if (!file.type.startsWith('image/')) {
        return { data: originalData, fileName: file.name, fileType: file.type };
    }

    const image = new Image();
    image.src = originalData;
    await image.decode();

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const maxDimension = 1600 * Math.pow(0.82, attempt);
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

        const quality = Math.max(0.5, 0.82 - attempt * 0.1);
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp;base64,')) {
            const context = canvas.getContext('2d');
            context.globalCompositeOperation = 'destination-over';
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL('image/jpeg', quality);
        }

        if (data.length <= 1800000) {
            const extension = data.startsWith('data:image/webp;') ? 'webp' : 'jpg';
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'customer-design';
            return { data, fileName: `${baseName}.${extension}`, fileType: data.slice(5, data.indexOf(';')) };
        }
    }

    throw new Error('This photo is too large to add. Please choose a smaller image.');
}

// Add Uploaded Design to Cart
async function addUploadedDesignToCart() {
    const file = designData.uploadedDesignFile;
    const clothingType = document.getElementById('uploadClothingType').value;
    const itemDescription = document.getElementById('uploadItemDescription').value;
    
    if (!file || !clothingType || !itemDescription) {
        alert('Please upload a file, select item type, and provide a description');
        return;
    }

    try {
        const uploadedDesign = await prepareUploadedDesignFile(file);
        const cartItem = {
            id: Date.now(),
            name: `${itemDescription} (Custom Upload)`,
            type: 'custom-design',
            quantity: 1,
            price: 600, // Price for uploaded custom design
            designType: 'uploaded',
            details: {
                clothingType: clothingType,
                itemDescription: itemDescription,
                uploadedFile: uploadedDesign.data,
                fileName: uploadedDesign.fileName,
                fileType: uploadedDesign.fileType,
                uploadDate: new Date().toLocaleString()
            }
        };
        
        appData.cart.push(cartItem);
        saveUserCart();
        updateCartCount();
        
        showStatusUpdateToast(`${itemDescription} uploaded design added to cart successfully.`);
        
        // Reset form
        document.getElementById('uploadDesignFile').value = '';
        document.getElementById('uploadClothingType').value = '';
        document.getElementById('uploadItemDescription').value = '';
        document.getElementById('uploadDesignPreview').style.display = 'none';
        designData.uploadedDesignFile = null;
        
        // Switch back to shop
        document.getElementById('designSection').style.display = 'none';
        document.getElementById('productsSection').style.display = 'block';
        updateCartDisplay();
    } catch (error) {
        console.error('Unable to add uploaded design to cart:', error);
        alert(error.message || 'Unable to add the uploaded design to cart.');
    }
}

// Helper function to convert color names to hex codes
function getColorCode(colorName) {
    const colorMap = {
        'Red': '#e74c3c',
        'Blue': '#3498db',
        'Black': '#2c3e50',
        'White': '#ecf0f1',
        'Yellow': '#f1c40f',
        'Green': '#2ecc71',
        'Navy': '#1a3a52',
        'Maroon': '#8b0000',
        'Gray': '#95a5a6',
        'Purple': '#9b59b6',
        'Orange': '#e67e22',
        'Pink': '#ff69b4',
        'Gold': '#d4af37',
        'Silver': '#c0c0c0',
        'Cyan': '#00ffff'
    };
    return colorMap[colorName] || '#3498db';
}

// Initialize design interface on page load
document.addEventListener('DOMContentLoaded', function() {
    // Add preset grid CSS if needed
    const presetsGrid = document.getElementById('presetsGrid');
    if (presetsGrid) {
        presetsGrid.className = 'presets-grid';
    }
});
