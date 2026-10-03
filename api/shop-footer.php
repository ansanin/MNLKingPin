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

$storageFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'shop_footer.json';

function readFooterSettings($storageFile) {
    if (!is_file($storageFile)) return ['location' => '', 'facebookUrl' => '', 'instagramUrl' => ''];
    $saved = json_decode(file_get_contents($storageFile), true);
    return is_array($saved) ? [
        'location' => (string) ($saved['location'] ?? ''),
        'facebookUrl' => (string) ($saved['facebookUrl'] ?? ''),
        'instagramUrl' => (string) ($saved['instagramUrl'] ?? '')
    ] : ['location' => '', 'facebookUrl' => '', 'instagramUrl' => ''];
}

function normalizeFooterUrl($value) {
    $value = trim((string) $value);
    if ($value === '') return '';
    if (!preg_match('/^https?:\/\//i', $value)) $value = 'https://' . $value;
    $parts = parse_url($value);
    if (!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || empty($parts['host'])) return false;
    return $value;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['footerSettings' => readFooterSettings($storageFile)]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'Footer settings are required']);
    exit;
}

$location = trim((string) ($payload['location'] ?? ''));
$facebookUrl = normalizeFooterUrl($payload['facebookUrl'] ?? '');
$instagramUrl = normalizeFooterUrl($payload['instagramUrl'] ?? '');
if ($facebookUrl === false || $instagramUrl === false || strlen($location) > 300) {
    http_response_code(400);
    echo json_encode(['error' => 'Enter valid web links and a location under 300 characters']);
    exit;
}

$directory = dirname($storageFile);
if (!is_dir($directory)) mkdir($directory, 0775, true);
$settings = ['location' => $location, 'facebookUrl' => $facebookUrl, 'instagramUrl' => $instagramUrl];
if (file_put_contents($storageFile, json_encode($settings), LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Unable to save footer settings']);
    exit;
}

echo json_encode(['ok' => true, 'footerSettings' => $settings]);
