require('dotenv').config();
const { Client } = require('pg');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CATEGORIES_TREE = [
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Home & Living', slug: 'home-living' },
  { name: 'Sports & Outdoors', slug: 'sports-outdoors' },

  { name: 'Phones', slug: 'phones', parentSlug: 'electronics' },
  { name: 'Computers', slug: 'computers', parentSlug: 'electronics' },
  { name: 'Audio', slug: 'audio', parentSlug: 'electronics' },
  { name: 'Smart Watches', slug: 'smart-watches', parentSlug: 'electronics' },

  { name: 'Men', slug: 'men', parentSlug: 'fashion' },
  { name: 'Women', slug: 'women', parentSlug: 'fashion' },

  { name: 'Furniture', slug: 'furniture', parentSlug: 'home-living' },
  { name: 'Fitness', slug: 'fitness', parentSlug: 'sports-outdoors' },
];

const PRODUCTS_DATA = [
  // PHONES
  {
    title: 'iPhone 17 Pro',
    slug: 'iphone-17-pro',
    categorySlug: 'phones',
    price: 129999,
    stockQuantity: 25,
    description: 'Next-generation flagship iPhone with aerospace titanium chassis and advanced A19 Pro Bionic chip.',
    unsplashUrl: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Apple A19 Pro (3nm)',
      'Display Refresh Rate': '120Hz ProMotion',
      'Display Size & Type': '6.7" Super Retina XDR OLED',
      RAM: '12 GB',
      Storage: '256 GB',
      'Main Camera': '48 MP Triple Camera (5x Optical Zoom)',
      'Battery Capacity': '4400 mAh (25W MagSafe)',
      'Weight & Build': '221g Titanium Frame',
      OS: 'iOS 20',
      'Water Resistance': 'IP68 (6m up to 30 mins)',
      '5G Network': 'Sub-6GHz & mmWave 5G',
    },
  },
  {
    title: 'Samsung Galaxy S26',
    slug: 'samsung-galaxy-s26',
    categorySlug: 'phones',
    price: 89999,
    stockQuantity: 40,
    description: 'Dynamic AMOLED 2X 120Hz display with pro-grade 200MP camera and AI photo editing.',
    unsplashUrl: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Snapdragon 8 Gen 4 (3nm)',
      'Display Refresh Rate': '120Hz Dynamic AMOLED 2X',
      'Display Size & Type': '6.8" Quad HD+ LTPO',
      RAM: '12 GB',
      Storage: '256 GB',
      'Main Camera': '200 MP Quad Camera (100x Space Zoom)',
      'Battery Capacity': '5000 mAh (45W SuperFast)',
      'Weight & Build': '232g Armor Aluminum',
      OS: 'Android 16 (One UI 8)',
      'Water Resistance': 'IP68 Dust/Water Resistant',
      '5G Network': 'Dual SIM 5G SA/NSA',
    },
  },
  {
    title: 'Google Pixel 10',
    slug: 'google-pixel-10',
    categorySlug: 'phones',
    price: 74999,
    stockQuantity: 30,
    description: 'Powered by Google Tensor G5 chip with real-time AI assistant and computational photography.',
    unsplashUrl: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Google Tensor G5 AI Chip',
      'Display Refresh Rate': '120Hz Smooth Display',
      'Display Size & Type': '6.3" Actua OLED (2000 nits)',
      RAM: '12 GB',
      Storage: '128 GB',
      'Main Camera': '50 MP Dual Pixel + 48 MP Ultrawide',
      'Battery Capacity': '4700 mAh (30W Fast Charging)',
      'Weight & Build': '198g Matte Glass Back',
      OS: 'Stock Android 16 (7 yrs OS updates)',
      'Water Resistance': 'IP68 Water Resistant',
      '5G Network': '5G Sub6 / mmWave',
    },
  },
  {
    title: 'OnePlus 14',
    slug: 'oneplus-14',
    categorySlug: 'phones',
    price: 59999,
    stockQuantity: 50,
    description: 'Hasselblad camera system for mobile with 150W SUPERVOOC ultra-fast charging.',
    unsplashUrl: 'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Snapdragon 8 Gen 4',
      'Display Refresh Rate': '120Hz Fluid AMOLED',
      'Display Size & Type': '6.78" 1.5K ProXDR',
      RAM: '16 GB LPDDR5X',
      Storage: '512 GB UFS 4.0',
      'Main Camera': '50 MP Hasselblad Triple Camera',
      'Battery Capacity': '5400 mAh (150W SUPERVOOC)',
      'Weight & Build': '207g Emerald Glass',
      OS: 'OxygenOS 15 based on Android 16',
      'Water Resistance': 'IP65 Splash Proof',
      '5G Network': 'Dual 5G Standby',
    },
  },
  {
    title: 'Xiaomi 16 Pro',
    slug: 'xiaomi-16-pro',
    categorySlug: 'phones',
    price: 54999,
    stockQuantity: 35,
    description: 'Leica optical lenses with Snapdragon 8 Gen 4 and crystal clear curved AMOLED screen.',
    unsplashUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Snapdragon 8 Gen 4',
      'Display Refresh Rate': '144Hz Curved LTPO AMOLED',
      'Display Size & Type': '6.73" WQHD+ (3000 nits)',
      RAM: '12 GB',
      Storage: '256 GB',
      'Main Camera': '50 MP Leica Summilux Lens',
      'Battery Capacity': '4880 mAh (120W HyperCharge)',
      'Weight & Build': '223g Ceramic Back',
      OS: 'Xiaomi HyperOS 2',
      'Water Resistance': 'IP68 Water Resistant',
      '5G Network': '5G SA/NSA Dual SIM',
    },
  },

  // COMPUTERS
  {
    title: 'MacBook Pro 16',
    slug: 'macbook-pro-16',
    categorySlug: 'computers',
    price: 249999,
    stockQuantity: 10,
    description: 'Apple M3 Max chip, Liquid Retina XDR display, 36GB unified memory for creative professionals.',
    unsplashUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Apple M3 Max (16-Core CPU)',
      GPU: '40-Core Apple GPU',
      RAM: '36 GB Unified Memory',
      Storage: '1 TB PCIe NVMe SSD',
      'Display Refresh Rate': '120Hz ProMotion XDR',
      'Display Size & Type': '16.2" Liquid Retina XDR (3456x2234)',
      'Battery Life': 'Up to 22 Hours',
      'Weight & Build': '2.16 kg Space Black Aluminum',
      OS: 'macOS Sonoma',
      Ports: '3x Thunderbolt 4, HDMI, SDXC, MagSafe 3',
    },
  },
  {
    title: 'Dell XPS 15',
    slug: 'dell-xps-15',
    categorySlug: 'computers',
    price: 159999,
    stockQuantity: 15,
    description: '15.6-inch 3.5K OLED Touch screen with Intel Core i9, NVIDIA RTX 4070, and CNC aluminum casing.',
    unsplashUrl: 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Intel Core i9-13900H (14-Core)',
      GPU: 'NVIDIA GeForce RTX 4070 (8GB GDDR6)',
      RAM: '32 GB DDR5 4800MHz',
      Storage: '1 TB M.2 PCIe NVMe SSD',
      'Display Refresh Rate': '60Hz OLED Touch',
      'Display Size & Type': '15.6" 3.5K OLED (3456x2160)',
      'Battery Life': 'Up to 12 Hours',
      'Weight & Build': '1.92 kg CNC Aluminum & Carbon Fiber',
      OS: 'Windows 11 Pro',
      Ports: '2x Thunderbolt 4, USB-C 3.2, SD Card Reader',
    },
  },
  {
    title: 'HP Spectre x360',
    slug: 'hp-spectre-x360',
    categorySlug: 'computers',
    price: 134999,
    stockQuantity: 20,
    description: 'Convertible 2-in-1 laptop with stylus support, 4K OLED display, and Bang & Olufsen sound.',
    unsplashUrl: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Intel Core Ultra 7 155H AI Chip',
      GPU: 'Intel Arc Graphics',
      RAM: '16 GB LPDDR5x',
      Storage: '1 TB PCIe Gen4 NVMe SSD',
      'Display Refresh Rate': '120Hz Variable OLED',
      'Display Size & Type': '14" 2.8K OLED 2-in-1 Touch',
      'Battery Life': 'Up to 15 Hours',
      'Weight & Build': '1.44 kg Gem-cut Aluminum',
      OS: 'Windows 11 Home',
      Ports: '2x Thunderbolt 4, USB-A, Headphone Jack',
    },
  },
  {
    title: 'Lenovo ThinkPad X1 Carbon',
    slug: 'lenovo-thinkpad-x1-carbon',
    categorySlug: 'computers',
    price: 145999,
    stockQuantity: 12,
    description: 'Ultralight carbon-fiber business laptop with military-grade durability and ergonomic keyboard.',
    unsplashUrl: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Intel Core Ultra 7 165U vPro',
      GPU: 'Intel Graphics',
      RAM: '32 GB LPDDR5X',
      Storage: '1 TB PCIe NVMe Performance SSD',
      'Display Refresh Rate': '120Hz IPS Anti-Glare',
      'Display Size & Type': '14" 2.8K OLED / WUXGA IPS',
      'Battery Life': 'Up to 14 Hours',
      'Weight & Build': '1.09 kg Ultra-light Carbon Fiber',
      OS: 'Windows 11 Pro',
      Ports: '2x Thunderbolt 4, 2x USB-A 3.2, HDMI 2.1',
    },
  },
  {
    title: 'ASUS ROG Strix G16',
    slug: 'asus-rog-strix-g16',
    categorySlug: 'computers',
    price: 139999,
    stockQuantity: 18,
    description: 'Extreme gaming laptop featuring ROG Nebula HDR Display 240Hz and NVIDIA RTX 4080 GPU.',
    unsplashUrl: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Intel Core i9-14900HX (24-Core)',
      GPU: 'NVIDIA GeForce RTX 4080 (12GB GDDR6)',
      RAM: '32 GB DDR5 5600MHz',
      Storage: '1 TB PCIe 4.0 NVMe M.2 SSD',
      'Display Refresh Rate': '240Hz ROG Nebula Display',
      'Display Size & Type': '16" QHD+ 16:10 (2560x1600) 3ms',
      'Battery Life': 'Up to 7 Hours (90Wh Battery)',
      'Weight & Build': '2.50 kg Eclipse Gray Chassis',
      OS: 'Windows 11 Home',
      Ports: 'Thunderbolt 4, USB-C 3.2, 2x USB-A, HDMI 2.1, RJ45 LAN',
    },
  },

  // MEN
  {
    title: 'Classic Cotton T-Shirt',
    slug: 'classic-cotton-tshirt',
    categorySlug: 'men',
    price: 799,
    stockQuantity: 100,
    description: '100% premium combed cotton crewneck t-shirt. Pre-shrunk and breathable everyday wear.',
    unsplashUrl: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Combed Organic Cotton',
      Fit: 'Regular Crewneck Fit',
      Sleeve: 'Short Sleeve',
      Pattern: 'Solid Plain',
      Care: 'Machine Wash Cold',
      Weight: '180 GSM Fabric',
    },
  },
  {
    title: 'Slim Fit Jeans',
    slug: 'slim-fit-jeans',
    categorySlug: 'men',
    price: 1999,
    stockQuantity: 60,
    description: 'Dark wash stretch denim jeans engineered for comfort and a sleek modern silhouette.',
    unsplashUrl: 'https://images.unsplash.com/photo-1542272604-780c36856842?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '98% Cotton, 2% Elastane Stretch Denim',
      Fit: 'Slim Tapered Fit',
      Closure: 'Zip Fly with Button Closure',
      Wash: 'Dark Indigo Enzyme Wash',
      Care: 'Machine Wash Inside Out',
    },
  },
  {
    title: 'Casual Hoodie',
    slug: 'casual-hoodie',
    categorySlug: 'men',
    price: 1499,
    stockQuantity: 45,
    description: 'Heavyweight fleece hooded sweatshirt with kangaroo pocket and ribbed cuffs.',
    unsplashUrl: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '80% Cotton, 20% Polyester Heavyweight Fleece',
      Fit: 'Relaxed Streetwear Fit',
      Features: 'Fleece Lined Hood & Kangaroo Pocket',
      Weight: '320 GSM Heavyweight',
    },
  },
  {
    title: 'Formal Shirt',
    slug: 'formal-shirt',
    categorySlug: 'men',
    price: 1299,
    stockQuantity: 70,
    description: 'Wrinkle-resistant Oxford cotton button-up formal shirt for business attire.',
    unsplashUrl: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Premium Oxford Cotton',
      Fit: 'Modern Slim Fit',
      Collar: 'Button-Down Spread Collar',
      Finish: 'Non-Iron Wrinkle Resistant',
    },
  },
  {
    title: 'Leather Jacket',
    slug: 'leather-jacket',
    categorySlug: 'men',
    price: 4999,
    stockQuantity: 20,
    description: 'Genuine full-grain lambskin leather biker jacket with asymmetrical zip front.',
    unsplashUrl: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Genuine Full-Grain Lambskin',
      Lining: 'Quilted Satin Thermal Lining',
      Style: 'Asymmetrical Biker Zip Jacket',
      Zippers: 'Heavy Duty YKK Metal Zippers',
    },
  },

  // WOMEN
  {
    title: 'Floral Summer Dress',
    slug: 'floral-summer-dress',
    categorySlug: 'women',
    price: 2499,
    stockQuantity: 40,
    description: 'Lightweight chiffon A-line summer dress featuring vibrant floral prints.',
    unsplashUrl: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Lightweight Polyester Chiffon',
      Style: 'A-Line Flare Midi Dress',
      Pattern: 'Botanical Floral Print',
      Occasion: 'Casual Beach & Summer Outings',
    },
  },
  {
    title: "Women's Denim Jacket",
    slug: 'womens-denim-jacket',
    categorySlug: 'women',
    price: 2999,
    stockQuantity: 25,
    description: 'Classic oversized trucker denim jacket with vintage wash finish.',
    unsplashUrl: 'https://images.unsplash.com/photo-1544441893-675973e31985?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Rigid Cotton Denim',
      Fit: 'Oversized Boyfriend Fit',
      Wash: 'Vintage Acid Wash Finish',
    },
  },
  {
    title: 'Cotton Kurti',
    slug: 'cotton-kurti',
    categorySlug: 'women',
    price: 1199,
    stockQuantity: 80,
    description: 'Pure cotton printed straight kurti with delicate thread embroidery work.',
    unsplashUrl: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '100% Breathable Malmal Cotton',
      Cut: 'Straight Fit Calf-Length Kurti',
      Work: 'Resham Thread Neck Embroidery',
    },
  },
  {
    title: 'Wide Leg Trousers',
    slug: 'wide-leg-trousers',
    categorySlug: 'women',
    price: 1799,
    stockQuantity: 50,
    description: 'High-waisted tailored wide leg pants with pleated front detailing.',
    unsplashUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: 'Polyester Viscose Stretch Blend',
      Waist: 'High-Waisted Elastic Back Band',
      Leg: 'Full-Length Pleated Wide Leg',
    },
  },
  {
    title: 'Casual Top',
    slug: 'casual-top',
    categorySlug: 'women',
    price: 899,
    stockQuantity: 100,
    description: 'Soft ribbed knit casual top with square neckline and short sleeves.',
    unsplashUrl: 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Material: '95% Rayon, 5% Spandex Ribbed Knit',
      Neckline: 'Classic Square Neck',
      Fit: 'Fitted Body Silhouette',
    },
  },

  // FURNITURE
  {
    title: 'Modern Sofa',
    slug: 'modern-sofa',
    categorySlug: 'furniture',
    price: 34999,
    stockQuantity: 8,
    description: '3-seater Scandinavian fabric upholstered sofa with solid oak wood frame.',
    unsplashUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Seating: '3-Seater Living Room Sofa',
      Frame: 'Kiln-Dried Solid Oak Wood',
      Upholstery: 'Stain-Resistant Textured Linen',
      Dimensions: '210cm x 88cm x 78cm',
    },
  },
  {
    title: 'Wooden Dining Table',
    slug: 'wooden-dining-table',
    categorySlug: 'furniture',
    price: 24999,
    stockQuantity: 12,
    description: 'Solid teak wood 6-seater dining table with natural matte oil finish.',
    unsplashUrl: 'https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Seating: '6-Seater Rectangular Table',
      Wood: '100% Solid Grade-A Teak Wood',
      Finish: 'Water-Resistant Natural Matte Oil',
    },
  },
  {
    title: 'Office Chair',
    slug: 'office-chair',
    categorySlug: 'furniture',
    price: 8999,
    stockQuantity: 30,
    description: 'Ergonomic mesh office chair with lumbar support and multi-angle recline.',
    unsplashUrl: 'https://images.unsplash.com/photo-1580481072645-022f9a6d8310?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Type: 'High-Back Ergonomic Executive Chair',
      Backrest: 'Breathable Korean Mesh with Adjustable Lumbar',
      Mechanism: 'Syncro-Tilt Lock with 135° Recline',
      'Weight Capacity': 'Up to 150 kg',
    },
  },
  {
    title: 'King Size Bed',
    slug: 'king-size-bed',
    categorySlug: 'furniture',
    price: 42999,
    stockQuantity: 6,
    description: 'Upholstered platform bed frame with cushioned headboard and hydraulic storage.',
    unsplashUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Size: 'King Size (78" x 72" Mattress Space)',
      Storage: 'Dual Gas-Lift Hydraulic Storage System',
      Headboard: 'Plush Velvet Channel-Tufted Headboard',
    },
  },
  {
    title: 'Bookshelf',
    slug: 'bookshelf',
    categorySlug: 'furniture',
    price: 5999,
    stockQuantity: 25,
    description: '5-tier industrial wood and metal bookshelf for display and organization.',
    unsplashUrl: 'https://images.unsplash.com/photo-1594620302200-9a762244a156?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Shelves: '5-Tier Open Storage Shelves',
      Material: 'Engineered Wood & Powder-Coated Steel Frame',
      'Load Capacity': '25 kg per shelf',
    },
  },

  // FITNESS
  {
    title: 'Yoga Mat',
    slug: 'yoga-mat',
    categorySlug: 'fitness',
    price: 999,
    stockQuantity: 100,
    description: '6mm eco-friendly TPE non-slip yoga mat with alignment lines and carrying strap.',
    unsplashUrl: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Thickness: '6mm High-Density Cushioning',
      Material: '100% Eco-Friendly Non-Toxic TPE',
      Features: 'Laser Laser-Etched Body Alignment Lines',
    },
  },
  {
    title: 'Adjustable Dumbbells',
    slug: 'adjustable-dumbbells',
    categorySlug: 'fitness',
    price: 4999,
    stockQuantity: 35,
    description: 'Pair of quick-adjust dumbbells ranging from 2.5kg to 24kg per hand.',
    unsplashUrl: 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Weight Range': '2.5kg to 24kg per dumbbell (15 weight settings)',
      Mechanism: 'Dial Selector Quick-Turn Weight System',
      Material: 'Silicon Steel Weight Plates with Molded Coating',
    },
  },
  {
    title: 'Resistance Bands Set',
    slug: 'resistance-bands-set',
    categorySlug: 'fitness',
    price: 799,
    stockQuantity: 75,
    description: 'Set of 5 natural latex exercise bands with handles, door anchor, and ankle straps.',
    unsplashUrl: 'https://images.unsplash.com/photo-1598289431512-b97b0917affc?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Resistance Levels': '5 Color Bands (10 lbs to 50 lbs, total 150 lbs)',
      Material: '100% Malaysian Natural Latex',
      Included: '2 Foam Handles, 2 Ankle Straps, 1 Door Anchor',
    },
  },
  {
    title: 'Treadmill',
    slug: 'treadmill',
    categorySlug: 'fitness',
    price: 39999,
    stockQuantity: 10,
    description: 'Smart motorized treadmill with 3.0 HP motor, auto-incline, and Bluetooth speaker system.',
    unsplashUrl: 'https://images.unsplash.com/photo-1540497077202-7c8a3999166f?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Motor Power': '3.0 HP Peak DC Motor',
      'Speed Range': '1.0 km/h to 16.0 km/h',
      Incline: '15 Levels Automatic Motorized Incline',
      Display: '7" Blue Backlit LCD with Bluetooth Speakers',
    },
  },
  {
    title: 'Kettlebell',
    slug: 'kettlebell',
    categorySlug: 'fitness',
    price: 1999,
    stockQuantity: 40,
    description: 'Solid cast iron 16kg kettlebell with color-coded vinyl coating.',
    unsplashUrl: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Weight: '16 kg Solid Weight',
      Material: 'Solid Cast Iron with Vinyl Coating Base',
      Handle: 'Smooth Wide Textured Grip',
    },
  },

  // AUDIO
  {
    title: 'Wireless Headphones',
    slug: 'wireless-headphones',
    categorySlug: 'audio',
    price: 4999,
    stockQuantity: 50,
    description: 'Over-ear Bluetooth headphones with 40mm drivers and 30-hour battery life.',
    unsplashUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Audio Driver': '40mm Neodymium Dynamic Drivers',
      'Battery Life': '30 Hours Playtime (Quick Charge 10min = 5hr)',
      Bluetooth: 'Bluetooth 5.3 Multipoint',
      'Noise Cancellation': 'Active Hybrid ANC',
    },
  },
  {
    title: 'Bluetooth Speaker',
    slug: 'bluetooth-speaker',
    categorySlug: 'audio',
    price: 2999,
    stockQuantity: 65,
    description: 'IPX7 waterproof portable Bluetooth speaker with deep bass radiator.',
    unsplashUrl: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Power Output': '20W RMS Dual Drivers',
      'Battery Life': '14 Hours Continuous Playtime',
      Waterproofing: 'IPX7 Fully Waterproof (Submersible)',
    },
  },
  {
    title: 'True Wireless Earbuds',
    slug: 'true-wireless-earbuds',
    categorySlug: 'audio',
    price: 2499,
    stockQuantity: 80,
    description: 'In-ear wireless earbuds with active noise cancellation and wireless charging case.',
    unsplashUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Audio Driver': '11mm Graphene Coated Drivers',
      'Battery Life': '8 hrs earbuds + 24 hrs charging case',
      'Noise Cancellation': '35dB Smart Active Noise Cancellation',
    },
  },
  {
    title: 'Noise Cancelling Headphones',
    slug: 'noise-cancelling-headphones',
    categorySlug: 'audio',
    price: 8999,
    stockQuantity: 25,
    description: 'Premium active noise-cancelling headphones with multipoint connectivity and transparency mode.',
    unsplashUrl: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Audio Driver': '45mm Hi-Res Audio Drivers',
      'Battery Life': '40 Hours ANC On',
      'Noise Cancellation': 'Adaptive Noise Cancellation with Ambient Aware',
    },
  },
  {
    title: 'Portable Speaker',
    slug: 'portable-speaker',
    categorySlug: 'audio',
    price: 1999,
    stockQuantity: 70,
    description: 'Compact 360-degree sound wireless speaker with built-in mic for calls.',
    unsplashUrl: 'https://images.unsplash.com/photo-1545454675-3531b543be5d?q=80&w=800&auto=format&fit=crop',
    attributes: {
      'Power Output': '12W 360° Omnidirectional Sound',
      'Battery Life': '10 Hours',
      Connectivity: 'Bluetooth 5.2 + AUX In + Built-in Mic',
    },
  },

  // SMART WATCHES
  {
    title: 'Apple Watch Series 11',
    slug: 'apple-watch-series-11',
    categorySlug: 'smart-watches',
    price: 46999,
    stockQuantity: 20,
    description: 'Always-on Retina OLED display with blood oxygen monitoring, ECG, and cellular support.',
    unsplashUrl: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Apple S10 Dual-Core SiP',
      'Display Size & Type': '45mm Always-On Retina OLED (2000 nits)',
      'Display Refresh Rate': '60Hz LTPO OLED',
      'Battery Life': '18 Hours (Up to 36 Hours Low Power)',
      Sensors: 'ECG, Blood Oxygen, Temperature, Heart Rate, Crash Detection',
      'Water Resistance': '50m Water Resistant (5 ATM) + IP6X Dust',
      Connectivity: '4G LTE Cellular + GPS + Wi-Fi + NFC',
    },
  },
  {
    title: 'Samsung Galaxy Watch',
    slug: 'samsung-galaxy-watch',
    categorySlug: 'smart-watches',
    price: 34999,
    stockQuantity: 25,
    description: 'BioActive sensor for body composition analysis, sleep tracking, and custom watch faces.',
    unsplashUrl: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Exynos W930 5nm Dual-Core',
      'Display Size & Type': '1.5" Super AMOLED Sapphire Crystal',
      'Display Refresh Rate': '60Hz Always-On Display',
      'Battery Life': 'Up to 40 Hours (WPC Wireless Charging)',
      Sensors: 'BioActive BIA Body Composition, BPL, ECG, Sleep Coach',
      'Water Resistance': '5 ATM + IP68 + MIL-STD-810H',
      Connectivity: 'Bluetooth 5.3 + Wi-Fi + GPS + NFC',
    },
  },
  {
    title: 'Fitbit Versa',
    slug: 'fitbit-versa',
    categorySlug: 'smart-watches',
    price: 18999,
    stockQuantity: 30,
    description: 'Health & fitness smartwatch with built-in GPS, 24/7 heart rate tracking, and 6+ day battery.',
    unsplashUrl: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Fitbit OS Custom Chipset',
      'Display Size & Type': '1.58" Color AMOLED Touchscreen',
      'Battery Life': '6+ Days Battery (Fast Charge 12min = 1 day)',
      Sensors: 'Built-in GPS, SpO2, Skin Temp, Heart Rate',
      'Water Resistance': 'Water Resistant up to 50 meters',
      Connectivity: 'Bluetooth 5.0 + Wi-Fi',
    },
  },
  {
    title: 'Garmin Forerunner',
    slug: 'garmin-forerunner',
    categorySlug: 'smart-watches',
    price: 29999,
    stockQuantity: 15,
    description: 'Advanced running smartwatch with training readiness score, multi-band GPS, and color maps.',
    unsplashUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Garmin Performance Processor',
      'Display Size & Type': '1.3" Sunlight-Visible MIP Display',
      'Battery Life': '14 Days Smartwatch Mode (30 Hours GPS)',
      Sensors: 'Multi-Band Multi-GNSS GPS, Pulse Ox, HRV Status',
      'Water Resistance': '5 ATM (50m Waterproof)',
      Connectivity: 'ANT+ / Bluetooth / Wi-Fi',
    },
  },
  {
    title: 'Amazfit Active',
    slug: 'amazfit-active',
    categorySlug: 'smart-watches',
    price: 8999,
    stockQuantity: 40,
    description: 'Stylish HD AMOLED smartwatch with AI fitness coach, 14-day battery life, and Bluetooth calls.',
    unsplashUrl: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=800&auto=format&fit=crop',
    attributes: {
      Processor: 'Zepp OS 3.0 Dual-Core',
      'Display Size & Type': '1.75" HD AMOLED (341 ppi)',
      'Battery Life': '14 Days Typical Usage',
      Sensors: 'BioTracker PPG, 5 Satellite Positioning GPS',
      'Water Resistance': '5 ATM Water Resistance',
      Connectivity: 'Bluetooth 5.2 (Supports BT Phone Calls)',
    },
  },
];

