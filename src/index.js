/**
 * 公告系统 - 基于Cloudflare Workers
 *
 * 功能：
 * - 公告内容存储在KV中
 * - 密码保护访问
 * - 支持分页显示公告
 * - 管理界面可添加、编辑、删除公告
 */

// 常量定义
const COOKIE_NAME = 'token';
const COOKIE_EXPIRY = 60 * 60 * 24 * 7; // 7天有效期
const API_TOKEN_HEADER = 'Authorization'; // API Token请求头名称

/**
 * 登录页面HTML模板
 */
function getLoginHtml(error = false) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>公告系统 - 登录</title>
    <style>
      body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; background-color: #ffffff; 
             display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
      .login-container { width: 300px; padding: 20px; border-radius: 5px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
      h1 { color: #4CAF50; text-align: center; }
      input[type="password"] { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; 
                               border-radius: 4px; box-sizing: border-box; }
      button { width: 100%; padding: 10px; background-color: #4CAF50; color: white; border: none; 
               border-radius: 4px; cursor: pointer; }
      button:hover { background-color: #45a049; }
      .error { color: red; text-align: center; margin-top: 10px; }
    </style>
  </head>
  <body>
    <div class="login-container">
      <h1>公告系统</h1>
      <form method="post" action="" enctype="application/x-www-form-urlencoded">
        <input type="password" name="password" placeholder="请输入密码" required>
        <button type="submit">登录</button>
        ${error ? '<div class="error">密码错误，请重试</div>' : ''}
      </form>
      <script>
        // 提交前确保表单提交到当前URL
        document.querySelector('form').addEventListener('submit', function(e) {
          e.preventDefault();
          const form = this;
          form.action = window.location.href; // 设置为当前完整URL
          form.submit();
        });
      </script>
    </div>
  </body>
  </html>`;
}

/**
 * 添加缓存控制头信息
 */
function addNoCacheHeaders(headers) {
  try {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    headers.set('Surrogate-Control', 'no-store');

    // Cloudflare特定的缓存控制头
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('CF-Cache-Status', 'BYPASS');
  } catch (e) {
    console.error('无法修改headers:', e);
    // 错误处理，如果headers不可修改，我们忽略错误继续执行
  }

  return headers;
}

/**
 * 创建带有缓存控制的响应对象
 * @param {string|Blob|ArrayBuffer|ReadableStream} body - 响应体
 * @param {Object} options - 响应选项
 * @returns {Response} 带有缓存控制的响应对象
 */
function createNoCacheResponse(body, options = {}) {
  // 确保headers存在
  options.headers = options.headers || {};

  // 添加缓存控制头信息
  const headers = new Headers(options.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('CF-Cache-Status', 'BYPASS');

  // 更新options中的headers
  options.headers = Object.fromEntries(headers.entries());

  // 创建并返回响应
  return new Response(body, options);
}

/**
 * 验证用户密码
 */
function verifyPassword(request, env) {
  // 如果没有设置密码，则无需验证
  if (!env.AUTH_KEY && !env.PW) {
    return true;
  }

  // 获取实际使用的密码（优先使用AUTH_KEY，向后兼容PW）
  const actualPassword = env.AUTH_KEY || env.PW;

  const cookie = request.headers.get('Cookie') || '';

  // 尝试多种格式匹配Cookie
  let cookieValue = '';

  // 尝试标准匹配
  let match = cookie.match(new RegExp(COOKIE_NAME + '=([^;]+)'));
  if (match) {
    cookieValue = match[1].trim();
  }
  // 尝试作为唯一Cookie匹配（没有分号）
  else if (cookie.startsWith(COOKIE_NAME + '=')) {
    cookieValue = cookie.substring(COOKIE_NAME.length + 1).trim();
  }
  // 尝试在任意位置匹配
  else {
    const regex = new RegExp('\\b' + COOKIE_NAME + '=([^;]+)');
    match = cookie.match(regex);
    if (match) {
      cookieValue = match[1].trim();
    }
  }

  // 允许字符串形式和数字形式的比较
  return cookieValue === actualPassword || cookieValue === String(actualPassword);
}

/**
 * 验证API Token
 * @param {Request} request - 请求对象
 * @param {Object} env - 环境变量
 * @returns {boolean} 验证是否通过
 */
function verifyApiToken(request, env) {
  // 如果没有设置API Token，则不允许API访问
  if (!env.API_TOKEN) {
    return false;
  }
  
  // 从请求头中获取Authorization Token
  const authHeader = request.headers.get(API_TOKEN_HEADER) || '';
  
  // 检查Token格式 (Bearer token格式或直接token)
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    token = authHeader.trim();
  }
  
  // 验证Token是否匹配
  return token === env.API_TOKEN;
}

/**
 * 创建带有认证Cookie和缓存控制的重定向响应
 */
function createAuthRedirect(redirectUrl, password) {
  const headers = new Headers();
  headers.set('Location', redirectUrl);

  // 生成令牌值，简单密码直接使用，复杂密码使用UUID
  const tokenValue = typeof password === 'string' && password.length < 20
      ? password  // 直接使用密码（如果密码很短）
      : crypto.randomUUID(); // 使用UUID（用于复杂密码）

  // 设置认证Cookie，使用根路径
  const cookieValue = `${COOKIE_NAME}=${tokenValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_EXPIRY}`;
  headers.set('Set-Cookie', cookieValue);

  // 添加缓存控制
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');

  return new Response(null, {
    status: 302,
    headers: Object.fromEntries(headers.entries())
  });
}

/**
 * 创建退出登录响应，清除Cookie并重定向到登录页面
 */
function createLogoutRedirect(request, env) {
  const currentUrl = new URL(request.url);
  const basePath = env.HOME_URL || '/';
  const normalizedPath = basePath.startsWith('/') ? basePath : '/' + basePath;
  const redirectUrl = `${currentUrl.protocol}//${currentUrl.host}${normalizedPath}`;

  const headers = new Headers();
  headers.set('Location', redirectUrl);

  // 设置过期的Cookie来清除它
  const cookieValue = `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  headers.set('Set-Cookie', cookieValue);

  // 添加缓存控制
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Surrogate-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');

  return new Response(null, {
    status: 302,
    headers: Object.fromEntries(headers.entries())
  });
}

/**
 * 公告列表和管理页面HTML模板
 */
function getAnnouncementHtml(title, announcements, isAdmin, pagination, basePath, env) {
  // 生成公告列表HTML
  let announcementList = '';
  for (let i = 0; i < announcements.length; i++) {
    const announcement = announcements[i];
    // 添加空值检查，确保title和content存在
    const announcementTitle = announcement.title || '无标题';
    const content = announcement.content || '无内容';
    const id = announcement.id || '';

    announcementList += `
      <div class="announcement" style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color: #333; margin-top: 0; margin-bottom: 10px;">${announcementTitle}</h2>
        <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">${content.replace(/\n/g, '<br>')}</p>
        ${isAdmin && id ? `
          <div class="admin-actions" style="display: flex; gap: 10px;">
            <button onclick="editAnnouncement('${id}')" style="background: #2196F3; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">编辑</button>
            <button onclick="deleteAnnouncement('${id}')" style="background: #f44336; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">删除</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 生成分页HTML
  let paginationHtml = '';
  if (pagination.totalPages > 1) {
    paginationHtml = '<div class="pagination">';
    if (pagination.currentPage > 1) {
      paginationHtml += `<a href="?page=${pagination.currentPage - 1}">上一页</a>`;
    }

    for (let i = 1; i <= pagination.totalPages; i++) {
      if (i === pagination.currentPage) {
        paginationHtml += `<span class="current">${i}</span>`;
      } else {
        paginationHtml += `<a href="?page=${i}">${i}</a>`;
      }
    }

    if (pagination.currentPage < pagination.totalPages) {
      paginationHtml += `<a href="?page=${pagination.currentPage + 1}">下一页</a>`;
    }
    paginationHtml += '</div>';
  }

  // 管理页面表单
  const adminForms = isAdmin ? `
    <div id="addForm" style="display:none; background: #f8f9fa; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 20px;">
      <h2 style="color: #4CAF50; margin-top: 0;">添加公告</h2>
      </br>
      <form id="announcementForm" onsubmit="addAnnouncement(event)">
        <div class="form-group" style="margin-bottom: 15px;">
          <label for="customId" style="display: block; margin-bottom: 5px; font-weight: 600;">ID (可选，留空将自动生成)</label>
          <input type="text" id="customId" name="customId" placeholder="自定义ID" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>
        <div class="form-group" style="margin-bottom: 15px;">
          <label for="title" style="display: block; margin-bottom: 5px; font-weight: 600;">标题</label>
          <input type="text" id="title" name="title" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="content" style="display: block; margin-bottom: 5px; font-weight: 600;">内容</label>
          <textarea id="content" name="content" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; min-height: 150px;"></textarea>
        </div>
        <div style="display: flex; gap: 10px;">
          <button type="submit" style="flex: 1; background: #4CAF50; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">保存</button>
          <button type="button" onclick="document.getElementById('addForm').style.display='none'" style="flex: 1; background: #f44336; color: white; border: none; padding: 10px; border-radius: 4px; cursor: pointer;">取消</button>
        </div>
      </form>
    </div>
    
    <div id="editForm" style="display:none; background: #f8f9fa; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 20px; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 600px; z-index: 1000;">
      <h2 style="color: #4CAF50; margin-top: 0; text-align: center;">编辑公告</h2>
      <form id="editAnnouncementForm" onsubmit="saveEditAnnouncement(event)">
        <div class="form-group" style="margin-bottom: 15px;">
          <label for="editId" style="display: block; margin-bottom: 5px; font-weight: 600;">ID</label>
          <input type="text" id="editId" name="id" readonly style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; background: #f0f0f0;">
          <small style="display: block; margin-top: 5px; color: #666;">ID不可修改</small>
        </div>
        <div class="form-group" style="margin-bottom: 15px;">
          <label for="editTitle" style="display: block; margin-bottom: 5px; font-weight: 600;">标题</label>
          <input type="text" id="editTitle" name="title" required style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 16px;">
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label for="editContent" style="display: block; margin-bottom: 5px; font-weight: 600;">内容</label>
          <textarea id="editContent" name="content" required style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; min-height: 200px; font-size: 16px;"></textarea>
        </div>
        <div style="display: flex; gap: 10px;">
          <button type="submit" style="flex: 1; background: #4CAF50; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: background-color 0.3s;">更新</button>
          <button type="button" onclick="document.getElementById('editForm').style.display='none';
          document.getElementById('announcements').style.opacity = '1';
          document.getElementById('announcements').style.pointerEvents = 'auto'; // 恢复点击事件" style="flex: 1; background: #f44336; color: white; border: none; padding: 12px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: background-color 0.3s;">取消</button>
        </div>
      </form>
    </div>
  ` : '';

  // 管理页面JavaScript
  const adminScript = isAdmin ? `
    <script>
      const basePath = "${basePath}";
      const apiToken = "${env ? (env.API_TOKEN || '') : ''}";
      
      // 添加公告
      async function addAnnouncement(event) {
        event.preventDefault();
        const form = document.getElementById('announcementForm');
        const customId = document.getElementById('customId').value.trim();
        const title = document.getElementById('title').value;
        const content = document.getElementById('content').value;
        
        try {
          const response = await fetch(basePath + '/api/announcements', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiToken
            },
            body: JSON.stringify({ 
              id: customId || undefined, // 如果为空则不发送此字段
              title, 
              content 
            })
          });
          
          if (response.ok) {
            window.location.reload();
          } else {
            const errorData = await response.json().catch(() => ({ error: '添加公告失败' }));
            alert(errorData.error || '添加公告失败');
          }
        } catch (error) {
          // 添加公告失败处理
          alert('添加公告失败');
        }
      }
      
      // 删除公告
      async function deleteAnnouncement(id) {
        if (confirm('确定要删除这条公告吗？')) {
          try {
            const response = await fetch(basePath + '/api/announcements/' + id, {
              method: 'DELETE',
              headers: {
                'Authorization': 'Bearer ' + apiToken
              }
            });
            
            if (response.ok) {
              window.location.reload();
            } else {
              alert('删除公告失败');
            }
          } catch (error) {
            // 删除公告失败处理
            alert('删除公告失败');
          }
        }
      }
      
      // 编辑公告 - 显示表单
      async function editAnnouncement(id) {
        try {
          const response = await fetch(basePath + '/api/announcements/' + id, {
            headers: {
              'Authorization': 'Bearer ' + apiToken
            }
          });
          const data = await response.json();
          
          document.getElementById('editId').value = id;
          document.getElementById('editTitle').value = data.title;
          document.getElementById('editContent').value = data.content;
          document.getElementById('editForm').style.display = 'block';
          document.getElementById('announcements').style.opacity = '0.5'; // 半透明公告列表
          document.getElementById('announcements').style.pointerEvents = 'none'; // 禁用点击事件
        } catch (error) {
          console.error('错误:', error);
          alert('获取公告数据失败');
        }
      }
      
      // 在更新和取消按钮的事件处理函数中添加页面刷新逻辑
      async function saveEditAnnouncement(event) {
        event.preventDefault();
        const id = document.getElementById('editId').value;
        const title = document.getElementById('editTitle').value;
        const content = document.getElementById('editContent').value;
        
        try {
          const response = await fetch(basePath + '/api/announcements/' + id, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiToken
            },
            body: JSON.stringify({ id, title, content })
          });
          
          if (response.ok) {
            window.location.reload();
          } else {
            const errorData = await response.json().catch(() => ({ error: '更新公告失败' }));
            alert(errorData.error || '更新公告失败');
          }
        } catch (error) {
          // 更新公告失败处理
          alert('更新公告失败');
        }
        document.getElementById('announcements').style.display = 'block'; // 显示公告列表
      }
      
      // 退出登录
      function logout() {
        if (confirm('确定要退出登录吗？')) {
          window.location.href = basePath + '/logout';
        }
      }
    </script>
  ` : `
    <script>
      // 退出登录
      function logout() {
        if (confirm('确定要退出登录吗？')) {
          window.location.href = "${basePath}/logout";
        }
      }
    </script>
  `;

  // 添加刷新公告数据的JavaScript
  const refreshScript = `
    <script>
      // 添加缓存破坏参数的函数
      function addCacheBuster(url) {
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + '_cb=' + Date.now();
      }
      
      // 重写所有API请求的fetch，添加时间戳参数
      const originalFetch = window.fetch;
      window.fetch = function(url, options) {
        // 如果是API请求，添加缓存破坏参数
        if (typeof url === 'string' && url.includes('/api/')) {
          url = addCacheBuster(url);
        }
        return originalFetch(url, options);
      };
      
      // 修复异步消息通道关闭的问题 - 确保所有事件监听器正确处理Promise
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        // 包装异步事件监听器，确保Promise被正确处理
        if (typeof listener === 'function') {
          const wrappedListener = async function(event) {
            try {
              const result = listener.apply(this, arguments);
              // 如果返回Promise，确保它被处理
              if (result && typeof result.then === 'function') {
                await result;
              }
            } catch (error) {
              console.error('事件监听器错误:', error);
            }
          };
          return originalAddEventListener.call(this, type, wrappedListener, options);
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
      
      // 监听所有a标签点击事件，为分页链接添加缓存破坏参数
      document.addEventListener('click', function(e) {
        if (e.target.tagName === 'A' && e.target.href && e.target.href.includes('page=')) {
          e.preventDefault();
          window.location.href = addCacheBuster(e.target.href);
        }
      }, true);
      
      // 每60秒自动刷新页面内容
      ${isAdmin ? '' : 'setInterval(() => { window.location.reload(); }, 60000);'}
    </script>
  `;

  // 构建完整HTML
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isAdmin ? '管理' : '查看'}公告</title>
    <style>
      body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; background-color: #ffffff; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
      header { display: flex; justify-content: space-between; align-items: center; 
               margin-bottom: 20px; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
      h1 { color: #4CAF50; margin: 0; }
      .announcement { border-bottom: 1px solid #eee; padding: 15px 0; margin-bottom: 15px; }
      .announcement h2 { color: #333; margin-top: 0; }
      .announcement p { color: #666; line-height: 1.6; }
      .admin-actions { margin-top: 10px; }
      button, .btn { background-color: #4CAF50; color: white; border: none; padding: 8px 12px; 
                   margin-right: 5px; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
      button:hover, .btn:hover { background-color: #45a049; }
      .logout-btn { background-color: #f44336; }
      .logout-btn:hover { background-color: #d32f2f; }
      .actions { display: flex; align-items: center; }
      .pagination { margin-top: 20px; text-align: center; }
      .pagination a, .pagination span { display: inline-block; padding: 8px 14px; margin: 0 2px; border-radius: 4px; }
      .pagination a { background-color: #4CAF50; color: white; text-decoration: none; }
      .pagination a:hover { background-color: #45a049; }
      .pagination .current { background-color: #ddd; color: #333; }
      #addForm, #editForm { margin-top: 20px; background-color: #f9f9f9; padding: 15px; border-radius: 5px; }
      .form-group { margin-bottom: 15px; }
      .form-group label { display: block; margin-bottom: 5px; font-weight: bold; color: #333; }
      .form-group input, .form-group textarea { width: 100%; padding: 8px; border: 1px solid #ddd; 
                                             border-radius: 4px; box-sizing: border-box; }
      .form-group textarea { min-height: 100px; resize: vertical; }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>${title}</h1>
        <div class="actions">
          ${isAdmin
      ? `<button class="btn" onclick="window.location.href='${basePath}'">返回首页</button>`
      : `<button class="btn" onclick="window.location.href='${basePath}/admin'">管理页面</button>`
  }
          ${isAdmin ? `<button class="btn" onclick="document.getElementById('addForm').style.display='block'">添加新公告</button>` : ''}
          <button class="btn logout-btn" onclick="logout()">退出登录</button>
        </div>
      </header>
      
      ${adminForms}
      
      <div id="announcements">
        ${announcementList || '<p>暂无公告</p>'}
      </div>
      
      ${paginationHtml}
      
      
    </div>
    
    ${adminScript}
    ${refreshScript}
  </body>
  </html>`;
}

