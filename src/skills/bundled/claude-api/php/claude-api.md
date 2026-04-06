# PHP Claude API

在 PHP 中，可以先从直接发 HTTPS 请求开始，后续再封装进应用自己的 service layer。

## 最小示例

```php
<?php

$payload = [
    'model' => '{{SONNET_ID}}',
    'max_tokens' => 512,
    'messages' => [
        [
            'role' => 'user',
            'content' => 'Generate a brief API changelog entry.',
        ],
    ],
];

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'x-api-key: ' . getenv('ANTHROPIC_API_KEY'),
        'anthropic-version: 2023-06-01',
        'content-type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
]);

$response = curl_exec($ch);
if ($response === false) {
    throw new RuntimeException(curl_error($ch));
}

$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($status >= 400) {
    throw new RuntimeException("Anthropic API error: HTTP $status\n$response");
}

echo $response . PHP_EOL;
```

## 说明

- 成功响应可用 `json_decode($response, true)` 解析。
- API key 加载、重试和请求日志应作为共享基础设施，而不是散落在各个 controller 里。
- 如果需要强类型模型，等请求和响应结构稳定后再引入 DTO。
