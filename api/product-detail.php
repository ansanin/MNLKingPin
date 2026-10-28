<?php
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');

$productId = trim((string)($_GET['id'] ?? ''));
if ($productId === '' || strlen($productId) > 120) {
    http_response_code(400);
    echo json_encode(['error' => 'A valid product ID is required.']);
    exit;
}

$storageFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'products.json';
$saved = is_file($storageFile) ? json_decode(file_get_contents($storageFile), true) : [];
$products = is_array($saved['products'] ?? null) ? $saved['products'] : [];
foreach ($products as $product) {
    if ((string)($product['id'] ?? '') === $productId) {
        echo json_encode(['product' => $product]);
        exit;
    }
}

http_response_code(404);
echo json_encode(['error' => 'Product not found.']);