/**
 * 处理身份验证和登录流程
 */
async function handleAuth(request, env) {
  // 检查是否是API请求，如果是API请求则尝试验证API Token
  const url = new URL(request.url);
  const path = url.pathname;
  const basePath = env.HOME_URL || '/';
  const normalizedBasePath = basePath.startsWith('/') ? basePath : '/' + basePath;
  
  // 判断是否为API请求
  if (path.includes('/api/') && path.startsWith(normalizedBasePath + '/api/')) {
    // 如果API Token验证通过，则允许访问
    if (verifyApiToken(request, env)) {
      return null;
    }
    
    // API请求未通过认证，返回JSON格式的错误信息
    return new Response(JSON.stringify({ error: "认证失败，请提供有效的API Token" }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    });
  }
  
  // 常规Cookie验证
  if (verifyPassword(request, env)) {
    return null;
  }

  // 处理登录表单提交
  if (request.method === 'POST') {
    try {
      // 检查是否是API登录请求
      const isApiLogin = path.includes('/api/login');
      
      // 提取密码
      let password = '';
      const contentType = request.headers.get('Content-Type') || '';

      // 根据不同的内容类型使用不同的解析方法
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const formData = await request.formData().catch(() => new FormData());
        password = formData.get('password')?.trim() || '';
      } else if (contentType.includes('application/json')) {
        const jsonData = await request.json().catch(() => ({}));
        password = jsonData.password?.trim() || '';
      } else {
        // 尝试手动解析表单数据
        const text = await request.text();
        const match = text.match(/password=([^&]+)/);
        if (match) {
          password = decodeURIComponent(match[1]).trim();
        }
      }

      // 获取实际使用的密码（优先使用AUTH_KEY，向后兼容PW）
      const actualPassword = env.AUTH_KEY || env.PW;

      if (password === actualPassword) {
        // 如果是API登录请求，返回JSON成功响应
        if (isApiLogin) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
            }
          });
        }
        
        // 常规登录请求，构建重定向URL
        let redirectUrl;
        try {
          const currentUrl = new URL(request.url);
          const relPath = env.HOME_URL || '/';
          const normalizedPath = relPath.startsWith('/') ? relPath : '/' + relPath;
          redirectUrl = `${currentUrl.protocol}//${currentUrl.host}${normalizedPath}`;
        } catch (e) {
          redirectUrl = request.url;
        }

        // 创建带认证Cookie的重定向
        return createAuthRedirect(redirectUrl, actualPassword);
      } else {
        // 密码不匹配
        if (isApiLogin) {
          // API登录请求返回JSON错误响应
          return new Response(JSON.stringify({ error: "密码错误" }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
            }
          });
        } else {
          // 常规登录请求显示HTML错误页面
          return createNoCacheResponse(getLoginHtml(true), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 401
          });
        }
      }
    } catch (error) {
      // 处理错误
      const isApiLogin = path.includes('/api/login');
      if (isApiLogin) {
        // API登录请求返回JSON错误响应
        return new Response(JSON.stringify({ error: "请求处理失败" }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
          }
        });
      } else {
        // 常规登录请求显示HTML错误页面
        return createNoCacheResponse(getLoginHtml(true), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 400
        });
      }
    }
  }

  // 检查是否是API请求
  if (path.includes('/api/')) {
    // API请求返回JSON格式的错误响应
    return new Response(JSON.stringify({ error: "认证失败，请提供有效的认证信息" }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    });
  }
  
  // 非API请求显示HTML登录页面
  return createNoCacheResponse(getLoginHtml(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 401
  });
}

