# 公告系统API文档

## 概述

本文档描述了公告系统的API接口，这些接口允许外部应用程序通过HTTP请求与公告系统进行交互。所有API请求都需要通过token认证。

## 认证方式

所有API请求都需要在HTTP请求头中包含`Authorization`头，用于验证身份。

### 认证头格式

```
Authorization: Bearer YOUR_API_TOKEN
```

或者直接提供token：

```
Authorization: YOUR_API_TOKEN
```

### 获取API Token

您需要在Cloudflare Workers的环境变量中设置`API_TOKEN`变量。这个token将用于验证API请求。

## API端点

所有API端点都以您配置的基础路径为前缀，例如：`/api/announcements`。

### 公告管理API

#### 获取公告列表

```
GET /api/announcements
```

**参数：**

| 参数名 | 类型 | 必填 | 描述 |
|-------|-----|------|------|
| page  | 整数 | 否   | 页码，默认为1 |

**响应示例：**

```json
{
  "announcements": [
    {
      "id": "announcement_1234567890",
      "title": "公告标题",
      "content": "公告内容",
      "createdAt": "2023-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 50
  }
}
```

#### 获取单个公告

```
GET /api/announcements/{id}
```

**参数：**

| 参数名 | 类型 | 必填 | 描述 |
|-------|-----|------|------|
| id    | 字符串 | 是  | 公告ID |

**响应示例：**

```json
{
  "id": "announcement_1234567890",
  "title": "公告标题",
  "content": "公告内容",
  "createdAt": "2023-01-01T00:00:00.000Z"
}
```

#### 添加公告

```
POST /api/announcements
```

**请求体：**

```json
{
  "id": "custom_id", // 可选，不提供则自动生成
  "title": "公告标题",
  "content": "公告内容"
}
```

**响应示例：**

```json
{
  "success": true,
  "id": "custom_id"
}
```

#### 更新公告

```
PUT /api/announcements/{id}
```

**参数：**

| 参数名 | 类型 | 必填 | 描述 |
|-------|-----|------|------|
| id    | 字符串 | 是  | 公告ID |

**请求体：**

```json
{
  "title": "更新后的标题",
  "content": "更新后的内容"
}
```

**响应示例：**

```json
{
  "success": true
}
```

#### 删除公告

```
DELETE /api/announcements/{id}
```

**参数：**

| 参数名 | 类型 | 必填 | 描述 |
|-------|-----|------|------|
| id    | 字符串 | 是  | 公告ID |

**响应示例：**

```json
{
  "success": true
}
```

### 身份验证API

#### 登录验证

```
POST /api/login
```

**请求体：**

```json
{
  "password": "string"
}
```

**成功响应：**

```json
{
  "success": true
}
```

**失败响应：**

```json
{
  "error": "密码错误"
}
```

#### 退出登录

```
GET /logout
```

**成功响应：** 重定向到登录页面

## 错误处理

当API请求失败时，服务器将返回相应的HTTP状态码和JSON格式的错误信息。

**错误响应示例：**

```json
{
  "error": "错误信息描述"
}
```

常见HTTP状态码：

- 400: 请求参数错误
- 401: 未授权（认证失败）
- 404: 资源不存在
- 500: 服务器内部错误

## 示例代码

### JavaScript (Fetch API)

```javascript
async function getAnnouncements() {
  const response = await fetch('https://your-worker.workers.dev/api/announcements', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN'
    }
  });
  
  if (!response.ok) {
    throw new Error('API请求失败');
  }
  
  return await response.json();
}

async function createAnnouncement(title, content) {
  const response = await fetch('https://your-worker.workers.dev/api/announcements', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title,
      content
    })
  });
  
  if (!response.ok) {
    throw new Error('API请求失败');
  }
  
  return await response.json();
}
```

### Python (Requests)

```python
import requests

def get_announcements():
    headers = {
        'Authorization': 'Bearer YOUR_API_TOKEN'
    }
    response = requests.get('https://your-worker.workers.dev/api/announcements', headers=headers)
    response.raise_for_status()  # 如果请求失败则抛出异常
    return response.json()

def create_announcement(title, content):
    headers = {
        'Authorization': 'Bearer YOUR_API_TOKEN',
        'Content-Type': 'application/json'
    }
    data = {
        'title': title,
        'content': content
    }
    response = requests.post('https://your-worker.workers.dev/api/announcements', 
                            headers=headers, json=data)
    response.raise_for_status()  # 如果请求失败则抛出异常
    return response.json()
```

## 注意事项

1. 所有API请求都需要通过HTTPS进行，以确保数据传输的安全性。
2. API Token应妥善保管，不要泄露给未授权的人员。
3. 在Cloudflare Workers环境变量中设置`API_TOKEN`变量后，需要重新部署Worker才能生效。
4. URL中的`https://your-worker.workers.dev`应替换为您实际部署的Worker URL + HOME_URL。