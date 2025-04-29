# 公告系统API文档

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