/**
 * 获取公告列表（带分页）
 */
async function getAnnouncements(env, page, pageSize) {
  // 默认值设置
  page = page || 1;
  pageSize = pageSize || 10;

  try {
    // 检查KV是否可用
    if (!env.KV) {
      throw new Error('KV绑定不可用');
    }

    // 获取所有公告键 - 使用无缓存选项
    const keys = await env.KV.list({ limit: 1000 }).catch(err => {
      throw new Error('无法获取公告列表: ' + (err.message || '未知错误'));
    });

    const announcements = [];

    // 获取每条公告内容
    if (keys && Array.isArray(keys.keys)) {

      // 使用Promise.all并行获取所有公告内容，提高性能
      const fetchPromises = keys.keys.map(async (key) => {
        try {
          // 使用no-cache选项获取值，确保从源读取
          const value = await env.KV.get(key.name, { type: 'json' }).catch(() => null);
          return value; // 确保返回获取到的值
        } catch (keyError) {
          return null;
        }
      });

      // 等待所有请求完成并过滤掉null值
      const results = await Promise.all(fetchPromises);
      announcements.push(...results.filter(item => item !== null));
    }

    // 分页处理
    const totalItems = announcements.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    page = Math.min(totalPages, Math.max(1, page)); // 确保页码有效

    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);
    const paginatedItems = announcements.slice(startIndex, endIndex);

    // 返回分页结果

    return {
      announcements: paginatedItems,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems
      }
    };
  } catch (error) {
    // 获取错误信息
    const errorMessage = error.message || '未知错误';

    // 返回空结果但保留错误信息
    return {
      announcements: [],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: 0
      },
      error: errorMessage
    };
  }
}

