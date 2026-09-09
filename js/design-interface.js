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
    loadPresets();
    setupFileUploadPreview();
}

// Set Design Mode
function setDesignMode(mode) {
    designData.currentDesignMode = mode;
    
    // Update button states
    document.querySelectorAll('.design-mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
    
    // Show/hide mode contents
    document.getElementById('customizeDesignMode').style.display = mode === 'customize' ? 'block' : 'none';
    document.getElementById('presetsDesignMode').style.display = mode === 'presets' ? 'block' : 'none';
    document.getElementById('uploadDesignMode').style.display = mode === 'upload' ? 'block' : 'none';
    
    if (mode === 'presets') {
        loadPresets();
    }
}

// Set Clothing Type (Tops or Bottoms)
function setClothingType(type) {
    designData.currentClothingType = type;
    
    // Update button states
    document.querySelectorAll('.clothing-type-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-type="${type}"]`).classList.add('active');
    
    // Show/hide clothing forms
    document.getElementById('topsDesignForm').style.display = type === 'tops' ? 'block' : 'none';
    document.getElementById('bottomsDesignForm').style.display = type === 'bottoms' ? 'block' : 'none';
}

// Load Preset Designs
function loadPresets() {
    const presetsGrid = document.getElementById('presetsGrid');
    presetsGrid.innerHTML = '';
    
    designData.presets.forEach(preset => {
        const presetCard = document.createElement('div');
        presetCard.className = 'preset-card';
        presetCard.innerHTML = `
            <div class="preset-color" style="background-color: ${getColorCode(preset.color)}; height: 150px; border-radius: 5px 5px 0 0;"></div>
            <div class="preset-info" style="padding: 15px; background: #1f1f1f; border-radius: 0 0 5px 5px;">
                <h4 style="color: #d4af37; margin-bottom: 5px;">${preset.name}</h4>
                <p style="color: #a0a0a0; font-size: 0.9em; margin-bottom: 10px;">${preset.description}</p>
                <p style="color: #d4af37; font-weight: 600; margin-bottom: 10px;">₱${preset.price}</p>
                <button type="button" class="btn btn-primary" onclick="selectPreset(${preset.id})" style="width: 100%;">Select Design</button>
            </div>
        `;
        presetsGrid.appendChild(presetCard);
    });
}

// Select Preset Design
function selectPreset(presetId) {
    const preset = designData.presets.find(p => p.id === presetId);
    if (!preset) return;
    
    const cartItem = {
        id: Date.now(),
        name: preset.name,
        type: 'custom-design',
        design: preset,
        quantity: 1,
        price: preset.price,
        designType: 'preset',
        details: {
            name: preset.name,
            color: preset.color,
            category: preset.category,
            description: preset.description
        }
    };
    
    appData.cart.push(cartItem);
    saveUserCart();
    updateCartCount();
    
    showStatusUpdateToast(`✓ ${preset.name} added to cart!`);
    
    // Switch back to shop
    document.getElementById('designSection').style.display = 'none';
    document.getElementById('productsSection').style.display = 'block';
    updateCartDisplay();
}

// Add Customized Top to Cart
function addTopsToCart() {
    const color = document.getElementById('topColor').value;
    const fabric = document.getElementById('topFabric').value;
    const size = document.getElementById('topSize').value;
    const accentColor = document.getElementById('topAccentColor').value;
    const frontDesign = document.getElementById('topPrintDesign').value;
    const backDesign = document.getElementById('topBackDesign').value;
    
    // Validation
    if (!color || !fabric || !size) {
        alert('Please fill in all required fields (Color, Fabric, Size)');
        return;
    }
    
    const cartItem = {
        id: Date.now(),
        name: `Custom Top - ${color} (${size})`,
        type: 'custom-design',
        quantity: 1,
        price: 500, // Base price for custom design
        designType: 'custom',
        details: {
            clothingType: 'top',
            baseColor: color,
            accentColor: accentColor || 'None',
            fabricType: fabric,
            size: size,
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
    const size = document.getElementById('bottomSize').value;
    const sideStripe = document.getElementById('bottomSideStripe').value;
    const design = document.getElementById('bottomDesign').value;
    
    // Validation
    if (!color || !fabric || !size) {
        alert('Please fill in all required fields (Color, Fabric, Size)');
        return;
    }
    
    const cartItem = {
        id: Date.now(),
        name: `Custom Bottoms - ${color} (${size})`,
        type: 'custom-design',
        quantity: 1,
        price: 450, // Base price for custom bottoms
        designType: 'custom',
        details: {
            clothingType: 'bottoms',
            baseColor: color,
            fabricType: fabric,
            size: size,
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

// Add Uploaded Design to Cart
function addUploadedDesignToCart() {
    const file = designData.uploadedDesignFile;
    const clothingType = document.getElementById('uploadClothingType').value;
    const itemDescription = document.getElementById('uploadItemDescription').value;
    
    if (!file || !clothingType || !itemDescription) {
        alert('Please upload a file, select item type, and provide a description');
        return;
    }
    
    // Read file as base64
    const reader = new FileReader();
    reader.onload = function(e) {
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
                uploadedFile: e.target.result,
                fileName: file.name,
                fileType: file.type,
                uploadDate: new Date().toLocaleString()
            }
        };
        
        appData.cart.push(cartItem);
        saveUserCart();
        updateCartCount();
        
        showStatusUpdateToast(`✓ ${itemDescription} added to cart!`);
        
        // Reset form
        document.getElementById('uploadDesignFile').value = '';
        document.getElementById('uploadClothingType').value = '';
        document.getElementById('uploadItemDescription').value = '';
        document.getElementById('uploadDesignPreview').style.display = 'none';
        
        // Switch back to shop
        document.getElementById('designSection').style.display = 'none';
        document.getElementById('productsSection').style.display = 'block';
        updateCartDisplay();
    };
    
    reader.readAsDataURL(file);
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