async function ensureCategories(client) {
  const categoryMap = new Map();
  const res = await client.query('SELECT id, slug FROM categories');
  for (const row of res.rows) {
    categoryMap.set(row.slug, row.id);
  }

  for (const cat of CATEGORIES_TREE) {
    if (categoryMap.has(cat.slug)) continue;

    let parentId = null;
    if (cat.parentSlug) {
      parentId = categoryMap.get(cat.parentSlug) ?? null;
    }

    const inserted = await client.query(
      `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id, slug`,
      [cat.name, cat.slug, parentId],
    );
    categoryMap.set(inserted.rows[0].slug, inserted.rows[0].id);
    console.log(`Created category: ${cat.name} (${cat.slug})`);
  }

  return categoryMap;
}

async function getSupplierId(client) {
  const res = await client.query(`SELECT id FROM suppliers LIMIT 1`);
  if (res.rowCount === 0) {
    throw new Error('No supplier found in suppliers table. Please seed admin/supplier first.');
  }
  return res.rows[0].id;
}

async function seedProducts() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nexus',
  });

  await client.connect();

  console.log('--- Step 1: Syncing Categories ---');
  const categoryMap = await ensureCategories(client);

  console.log('--- Step 2: Fetching Supplier ---');
  const supplierId = await getSupplierId(client);

  console.log('--- Step 3: Uploading Images to Cloudinary & Inserting Products ---');
  let count = 0;

  for (const item of PRODUCTS_DATA) {
    const categoryId = categoryMap.get(item.categorySlug);
    if (!categoryId) {
      console.warn(`Category slug not found: ${item.categorySlug}`);
      continue;
    }

    console.log(`Processing [${count + 1}/${PRODUCTS_DATA.length}]: ${item.title}...`);

    let imageUrl = '';
    try {
      const uploadRes = await cloudinary.uploader.upload(item.unsplashUrl, {
        folder: 'nexus/products',
        public_id: item.slug,
        overwrite: true,
      });
      imageUrl = uploadRes.secure_url;
      console.log(`  Cloudinary URL: ${imageUrl}`);
    } catch (err) {
      console.error(`  Failed Cloudinary upload for ${item.title}:`, err.message);
      imageUrl = item.unsplashUrl;
    }

    const imagesJson = JSON.stringify([
      {
        url: imageUrl,
        alt: item.title,
        isPrimary: true,
      },
    ]);

    const existingProduct = await client.query('SELECT id FROM products WHERE slug = $1', [item.slug]);

    const attributesJson = JSON.stringify(item.attributes || {});

    const finalPrice = item.price > 500 ? Number((item.price / 100).toFixed(2)) : item.price;

    if (existingProduct.rowCount > 0) {
      await client.query(
        `UPDATE products
         SET title = $1, category_id = $2, supplier_id = $3, price = $4, stock_quantity = $5,
             description = $6, status = 'APPROVED', images = $7::jsonb, attributes = $8::jsonb, updated_at = now()
         WHERE slug = $9`,
        [item.title, categoryId, supplierId, finalPrice, item.stockQuantity, item.description, imagesJson, attributesJson, item.slug],
      );
      console.log(`  Updated existing product in database.`);
    } else {
      await client.query(
        `INSERT INTO products (supplier_id, category_id, title, slug, description, price, stock_quantity, status, images, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED', $8::jsonb, $9::jsonb)`,
        [supplierId, categoryId, item.title, item.slug, item.description, finalPrice, item.stockQuantity, imagesJson, attributesJson],
      );
      console.log(`  Inserted new product into database.`);
    }

    count++;
  }

  console.log(`\nSuccessfully uploaded and seeded ${count} products to Cloudinary & Database!`);
  await client.end();
}

seedProducts().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