/**
 * 主请求处理函数
 */
async function handleRequest(request, env, ctx) {
  try {
    let path = '/';
    let originalUrl = '';

    // 安全解析URL
    try {
      const url = new URL(request.url);
      path = url.pathname;
      originalUrl = request.url;
    } catch (e) {
      // 拦截所有无法解析URL的请求
      return new Response(null, { status: 204 });
    }

    // 所有不是确切匹配HOME_URL的请求都拦截
    const basePath = env.HOME_URL || '/';
    // 转换为小写进行比较，使路径大小写不敏感
    const lowerPath = path.toLowerCase();
    const lowerBasePath = basePath.toLowerCase();

    // 处理退出登录请求
    const logoutPath = basePath + '/logout';
    const logoutPathLower = logoutPath.toLowerCase();
    if (lowerPath === logoutPathLower || lowerPath === logoutPathLower + '/') {
      return createLogoutRedirect(request, env);
    }

    // 根目录处理 - 直接拦截无返回
    if (path === '/' || path === '') {
      return createNoCacheResponse(null, { status: 204 });
    }
    // // 处理favicon.ico请求
    // if (lowerPath.endsWith('/favicon.ico')) {
    //   // 直接返回200状态码，让浏览器知道请求成功
    //   // 浏览器会自动使用根目录或public目录下的favicon.ico
    //   return new Response(null, {
    //     status: 200,
    //     headers: {
    //       'Content-Type': 'image/x-icon'
    //     }
    //   });
    // }

    // 路径匹配检查 - 放宽条件，处理尾部斜杠差异
    const normalizedLowerPath = lowerPath.endsWith('/') ? lowerPath.slice(0, -1) : lowerPath;
    const normalizedLowerBasePath = lowerBasePath.endsWith('/') ? lowerBasePath.slice(0, -1) : lowerBasePath;

    if (normalizedLowerPath !== normalizedLowerBasePath &&
        !normalizedLowerPath.startsWith(normalizedLowerBasePath + '/')) {
      // 如果不是指定路径或其子路径，明确拒绝访问
      return createNoCacheResponse('拒绝访问 - 403 Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // 其他路径正常处理

    // 处理主页请求 - 改为更宽松的匹配，考虑尾部斜杠差异
    if (normalizedLowerPath === normalizedLowerBasePath) {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 获取页码参数
      let page = 1;
      try {
        const url = new URL(request.url);
        if (url.searchParams.has('page')) {
          const pageParam = parseInt(url.searchParams.get('page'), 10);
          if (!isNaN(pageParam) && pageParam > 0) {
            page = pageParam;
          }
        }
      } catch (e) {
        // 使用默认页码
      }

      try {
        // 获取公告列表并渲染页面
        const result = await getAnnouncements(env, page, 10);

        // 检查是否有错误信息
        if (result.error) {
          return createNoCacheResponse(`<html><body><h1>加载公告失败</h1><p>错误信息: ${result.error}</p><p><a href="${basePath}?_cb=${Date.now()}">点击重试</a></p></body></html>`, {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        const html = getAnnouncementHtml('公告列表', result.announcements, false, result.pagination, basePath);

        return createNoCacheResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      catch (error) {
        return createNoCacheResponse('加载公告失败: ' + (error.message || '未知错误'), {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }

    // 处理管理页面请求
    if (normalizedLowerPath === normalizedLowerBasePath + '/admin') {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 获取页码参数
      let page = 1;
      try {
        const url = new URL(request.url);
        if (url.searchParams.has('page')) {
          const pageParam = parseInt(url.searchParams.get('page'), 10);
          if (!isNaN(pageParam) && pageParam > 0) {
            page = pageParam;
          }
        }
      } catch (e) {
        // 使用默认页码
      }

      try {
        // 获取公告列表并渲染页面
        const result = await getAnnouncements(env, page, 10);

        // const html = getAnnouncementHtml('公告列表', result.announcements, false, result.pagination, basePath, env);
        const html = getAnnouncementHtml('公告管理', result.announcements, true, result.pagination, basePath, env);
        return createNoCacheResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } catch (error) {
        return createNoCacheResponse('加载管理页面失败: ' + (error.message || '未知错误'), {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }

    // API - 获取公告列表
    if (normalizedLowerPath === normalizedLowerBasePath + '/api/announcements' && request.method === 'GET') {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 获取页码参数
      let page = 1;
      try {
        const url = new URL(request.url);
        if (url.searchParams.has('page')) {
          const pageParam = parseInt(url.searchParams.get('page'), 10);
          if (!isNaN(pageParam) && pageParam > 0) {
            page = pageParam;
          }
        }
        console.log(`API获取公告列表，页码: ${page}`);
      } catch (e) {
        console.error('URL参数解析错误:', e);
        // 使用默认页码
      }

      try {
        // 检查KV是否可用
        if (!env.KV) {
          console.error('KV绑定不可用，请检查Worker配置');
          throw new Error('KV绑定不可用');
        }

        // 获取并返回公告列表
        console.log('API开始获取公告列表...');
        const result = await getAnnouncements(env, page, 10);

        console.log('API获取公告列表成功:', {
          公告数量: result.announcements.length,
          分页信息: result.pagination
        });

        // 检查是否有错误信息
        if (result.error) {
          console.error('API获取公告列表时发生错误:', result.error);
          return createNoCacheResponse(JSON.stringify({ error: result.error }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return createNoCacheResponse(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('API获取公告列表失败:', error);
        return createNoCacheResponse(JSON.stringify({
          error: error.message || '获取公告列表失败',
          announcements: [],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalItems: 0
          }
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // API - 获取单个公告
    if (request.method === 'GET' && normalizedLowerPath.startsWith(normalizedLowerBasePath + '/api/announcements/')) {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 提取公告ID
      const segments = path.split('/');
      const id = segments[segments.length - 1];

      try {
        console.log(`正在获取单个公告，ID: ${id}`);

        // 检查KV是否可用
        if (!env.KV) {
          console.error('KV绑定不可用，请检查Worker配置');
          throw new Error('KV绑定不可用');
        }

        // 获取公告内容 - 使用无缓存选项
        const announcement = await env.KV.get(id, { type: 'json' }).catch(err => {
          console.error(`获取公告失败 (${id}):`, err);
          throw new Error(`获取公告失败: ${err.message || '未知错误'}`);
        });

        if (!announcement) {
          console.log(`公告不存在，ID: ${id}`);
          return createNoCacheResponse(JSON.stringify({ error: '公告不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        console.log(`成功获取公告，ID: ${id}，标题: ${announcement.title}`);
        return createNoCacheResponse(JSON.stringify(announcement), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error(`获取单个公告时出错:`, error);
        return createNoCacheResponse(JSON.stringify({ error: error.message || '获取公告失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // API - 添加公告
    if (normalizedLowerPath === normalizedLowerBasePath + '/api/announcements' && request.method === 'POST') {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      try {
        // 检查KV是否可用
        if (!env.KV) {
          console.error('KV绑定不可用，请检查Worker配置');
          throw new Error('KV绑定不可用');
        }

        // 解析请求数据
        const data = await request.json().catch(err => {
          console.error('解析JSON请求数据失败:', err);
          throw new Error('无效的JSON数据');
        });

        console.log('收到添加公告请求:', data);

        // 验证数据
        if (!data.title || !data.content) {
          return createNoCacheResponse(JSON.stringify({ error: '标题和内容不能为空' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 使用自定义ID或生成唯一ID
        let id;
        if (data.id && typeof data.id === 'string' && data.id.trim()) {
          id = data.id.trim();

          // 检查ID是否已存在
          const exists = await env.KV.get(id).catch(err => {
            console.error(`检查ID是否存在失败 (${id}):`, err);
            throw new Error('检查ID是否存在失败: ' + (err.message || '未知错误'));
          });

          if (exists) {
            return createNoCacheResponse(JSON.stringify({ error: `ID "${id}" 已存在，请使用其他ID` }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } else {
          // 生成唯一ID
          id = 'announcement_' + Date.now();
        }

        // 构建公告对象，确保数据结构一致
        const announcement = {
          id: id,
          title: data.title.trim(),
          content: data.content.trim(),
          createdAt: new Date().toISOString()
        };

        // 存储到KV
        await env.KV.put(id, JSON.stringify(announcement)).catch(err => {
          console.error('存储公告到KV失败:', err);
          throw new Error('存储公告失败: ' + (err.message || '未知错误'));
        });

        console.log('成功添加新公告:', {
          id: id,
          title: data.title,
          contentLength: data.content.length
        });

        return createNoCacheResponse(JSON.stringify({ success: true, id: id }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('添加公告失败:', error);
        return createNoCacheResponse(JSON.stringify({ error: error.message || '请求数据无效' }), {
          status: error.message === '无效的JSON数据' ? 400 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // API - 更新公告
    if (request.method === 'PUT' && normalizedLowerPath.startsWith(normalizedLowerBasePath + '/api/announcements/')) {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 提取公告ID
      const segments = path.split('/');
      const id = segments[segments.length - 1];

      try {
        // 检查KV是否可用
        if (!env.KV) {
          console.error('KV绑定不可用，请检查Worker配置');
          throw new Error('KV绑定不可用');
        }

        console.log(`正在更新公告，ID: ${id}`);

        // 检查公告是否存在 - 使用无缓存选项
        const existingData = await env.KV.get(id, { type: 'json' }).catch(err => {
          console.error(`检查公告是否存在失败 (${id}):`, err);
          throw new Error('检查公告是否存在失败: ' + (err.message || '未知错误'));
        });

        if (!existingData) {
          console.log(`要更新的公告不存在，ID: ${id}`);
          return createNoCacheResponse(JSON.stringify({ error: '公告不存在' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 解析请求数据
        const data = await request.json().catch(err => {
          console.error('解析JSON请求数据失败:', err);
          throw new Error('无效的JSON数据');
        });

        console.log('收到更新公告请求:', data);

        // 验证数据
        if (!data.title || !data.content) {
          return createNoCacheResponse(JSON.stringify({ error: '标题和内容不能为空' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 验证ID是否匹配
        if (data.id && data.id !== id) {
          return createNoCacheResponse(JSON.stringify({ error: 'ID不匹配，不允许修改ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 构建更新后的公告对象，保留原有字段，更新新字段
        const updatedAnnouncement = {
          ...existingData,  // 保留原有数据
          id: id,           // 确保ID一致
          title: data.title.trim(),
          content: data.content.trim(),
          updatedAt: new Date().toISOString()
        };

        // 更新KV
        await env.KV.put(id, JSON.stringify(updatedAnnouncement)).catch(err => {
          console.error('更新公告到KV失败:', err);
          throw new Error('更新公告失败: ' + (err.message || '未知错误'));
        });

        console.log('成功更新公告:', {
          id: id,
          title: data.title,
          contentLength: data.content.length
        });

        return createNoCacheResponse(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('更新公告失败:', error);
        return createNoCacheResponse(JSON.stringify({ error: error.message || '请求数据无效' }), {
          status: error.message === '无效的JSON数据' ? 400 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // API - 删除公告
    if (request.method === 'DELETE' && normalizedLowerPath.startsWith(normalizedLowerBasePath + '/api/announcements/')) {
      // 验证身份
      const authResponse = await handleAuth(request, env);
      if (authResponse) return authResponse;

      // 提取公告ID
      const segments = path.split('/');
      const id = segments[segments.length - 1];

      try {
        // 检查KV是否可用
        if (!env.KV) {
          console.error('KV绑定不可用，请检查Worker配置');
          throw new Error('KV绑定不可用');
        }

        console.log(`正在删除公告，ID: ${id}`);

        // 检查公告是否存在
        const exists = await env.KV.get(id).catch(err => {
          console.error(`检查公告是否存在失败 (${id}):`, err);
          throw new Error('检查公告是否存在失败: ' + (err.message || '未知错误'));
        });

        if (!exists) {
          console.log(`要删除的公告不存在，ID: ${id}`);
          // 即使不存在也返回成功，因为最终结果是一样的
          return createNoCacheResponse(JSON.stringify({ success: true, message: '公告不存在或已被删除' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 删除公告
        await env.KV.delete(id).catch(err => {
          console.error(`删除公告失败 (${id}):`, err);
          throw new Error('删除公告失败: ' + (err.message || '未知错误'));
        });

        console.log(`成功删除公告，ID: ${id}`);
        return createNoCacheResponse(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('删除公告失败:', error);
        return createNoCacheResponse(JSON.stringify({ error: error.message || '删除公告失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 到这里说明所有路由都不匹配，拦截!
    return createNoCacheResponse(null, { status: 204 });
  } catch (error) {
    console.error('请求处理主函数错误:', error);
    return createNoCacheResponse('服务器错误: ' + (error.message || '未知错误'), {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// 导出处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      // 确保环境变量正确映射
      if (env.AUTH_KEY === undefined && env.vars && env.vars.AUTH_KEY) {
        env.AUTH_KEY = env.vars.AUTH_KEY;
      }
      
      // 映射API Token环境变量
      if (env.API_TOKEN === undefined && env.vars && env.vars.API_TOKEN) {
        env.API_TOKEN = env.vars.API_TOKEN;
      }

      // 确保KV绑定正确
      if (!env.KV && env.NAMESPACE) {
        env.KV = env.NAMESPACE;
      }

      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('请求处理错误:', error);
      return createNoCacheResponse('内部服务器错误: ' + (error.message || '未知错误'), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};