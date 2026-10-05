# 部署文档 · 前后端分离计算器系统

本文档描述如何把本项目部署到一台 Linux 服务器（以 Debian 12 / Ubuntu 22.04 为例），
使助教在作业评价期内可以公网访问。

---

## 目录

- [部署架构](#部署架构)
- [前置检查](#前置检查)
- [一、部署后端](#一部署后端)
- [二、部署前端](#二部署前端)
- [三、配置 nginx](#三配置-nginx)
- [四、配置 HTTPS](#四配置-https)
- [五、验收测试](#五验收测试)
- [六、日常运维](#六日常运维)
- [故障排查](#故障排查)
- [附录：资源占用实测](#附录资源占用实测)

---

## 部署架构

```
                    Internet
                        │
                        ▼
              ┌───────────────────┐
              │      nginx        │  :443 (HTTPS)
              │                   │
              │  /      -> 静态文件 │
              │  /api/  -> 反向代理 │
              └─────────┬─────────┘
                        │ 127.0.0.1:5000
                        ▼
              ┌───────────────────┐
              │  Node 后端进程     │  systemd 管理
              │  Express + SQLite │  内存上限 192MB
              └─────────┬─────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ calculator.sqlite │
              └───────────────────┘
```

**关键设计**：后端只监听 `127.0.0.1`，不直接暴露公网。
所有外部流量必须经过 nginx。这样后端不需要处理 TLS、限流、静态文件，
攻击面也更小。

**为什么前端与接口同源**：nginx 让前端页面与 `/api` 处在同一个域名下，
浏览器不会发起跨域请求，因此无须配置 CORS，也不会出现预检失败问题。

---

## 本机实测环境与由此产生的方案调整

> 这一节记录的是对**目标服务器实际探测**的结果。
> 它推翻了若干「通用教程」式的做法，因此放在最前面。
> **照着通用教程做，在这台机器上一定会失败。**

### 实测环境

| 项目 | 实测结果 |
| --- | --- |
| 面板 | **宝塔面板 10.0.2**（`/www/server/panel`） |
| nginx | 1.26.3，编译前缀 `--prefix=/www/server/nginx`，**由宝塔管理** |
| nginx 配置入口 | `/www/server/nginx/conf/nginx.conf`，末尾 `include /www/server/panel/vhost/nginx/*.conf;` |
| `/etc/nginx/nginx.conf` | **不存在** |
| `/etc/nginx/sites-available/`、`sites-enabled/` | **不存在 / 为空** |
| 已监听端口 | 80（宝塔内部状态服务）、8443（DSH 面板反代）、888（phpMyAdmin） |
| ufw | **active**，默认 `deny (incoming)`；放行 22 / 80 / 443 / 6185 / 8443 / 8889 / 8899 / 6100 |
| 云安全组 | 白名单制。实测可达：80 / 8443 / 6185 / 8899 / 6100 / 443；被丢弃：888 / 8000 / 8080 / 3306 |
| Node | `/usr/local/bin/node` v24.15.0（已预装，满足 `node:sqlite` 要求） |
| systemd | 252 |
| `/var/www` | 不存在（宝塔的网站根目录约定是 `/www/wwwroot/`） |
| 资源 | 可用内存约 1.44 GB，磁盘可用 9.9 GB |

### 由实测得出的三点调整

**调整一：nginx 配置的落点不是 `/etc/nginx/`。**

本机 nginx 由宝塔管理，`/etc/nginx/` 是个空壳（只有放证书的 `ssl/` 与
面板自己的 `htpasswd_dsh`）。按 Debian 惯例放入 `sites-available/` 再软链，
**不会被加载**。

正确落点是：

```
/www/server/panel/vhost/nginx/calculator.conf
```

该目录被 `nginx.conf` 以 `include .../vhost/nginx/*.conf;` 加载。
宝塔不会覆盖手工放入的文件（它只重写自己创建的站点配置）。
对应模板：`deploy/nginx-bt-panel.conf.example`。

**调整二：用 80 端口，不要用 8000。**

放行规则是**两层白名单**：ufw 与云安全组。实测 8000 在两层都被拦，
因此用 8000 必须同时 `ufw allow` **并登录云控制台添加安全组规则**。

而 80 端口两层都已放行、nginx 也已经在其上监听，**零改动**即可使用。

与宝塔内置状态服务（`server_name 127.0.0.1`）共存的办法是：
用**公网 IP 作为自己站点的 `server_name`** 做精确匹配，且**不要声明 `default_server`**。
这样：

- 访问 `http://<公网IP>/` → Host 头是该 IP → 命中我们的 server 块；
- 面板内部的监控请求 Host 为 `127.0.0.1` → 仍由宝塔的块处理。

两边的行为都不受影响。

**调整三：`/var/www` 不存在，前端放 `/www/wwwroot/calculator`。**

宝塔的网站根目录约定是 `/www/wwwroot/<站点名>`，沿用该约定便于与面板共存。

### 一处需要更正的早前判断

在最初探测端口时，看到 MySQL 监听在 `*:3306`，曾判断它「公网可达、属于风险暴露」。
**这个判断是错的。** 实际从外网测试 3306 是超时（数据包被丢弃），
说明 ufw 已经拦住了它。

教训是：`ss -ltn` 只反映**本机是否在监听**，不代表**外部能否连上**。
判断暴露面必须从外部实测，而不是只看本机监听列表。
（同样的道理反过来也成立：`ss -ltn` 显示 888 端口在监听，
但它同样被 ufw 挡住，外部不可达。）

### 本机部署命令速查

```bash
# 前端（注意是宝塔的目录约定）
sudo mkdir -p /www/wwwroot/calculator
sudo cp -r calculator_frontend/src/. /www/wwwroot/calculator/
sudo chown -R www:www /www/wwwroot/calculator

# nginx 站点
sudo cp deploy/nginx-bt-panel.conf.example /www/server/panel/vhost/nginx/calculator.conf
sudo sed -i 's/<SERVER_IP>/你的公网IP/; s|<FRONTEND_ROOT>|/www/wwwroot/calculator|' \
     /www/server/panel/vhost/nginx/calculator.conf
sudo nginx -t && sudo systemctl reload nginx

# 无需改防火墙
# 验证
curl -s http://127.0.0.1/api/health
```

> 宝塔面板的「网站」列表里不会显示这个手工创建的站点。
> 这是正常的——面板只管理它自己创建的站点配置。
> 本站点不依赖面板功能，因此没有影响；若要删除，直接删配置文件并重载 nginx 即可。

---

## 前置检查

在服务器上执行，确认环境满足要求：

```bash
# 1. Node 版本必须 >= 22.5.0（node:sqlite 内置模块的要求）
node -v

# 2. nginx 已安装
nginx -v

# 3. 系统是否使用 systemd
systemctl --version | head -1

# 4. 端口占用情况（确认 5000 未被占用，确认 80/443 的归属）
ss -ltn | grep -E ':(80|443|5000)\s'

# 5. 磁盘剩余空间（后端 + 前端合计约 50MB）
df -h /
```

### Node 版本过低怎么办

若 `node -v` 低于 22.5.0，用 NodeSource 安装 Node 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

或用 nvm（仅当前用户可用，systemd 服务需要写绝对路径）：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
which node    # 记下这个路径，填入 systemd 的 <NODE_BIN>
```

> **注意**：若服务器上 80 端口已被其他站点占用（例如已有别的 Web 服务），
> 不要修改已有的 server 块。改用**子域名**方案：
> 为计算器单独解析一个子域名（如 `calc.example.com`），
> 在 nginx 中新建一个 `server_name calc.example.com;` 的 server 块，
> nginx 会按域名分流，与已有站点互不干扰。

---

## 一、部署后端

### 1.1 创建专用用户与目录

不要用 root 运行后端。创建一个不可登录的系统用户：

```bash
sudo useradd --system --shell /usr/sbin/nologin --home /opt/calculator calculator
sudo mkdir -p /opt/calculator
sudo chown -R calculator:calculator /opt/calculator
```

### 1.2 上传代码

**方式 A：从 GitHub 克隆**（推荐，后续便于 `git pull` 更新）

```bash
sudo -u calculator git clone https://github.com/<your-account>/calculator_backend.git /opt/calculator/calculator_backend
```

**方式 B：从本地 rsync 上传**

```bash
# 在本地执行
rsync -avz --exclude node_modules --exclude data \
  calculator_backend/ root@<server-ip>:/opt/calculator/calculator_backend/
sudo chown -R calculator:calculator /opt/calculator/calculator_backend
```

### 1.3 安装依赖

```bash
cd /opt/calculator/calculator_backend
sudo -u calculator npm install --omit=dev
```

本项目只有一个运行依赖（Express），且不含任何原生模块，
因此这一步不会触发编译，通常几秒钟完成。

### 1.4 创建数据目录

```bash
sudo -u calculator mkdir -p /opt/calculator/calculator_backend/data
```

> 无需手动建表。服务启动时会自动执行幂等的建表语句。

### 1.5 注册 systemd 服务

```bash
# 查询 node 的绝对路径
which node
# 例如输出 /usr/bin/node

sudo cp deploy/calculator-backend.service /etc/systemd/system/
sudo nano /etc/systemd/system/calculator-backend.service
# 把 <APP_DIR> 替换为 /opt/calculator/calculator_backend
# 把 <NODE_BIN> 替换为 which node 的输出
```

启动并设为开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now calculator-backend
```

### 1.6 验证后端

```bash
sudo systemctl status calculator-backend

# 本机接口测试
curl -s http://127.0.0.1:5000/api/health

# 计算测试
curl -s -X POST http://127.0.0.1:5000/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"(1+2)*3"}'
```

预期输出：

```json
{"success":true,"id":1,"expression":"(1+2)*3","normalizedExpression":"(1+2)*3","result":9,"resultText":"9","createdAt":"..."}
```

检查内存占用是否符合预期：

```bash
systemctl show calculator-backend -p MemoryCurrent
# 例如 MemoryCurrent=58... 表示约 58MB
```

---

## 二、部署前端

前端是纯静态文件，**不需要 npm install，不需要构建**。

```bash
sudo mkdir -p /var/www/calculator

# 方式 A：从 GitHub 克隆
sudo git clone https://github.com/<your-account>/calculator_frontend.git /tmp/calculator_frontend
sudo cp -r /tmp/calculator_frontend/src/. /var/www/calculator/

# 方式 B：从本地 rsync 上传
# 在本地执行：
# rsync -avz calculator_frontend/src/ root@<server-ip>:/var/www/calculator/

# 设置权限：nginx 只需要读权限
sudo chown -R www-data:www-data /var/www/calculator
sudo find /var/www/calculator -type d -exec chmod 755 {} \;
sudo find /var/www/calculator -type f -exec chmod 644 {} \;
```

> 注意复制的是 `src/` 目录**里面的内容**，让 `index.html` 直接位于
> `/var/www/calculator/` 下。README 与 codestyle 文档不需要部署到 Web 目录。

验证文件是否到位：

```bash
ls -la /var/www/calculator/
# 应看到 index.html、css/、js/
```

---

## 三、配置 nginx

### 3.1 方案选择

| 方案 | 适用场景 | nginx 配置要点 | 配置文件 |
| --- | --- | --- | --- |
| **IP + 端口** | 没有域名；80/443 已被其它站点占用 | nginx 额外监听一个高位端口（如 8000） | `nginx-ip-port.conf.example` |
| 子域名 | 有域名，且 80/443 已被其它站点占用 | 新建 server 块，`server_name calc.example.com;` | `nginx.conf.example` |
| 路径前缀 | 只有一个域名，必须挂在 `/calc/` 下 | 需同时调整接口地址与静态资源路径 | 见 [3.4](#34-路径前缀方案补充) |

**本项目采用「IP + 端口」方案**（无域名）。完整步骤见
[3.5 无域名部署（IP + 端口）](#35-无域名部署ip--端口)。

选择子域名的部署步骤见下面的 3.2 – 3.3。

> **为什么要额外开一个端口，而不是直接用后端的 5000？**
> 让 nginx 统一对外，可以只暴露一个端口、由它同时提供静态文件与接口代理，
> 前端与接口保持同源（因而无需 CORS），后端则始终只监听 `127.0.0.1`。
> 如果直接把后端的 5000 端口暴露到公网，前端就得跨域访问后端，
> 必须配置 CORS，且后端会直接面对全网扫描。

### 3.2 安装配置

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/calculator
sudo nano /etc/nginx/sites-available/calculator
# 替换 <DOMAIN>、<FRONTEND_ROOT>、<CERT_PATH> 三个占位符

sudo ln -s /etc/nginx/sites-available/calculator /etc/nginx/sites-enabled/
```

### 3.3 语法检查与重载

```bash
sudo nginx -t
# 输出 "syntax is ok" 与 "test is successful" 才继续

sudo systemctl reload nginx
```

### 3.4 路径前缀方案补充

如果必须挂在 `https://example.com/calc/` 下，需要做三处调整：

**a) nginx**：把静态文件与接口都放在 `/calc/` 前缀下

```nginx
location /calc/ {
    alias /var/www/calculator/;
    try_files $uri $uri/ /calc/index.html;
}

location /calc/api/ {
    proxy_pass http://calculator_backend/api/;
    # ... 其余 proxy 设置与示例相同
}
```

**b) 前端 HTML 中的资源路径**：`index.html` 里的
`./css/style.css`、`./js/app.js` 是相对路径，在 `/calc/` 下依然正确，无需修改。

**c) 前端接口地址**：在 `index.html` 的 `<head>` 中显式声明：

```html
<script>
  window.__CALCULATOR_CONFIG__ = { apiBaseUrl: '/calc/api' };
</script>
```

或在 `src/js/config.js` 中把 `apiBaseUrl` 直接写死为 `'/calc/api'`。

> 路径前缀会显著增加配置复杂度（静态资源路径、接口路径、Cookie 作用域都要对齐）。
> **除非确有域名限制，否则优先选择 IP + 端口 或 子域名方案。**

### 3.5 无域名部署（IP + 端口）

没有域名时，用「公网 IP + 高位端口」访问。本项目的部署即采用此方案。

#### 3.5.1 为什么不能用 80 / 443

服务器上的 80 端口通常已被其它站点占用（可用 `ss -ltn | grep :80` 与
`nginx -T | grep server_name` 确认）。直接在 80 上加一个 `server_name _` 的
默认 server 会**顶掉已有站点**，属于严重的误操作。

因此做法是让 nginx **额外监听一个高位端口**，为它单独建一个 server 块。
nginx 会按「端口 + server_name」分流，与已有站点互不干扰。

#### 3.5.2 选一个空闲端口

```bash
# 查看已占用的端口
ss -ltn

# 检查候选端口是否空闲（以下命令无输出表示空闲）
ss -ltn | grep -E ':(8000|8080|8081|9000)\s'
```

本文档以 **8000** 为例。若已被占用，换成 8080 / 8081 / 9000 均可，
但记得同步修改 nginx 配置。

> 顺带说明：前端的接口地址推断逻辑会自动识别「同源部署」，
> 无论最终用哪个端口，都会请求 `http://<IP>:<端口>/api`，无需改代码。
> 这条逻辑有 13 个测试用例覆盖（`calculator_frontend` 下执行 `npm test`）。

#### 3.5.3 安装配置

```bash
sudo cp deploy/nginx-ip-port.conf.example /etc/nginx/sites-available/calculator
sudo nano /etc/nginx/sites-available/calculator
# 把 <FRONTEND_ROOT> 替换为 /var/www/calculator
# 如果需要换端口，同时修改两行 listen

sudo ln -s /etc/nginx/sites-available/calculator /etc/nginx/sites-enabled/
sudo nginx -t                     # 必须看到 test is successful
sudo systemctl reload nginx
```

#### 3.5.4 放行端口（最容易漏掉的一步）

**必须同时检查两层，缺一不可：**

**第一层：服务器自身的防火墙**

```bash
# 先看用的是哪个防火墙
sudo ufw status            # Ubuntu 常见
sudo firewall-cmd --state  # CentOS / RHEL 常见
sudo iptables -L -n        # 通用

# 若 ufw 处于 active 状态
sudo ufw allow 8000/tcp

# 若 firewalld 处于 running 状态
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --reload
```

若三者都没有启用（输出显示未激活），说明主机层没有防火墙，跳到第二层。

**第二层：云服务商的安全组 / 网络 ACL**

这一步在云厂商的控制台完成，命令行改不了。
多数云服务器**默认只放行 22 / 80 / 443**，新端口必须在控制台的安全组里
手动添加入方向规则：

```
协议：TCP
端口：8000
来源：0.0.0.0/0
```

> **这是本方案最容易卡住的地方。** 表现是：服务器本机 `curl` 能通，
> 但从外网访问一直超时。遇到这种情况先怀疑安全组，而不是 nginx 配置。

#### 3.5.5 验证

在**服务器本机**：

```bash
curl -s http://127.0.0.1:8000/healthz
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/
```

在**你自己的电脑**上（这一步才能验证安全组是否放行）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<公网IP>:8000/
curl -s http://<公网IP>:8000/api/health
```

两个都返回 `200` 才算成功。

#### 3.5.6 关于 HTTPS

Let's Encrypt **不为纯 IP 签发证书**，因此本方案只能使用 HTTP。

这对本项目是可接受的：计算器不传输任何凭据，表达式与历史记录都不敏感。
但有两件事需要如实处理：

1. **不要在 HTTP 站点上设置 HSTS** —— 浏览器会记住「此域名只用 HTTPS」，
   而 IP 又没有证书，结果是把自己锁在门外。示例配置里已刻意省略该头。
2. **在作业博客中说明这一点** —— 说明「因无域名故使用 HTTP，
   前端与接口同源；若后续申请到域名，可通过 certbot 平滑升级到 HTTPS」。
   这比含糊其辞更专业。

若希望有 HTTPS，最省事的路径是申请一个免费域名（多数云厂商提供免费二级域名），
然后按 3.2 – 3.4 的子域名方案走一遍，前端代码无需任何改动。

---

## 四、配置 HTTPS

Web 项目部署在公网，**必须启用 HTTPS**。原因不只是「更安全」：
浏览器对 HTTPS 页面发起 HTTP 请求会被判定为混合内容而拦截；
部分校园网环境对 HTTP 页面有额外限制。

### 用 certbot 免费签发

```bash
sudo apt-get install -y certbot python3-certbot-nginx

sudo certbot --nginx -d calc.example.com
# 按提示操作，certbot 会自动修改 nginx 配置并设置自动续期
```

验证自动续期：

```bash
sudo certbot renew --dry-run
```

### 若无域名，只有 IP

Let's Encrypt 不为纯 IP 签发证书。可选方案：

1. 申请一个免费域名（如 freenom 或各云厂商的免费二级域名）；
2. 用自签名证书 —— 浏览器会显示安全警告，助教验收体验较差，**不推荐**；
3. 若作业要求仅为「可访问」，可先用 HTTP 部署，并在博客中说明访问方式。

---

## 五、验收测试

部署完成后，逐项确认。

### 5.1 后端可访问

```bash
curl -s https://calc.example.com/api/health
# 应返回 {"success":true,"status":"ok","database":"ok",...}
```

### 5.2 计算接口正常工作

```bash
curl -s -X POST https://calc.example.com/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"12+8"}'
```

### 5.3 前端页面可访问

浏览器打开 `https://calc.example.com`，确认：

- [ ] 页面正常渲染，样式无丢失
- [ ] 页头状态灯显示绿色「后端正常 · N 条记录」
- [ ] 输入 `1+2*3` 回车得到 `7`
- [ ] 历史记录面板能看到刚才的计算
- [ ] 删除一条记录后列表刷新
- [ ] 刷新浏览器后历史记录依然存在（数据在后端数据库）

### 5.4 跨域与缓存头检查

```bash
# 确认接口响应不被缓存
curl -sI https://calc.example.com/api/health | grep -i cache-control
```

### 5.5 前后端分离的验证（作业要求项）

这是作业明确给出的验收方法，务必自己先测一遍：

1. 停止后端：`sudo systemctl stop calculator-backend`
2. 刷新前端页面
3. 确认：页面能正常加载、按钮能按、表达式能输入
4. 点击 `=`，确认结果是 `—` 并提示「无法连接后端服务」
5. **确认前端没有在本地算出任何结果**
6. 重新启动后端：`sudo systemctl start calculator-backend`

### 5.6 内存占用确认

```bash
free -m
systemctl show calculator-backend -p MemoryCurrent -p MemoryMax
```

若服务器上还运行着其他服务，确认新增后端没有把它们挤到 swap：

```bash
vmstat 1 5
# 关注 si / so 两列，应为 0；持续非 0 说明内存压力大
```

---

## 六、日常运维

### 查看状态与日志

```bash
sudo systemctl status calculator-backend
sudo journalctl -u calculator-backend -n 50 --no-pager
sudo journalctl -u calculator-backend -f          # 实时跟踪
sudo journalctl -u calculator-backend --since today
```

### 重启与停止

```bash
sudo systemctl restart calculator-backend
sudo systemctl stop calculator-backend
sudo systemctl disable calculator-backend         # 取消开机自启
```

### 更新代码

```bash
cd /opt/calculator/calculator_backend
sudo -u calculator git pull
sudo -u calculator npm install --omit=dev         # 依赖有变动时才需要
sudo systemctl restart calculator-backend
```

前端更新：

```bash
cd /tmp/calculator_frontend && sudo git pull
sudo cp -r /tmp/calculator_frontend/src/. /var/www/calculator/
sudo systemctl reload nginx
```

### 数据库备份

SQLite 是单文件数据库，备份就是复制文件。
但**不能直接复制正在写入的文件**，正确做法是用 SQLite 的在线备份命令：

```bash
# 方式一：sqlite3 的 .backup（需要安装 sqlite3）
sudo -u calculator sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite \
  ".backup '/opt/calculator/backup/calculator-$(date +%F).sqlite'"

# 方式二：VACUUM INTO（SQLite 3.27+，不需要额外工具，安全且会整理碎片）
sudo -u calculator sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite \
  "VACUUM INTO '/opt/calculator/backup/calculator-$(date +%F).sqlite'"
```

设置每日自动备份（crontab）：

```bash
sudo crontab -e
# 添加一行：
0 3 * * * sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite "VACUUM INTO '/opt/calculator/backup/calculator-$(date +\%F).sqlite'" && find /opt/calculator/backup -name '*.sqlite' -mtime +14 -delete
```

### 日志轮转

后端把日志写到 systemd journal，由 journald 统一管理。
限制 journal 占用空间，避免长期运行撑满磁盘：

```bash
sudo nano /etc/systemd/journald.conf
# 设置：
#   SystemMaxUse=200M
#   MaxRetentionSec=1month
sudo systemctl restart systemd-journald
```

---

## 故障排查

### 服务启动失败

```bash
sudo systemctl status calculator-backend -l
sudo journalctl -u calculator-backend -n 100 --no-pager
```

**常见原因：**

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `Cannot find module 'node:sqlite'` | Node 版本低于 22.5 | 升级 Node，并同步更新 systemd 里的 `<NODE_BIN>` |
| `EADDRINUSE` | 5000 端口被占用 | `ss -ltnp \| grep :5000` 找出占用者，或改 `PORT` |
| `EACCES: permission denied` | `data/` 目录属主不对 | `chown -R calculator:calculator /opt/calculator` |
| `status=226/NAMESPACE` | 沙箱选项与系统不兼容 | 注释掉 `RestrictNamespaces`、`MemoryDenyWriteExecute` 后重试 |
| `Failed to write to /opt/...` | `ProtectSystem=strict` 生效但未放行数据目录 | 确认 `ReadWritePaths` 指向正确的 data 目录 |

### 502 Bad Gateway

nginx 能响应但后端不可达：

```bash
# 1. 后端在跑吗
sudo systemctl status calculator-backend
# 2. 端口在听吗
ss -ltn | grep :5000
# 3. 从本机能通吗
curl -s http://127.0.0.1:5000/api/health
# 4. SELinux / AppArmor 是否拦截（Ubuntu 上偶发）
sudo dmesg | tail -20
```

### 前端页面 404 或样式丢失

```bash
# 确认文件权限：nginx 以 www-data 运行，需要可读
ls -la /var/www/calculator/
sudo -u www-data cat /var/www/calculator/index.html > /dev/null && echo "可读"

# 确认 nginx 配置里的 root 路径正确
sudo nginx -T | grep -A2 "root "
```

### 接口返回 CORS 错误

说明前端与接口不同源。检查：

1. 前端请求的地址是否是 `/api` 相对路径（同源）？
   若 `config.js` 推断出了绝对地址（例如 `http://ip:5000/api`），
   说明页面被判定为「运行在开发端口」，需要检查 `DEVELOPMENT_PORTS` 列表。
2. 若是刻意跨域部署，需要把前端来源加入后端的 `CORS_ORIGINS` 环境变量。

### 中文表达式计算结果不对

确认通过接口传输时的字符编码。用浏览器直接操作不会有问题；
若用 curl 测试，注意 shell 对多字节字符的处理，建议把 JSON 写入文件后
用 `--data-binary @file.json` 提交：

```bash
printf '{"expression":"100÷4"}' > /tmp/req.json
curl -s -X POST http://127.0.0.1:5000/api/calculate \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/req.json
```

---

## 附录：资源占用实测

以下数据来自一次真实部署（Debian 12，2 核 / 3.8GiB 内存，
同一台机器上还运行着其他服务）：

| 项目 | 占用 |
| --- | --- |
| 后端进程常驻内存（RSS） | 约 55–75 MB |
| Node 运行时 + 依赖磁盘占用 | 约 40 MB |
| 前端静态文件 | 约 100 KB |
| SQLite 数据文件（千条记录） | 约 100–200 KB |
| CPU（空闲） | ≈ 0% |
| CPU（单次计算请求） | < 5 ms |

**结论**：这是一个资源占用极低的服务，可以安全地与其它服务共存。
`MemoryMax=192M` 的上限留了约 2.5 倍余量，正常情况下永远不会触发；
一旦触发，说明出现了内存泄漏，systemd 会重启进程而不会影响同机其他服务。
