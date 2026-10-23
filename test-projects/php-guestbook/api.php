<?php
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
  ['name' => 'Sara', 'message' => 'Hello from PHP'],
  ['name' => 'Ali',  'message' => 'It works'],
]);
