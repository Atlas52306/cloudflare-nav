# 公告系统API文档

## 认证相关
- **登录验证**  
  - 路径：`/admin` (GET/POST)
  - 请求参数：`password` (表单字段)
  - 成功：设置认证Cookie并重定向
  - 失败：返回401状态码和错误页面

- **退出登录**  
  - 路径：`/logout` (GET)
  - 效果：清除认证Cookie并重定向

## 公告管理API
- **添加公告**  
  - 路径：`/api/announcements` (POST)
  - 请求体：
    ```json
    {
      "id": "可选自定义ID",
      "title": "string",
      "content": "string"
    }
    ```
  - 成功响应：`{"success": true, "id": "生成或指定的ID"}`

- **更新公告**  
  - 路径：`/api/announcements/{id}` (PUT)
  - 请求体：同添加公告
  - 成功响应：`{"success": true}`

- **删除公告**  
  - 路径：`/api/announcements/{id}` (DELETE)
  - 成功响应：`{"success": true}`