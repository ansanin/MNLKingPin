<?php
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$storageFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'products.json';

function normalizedProductSizes($value) {
    $sizes = is_array($value) ? $value : explode(',', (string)($value ?? ''));
    $allowed = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
    $normalized = [];
    foreach ($sizes as $size) {
        $size = strtoupper(trim((string)$size));
        if ($size === 'XXL') $size = '2XL';
        if ($size === 'XXXL') $size = '3XL';
        if ($size !== '' && !in_array($size, $normalized, true)) $normalized[] = $size;
    }
    return [$normalized, array_values(array_diff($normalized, $allowed))];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!is_file($storageFile)) {
        echo json_encode(['products' => []]);
        exit;
    }

    $saved = json_decode(file_get_contents($storageFile), true);
    $products = is_array($saved['products'] ?? null) ? $saved['products'] : [];
    if (($_GET['view'] ?? '') !== 'admin') {
        $products = array_map(function ($product) {
            [$sizes] = normalizedProductSizes($product['availableSizes'] ?? []);
            return [
                'id' => $product['id'] ?? null,
                'name' => $product['name'] ?? '',
                'type' => $product['type'] ?? '',
                'price' => $product['price'] ?? 0,
                'stock' => $product['stock'] ?? 0,
                'availableSizes' => $sizes,
                'thumbnailUrl' => $product['thumbnailImage'] ?? $product['image'] ?? ($product['images'][0] ?? '')
            ];
        }, $products);
    }
    echo json_encode(['products' => $products]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$payload = json_decode(file_get_contents('php://input'), true);
$products = $payload['products'] ?? null;

if (!is_array($products)) {
    http_response_code(400);
    echo json_encode(['error' => 'Products must be an array']);
    exit;
}

if (strlen(json_encode($products)) > 25 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(['error' => 'Product data is too large']);
    exit;
}

$saved = is_file($storageFile) ? json_decode(file_get_contents($storageFile), true) : [];
$existingProducts = is_array($saved['products'] ?? null) ? $saved['products'] : [];
$existingById = [];
foreach ($existingProducts as $product) $existingById[(string)($product['id'] ?? '')] = $product;
foreach ($products as &$product) {
    if (!is_array($product)) {
        http_response_code(400);
        echo json_encode(['error' => 'Product data must contain product objects']);
        exit;
    }
    $previous = $existingById[(string)($product['id'] ?? '')] ?? null;
    if ($previous !== null && json_encode($previous) === json_encode($product)) continue;
    [$sizes, $unsupported] = normalizedProductSizes($product['availableSizes'] ?? []);
    if (!$sizes) {
        http_response_code(400);
        echo json_encode(['error' => 'Select at least one size for each new or changed product.']);
        exit;
    }
    if ($unsupported) {
        http_response_code(400);
        echo json_encode(['error' => 'Unsupported sizes: ' . implode(', ', $unsupported)]);
        exit;
    }
    $product['availableSizes'] = $sizes;
}
unset($product);

$directory = dirname($storageFile);
if (!is_dir($directory)) {
    mkdir($directory, 0775, true);
}

if (file_put_contents($storageFile, json_encode(['products' => $products])) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to save products']);
    exit;
}

echo json_encode(['ok' => true]);
