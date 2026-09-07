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

$storageFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'orders.json';

function readOrders($storageFile) {
    if (!is_file($storageFile)) return [];
    $saved = json_decode(file_get_contents($storageFile), true);
    return is_array($saved['orders'] ?? null) ? $saved['orders'] : [];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['orders' => readOrders($storageFile)]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$order = json_decode(file_get_contents('php://input'), true);
if (!is_array($order) || empty($order['id']) || empty($order['customerEmail'])) {
    http_response_code(400);
    echo json_encode(['error' => 'A valid order is required']);
    exit;
}

$directory = dirname($storageFile);
if (!is_dir($directory)) mkdir($directory, 0775, true);

$orders = readOrders($storageFile);
$orderUpdated = false;
foreach ($orders as $index => $savedOrder) {
    if ((string) ($savedOrder['id'] ?? '') === (string) $order['id']) {
        $orders[$index] = $order;
        $orderUpdated = true;
        break;
    }
}

if (!$orderUpdated) $orders[] = $order;

if (file_put_contents($storageFile, json_encode(['orders' => array_slice($orders, -500)]), LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to save order']);
    exit;
}

echo json_encode(['ok' => true]);