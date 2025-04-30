# Cloudflare Worker 公告系统

基于Cloudflare Workers构建的公告系统，使用KV存储公告内容，提供密码保护和完整的管理功能。

## 功能特性

- 公告内容存储在Cloudflare KV中
- 密码保护访问
- 分页显示公告
- 管理界面支持添加、编辑、删除公告
- 响应式设计，适配移动设备
- API Token认证，支持外部应用调用

## API接口

本项目现已支持通过API Token进行认证，允许外部应用程序调用API接口。详细的API文档请参阅[API.md](./API.md)文件。

### 配置API Token

1. 在Cloudflare Workers的环境变量中添加`API_TOKEN`变量
2. 设置一个安全的、随机生成的字符串作为Token值
3. 重新部署Worker使配置生效

### 使用API Token

在请求头中添加`Authorization`头进行认证：

```
Authorization: Bearer YOUR_API_TOKEN
```

## 部署指南

1. 修改`wrangler.toml`文件:
   - FORK本仓库，并修改 `wrangler.toml` 文件 
   - 将`name`字段设置为你的Worker名称 
   - HOME_URL = "/你的安全路径"
   - PW = "你的密码"

2. 配置KV命名空间:
   - 登录Cloudflare Dashboard
   - 进入Workers > KV
   - 点击"创建命名空间"
   - 输入名称(如"ANNOUNCEMENTS_KV")并创建
   - 复制KV空间ID 
   - `wrangler.toml`文件中`kv_namespaces`字段中id为你的KV空间ID

3. 配置环境变量:
   - 访问`/admin`路径进入管理界面
   - 使用环境变量`AUTH_KEY`或`PW`设置访问密码
   - 通过环境变量`HOME_URL`配置安全路径
4. 部署 
   - Cloudflare Worker后台绑定github部署



## 使用说明

- 访问`你的地址+/安全路径+/admin`路径进入管理界面
- 使用环境变量`AUTH_KEY`或`PW`设置访问密码
- 通过环境变量`HOME_URL`配置安全路径
- [查看API文档](./API.md)


## 技术栈
- Cloudflare Workers
- Cloudflare KV存储
- HTML5/CSS3/JavaScript