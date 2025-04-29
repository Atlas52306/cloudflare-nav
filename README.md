# Cloudflare Worker 公告系统

基于Cloudflare Workers构建的公告系统，使用KV存储公告内容，提供密码保护和完整的管理功能。

## 功能特性

- 公告内容存储在Cloudflare KV中
- 密码保护访问
- 分页显示公告
- 管理界面支持添加、编辑、删除公告
- 响应式设计，适配移动设备

## 部署指南

1. FORK本仓库
Cloudflare Worker绑定github部署

2. 配置KV命名空间:
   - 登录Cloudflare Dashboard
   - 进入Workers > KV
   - 点击"创建命名空间"
   - 输入名称(如"ANNOUNCEMENTS_KV")并创建

3. 在Worker设置中添加KV绑定:
   - 进入Workers > 你的Worker
   - 点击"设置" > "变量"
   - 在"KV命名空间绑定"部分添加绑定
   - 绑定名称: KV
   - KV命名空间: 选择你创建的命名空间


## 使用说明

- 访问`/admin`路径进入管理界面
- 使用环境变量`AUTH_KEY`或`PW`设置访问密码
- 通过环境变量`HOME_URL`配置安全路径
- [查看API文档](./API.md)


## 技术栈

- Cloudflare Workers
- Cloudflare KV存储
- HTML5/CSS3/JavaScript