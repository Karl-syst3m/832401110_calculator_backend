# Deployment Guide · Calculator System with Separated Frontend and Backend

This document describes how to deploy this project to a Linux server (Debian 12 /
Ubuntu 22.04 as the examples) so that the teaching assistant can reach it over the public
internet during the assignment evaluation period.

---

## Table of Contents

- [Deployment Architecture](#deployment-architecture)
- [Preflight Checks](#preflight-checks)
- [1. Deploying the Backend](#1-deploying-the-backend)
- [2. Deploying the Frontend](#2-deploying-the-frontend)
- [3. Configuring nginx](#3-configuring-nginx)
- [4. Configuring HTTPS](#4-configuring-https)
- [5. Acceptance Testing](#5-acceptance-testing)
- [6. Day-to-Day Operations](#6-day-to-day-operations)
- [Troubleshooting](#troubleshooting)
- [Appendix: Measured Resource Usage](#appendix-measured-resource-usage)

---

## Deployment Architecture

```
                    Internet
                        │
                        ▼
              ┌───────────────────┐
              │      nginx        │  :443 (HTTPS)
              │                   │
              │  /      -> static │
              │  /api/  -> proxy  │
              └─────────┬─────────┘
                        │ 127.0.0.1:5000
                        ▼
              ┌───────────────────┐
              │  Node backend     │  managed by systemd
              │  Express + SQLite │  memory limit 192MB
              └─────────┬─────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ calculator.sqlite │
              └───────────────────┘
```

**Key design decision**: the backend listens only on `127.0.0.1` and is never exposed to
the public internet directly. All external traffic must pass through nginx. That way the
backend does not have to deal with TLS, rate limiting, or static files, and its attack
surface is smaller.

**Why the frontend and the API are same-origin**: nginx puts the frontend pages and `/api`
under the same domain name, so the browser never issues a cross-origin request. No CORS
configuration is therefore needed, and preflight failures cannot occur.

---

## Measured Environment on This Machine and the Resulting Plan Adjustments

> This section records the results of **actually probing the target server**.
> It overturns several "generic tutorial" practices, which is why it comes first.
> **Following a generic tutorial will definitely fail on this machine.**

### Measured environment

| Item | Measured result |
| --- | --- |
| Panel | **BT Panel 10.0.2** (`/www/server/panel`) |
| nginx | 1.26.3, compile prefix `--prefix=/www/server/nginx`, **managed by BT Panel** |
| nginx configuration entry point | `/www/server/nginx/conf/nginx.conf`, ending with `include /www/server/panel/vhost/nginx/*.conf;` |
| `/etc/nginx/nginx.conf` | **does not exist** |
| `/etc/nginx/sites-available/`, `sites-enabled/` | **does not exist / is empty** |
| Ports already listening | 80 (BT Panel internal status service), 8443 (DSH panel reverse proxy), 888 (phpMyAdmin) |
| ufw | **active**, default `deny (incoming)`; allows 22 / 80 / 443 / 6185 / 8443 / 8889 / 8899 / 6100 |
| Cloud security group | Whitelist-based. Measured reachable: 80 / 8443 / 6185 / 8899 / 6100 / 443; dropped: 888 / 8000 / 8080 / 3306 |
| Node | `/usr/local/bin/node` v24.15.0 (pre-installed, satisfies the `node:sqlite` requirement) |
| systemd | 252 |
| `/var/www` | does not exist (BT Panel's website root convention is `/www/wwwroot/`) |
| Resources | about 1.44 GB of available memory, 9.9 GB of free disk |

### Three adjustments derived from the measurements

**Adjustment one: the nginx configuration does not go under `/etc/nginx/`.**

On this machine nginx is managed by BT Panel, and `/etc/nginx/` is an empty shell (only
`ssl/` for certificates and the panel's own `htpasswd_dsh`). Placing the configuration into
`sites-available/` and symlinking it, as the Debian convention suggests, **will not get it
loaded**.

The correct location is:

```
/www/server/panel/vhost/nginx/calculator.conf
```

That directory is loaded by `nginx.conf` through `include .../vhost/nginx/*.conf;`.
BT Panel does not overwrite files placed there by hand (it only rewrites the site
configurations it created itself).
The matching template: `deploy/nginx-bt-panel.conf.example`.

**This needs a second file as well: `deploy/calculator-security-headers.conf.example`.**

nginx's `add_header` does **not** merge with the parent context. If a `location`
declares even one `add_header` of its own, every header inherited from the enclosing
`server` block is discarded **for that location** — the two sets are not combined.

All three locations in this template set their own `Cache-Control`, so the four security
headers written at server level reach none of them. Measured on the deployed site before
the fix (`curl -D -`):

```
GET /                -> Cache-Control only, no security headers
GET /css/style.css   -> Cache-Control only, no security headers
GET /api/health      -> Cache-Control only, no security headers
```

So `Content-Security-Policy` — the header that matters most on the HTML response — was
effectively switched off in production while the configuration looked correct on review.
nginx 1.26 has no `add_header_inherit merge` (that arrived in 1.29.3), so the headers have
to be re-declared inside each location. They live in one shared file that all three
locations `include`, so there is still a single place to edit. If you add another location
with its own `add_header`, include that file there too.

**Adjustment two: use port 80, not 8000.**

The allow rules are a **two-layer whitelist**: ufw and the cloud security group.
Measurements show 8000 is blocked at both layers, so using 8000 would require both
`ufw allow` **and logging into the cloud console to add a security group rule**.

Port 80, by contrast, is already allowed at both layers and nginx is already listening on
it, so it works with **zero changes**.

The way to coexist with BT Panel's built-in status service (`server_name 127.0.0.1`) is to
use the **public IP as your own site's `server_name`** for an exact match, and **not to
declare `default_server`**. Then:

- requesting `http://<public-IP>/` → the Host header is that IP → our server block matches;
- monitoring requests from inside the panel have Host `127.0.0.1` → still handled by BT Panel's block.

Neither side's behavior is affected.

**Adjustment three: `/var/www` does not exist; put the frontend in `/www/wwwroot/calculator`.**

BT Panel's website root convention is `/www/wwwroot/<site-name>`; following that convention
makes coexistence with the panel easier.

### One earlier judgement that needs correcting

While probing ports at the very beginning, we saw MySQL listening on `*:3306` and concluded
it was "reachable from the public internet and therefore a risky exposure".
**That judgement was wrong.** Testing 3306 from outside actually times out (the packets are
dropped), which shows ufw was already blocking it.

The lesson: `ss -ltn` only reflects **whether the local machine is listening**, not
**whether the outside can connect**. Judging exposure requires testing from the outside,
not just reading the local listening list.
(The same reasoning holds in reverse: `ss -ltn` shows port 888 listening, but it is blocked
by ufw just the same and is unreachable from outside.)

### Quick reference: deployment commands for this machine

```bash
# frontend (note the BT Panel directory convention)
sudo mkdir -p /www/wwwroot/calculator
sudo cp -r calculator_frontend/src/. /www/wwwroot/calculator/
sudo chown -R www:www /www/wwwroot/calculator

# nginx site — two files: the vhost and the shared security-header snippet
sudo cp deploy/nginx-bt-panel.conf.example /www/server/panel/vhost/nginx/calculator.conf
sudo cp deploy/calculator-security-headers.conf.example \
        /www/server/panel/vhost/nginx/calculator-security-headers.conf
sudo sed -i 's/<SERVER_IP>/your-public-IP/; s|<FRONTEND_ROOT>|/www/wwwroot/calculator|' \
     /www/server/panel/vhost/nginx/calculator.conf
sudo nginx -t && sudo systemctl reload nginx

# no firewall changes needed
# verify
curl -s http://127.0.0.1/api/health
# verify the security headers actually made it onto the responses
# (they are dropped entirely unless the include is present in each location)
for u in / /css/style.css /api/health; do
  printf '%-16s ' "$u"
  curl -s -D - -o /dev/null "http://127.0.0.1$u" | grep -ciE \
    'x-content-type-options|x-frame-options|referrer-policy|content-security-policy'
done   # each line should print 4
```

> This hand-created site will not appear in BT Panel's "Websites" list.
> That is normal — the panel only manages the site configurations it created itself.
> This site does not depend on any panel feature, so there is no impact; to remove it, just
> delete the configuration file and reload nginx.

---

## Preflight Checks

Run these on the server to confirm the environment meets the requirements:

```bash
# 1. Node version must be >= 22.5.0 (required by the built-in node:sqlite module)
node -v

# 2. nginx is installed
nginx -v

# 3. whether the system uses systemd
systemctl --version | head -1

# 4. port usage (confirm 5000 is free, and see who owns 80/443)
ss -ltn | grep -E ':(80|443|5000)\s'

# 5. free disk space (backend + frontend together are about 50MB)
df -h /
```

### What if the Node version is too old

If `node -v` is below 22.5.0, install Node 22 with NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

Or use nvm (available only to the current user; the systemd service needs an absolute path):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
which node    # note this path down; it goes into <NODE_BIN> in systemd
```

> **Note**: if port 80 on the server is already taken by another site (for example another
> web service already exists), do not modify the existing server block. Use the
> **subdomain** approach instead: resolve a separate subdomain for the calculator (such as
> `calc.example.com`) and add a new server block with `server_name calc.example.com;` in
> nginx. nginx routes by domain name, so the existing sites are undisturbed.

---

## 1. Deploying the Backend

### 1.1 Create a dedicated user and directories

Do not run the backend as root. Create a system user that cannot log in:

```bash
sudo useradd --system --shell /usr/sbin/nologin --home /opt/calculator calculator
sudo mkdir -p /opt/calculator
sudo chown -R calculator:calculator /opt/calculator
```

### 1.2 Upload the code

**Option A: clone from GitHub** (recommended; makes later updates with `git pull` easy)

```bash
sudo -u calculator git clone https://github.com/<your-account>/calculator_backend.git /opt/calculator/calculator_backend
```

**Option B: upload with rsync from your local machine**

```bash
# run locally
rsync -avz --exclude node_modules --exclude data \
  calculator_backend/ root@<server-ip>:/opt/calculator/calculator_backend/
sudo chown -R calculator:calculator /opt/calculator/calculator_backend
```

### 1.3 Install dependencies

```bash
cd /opt/calculator/calculator_backend
sudo -u calculator npm install --omit=dev
```

This project has a single runtime dependency (Express) and contains no native modules at
all, so this step triggers no compilation and usually finishes in seconds.

### 1.4 Create the data directory

```bash
sudo -u calculator mkdir -p /opt/calculator/calculator_backend/data
```

> There is no need to create tables by hand. The service runs its idempotent table-creation
> statements automatically on startup.

### 1.5 Register the systemd service

```bash
# find the absolute path of node
which node
# for example, /usr/bin/node

sudo cp deploy/calculator-backend.service /etc/systemd/system/
sudo nano /etc/systemd/system/calculator-backend.service
# replace <APP_DIR> with /opt/calculator/calculator_backend
# replace <NODE_BIN> with the output of which node
```

Start it and enable start on boot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now calculator-backend
```

### 1.6 Verify the backend

```bash
sudo systemctl status calculator-backend

# local API test
curl -s http://127.0.0.1:5000/api/health

# calculation test
curl -s -X POST http://127.0.0.1:5000/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"(1+2)*3"}'
```

Expected output:

```json
{"success":true,"id":1,"expression":"(1+2)*3","normalizedExpression":"(1+2)*3","result":9,"resultText":"9","createdAt":"..."}
```

Check whether memory usage matches expectations:

```bash
systemctl show calculator-backend -p MemoryCurrent
# for example MemoryCurrent=58... means about 58MB
```

---

## 2. Deploying the Frontend

The frontend is pure static files: **no npm install and no build step are needed**.

```bash
sudo mkdir -p /var/www/calculator

# Option A: clone from GitHub
sudo git clone https://github.com/<your-account>/calculator_frontend.git /tmp/calculator_frontend
sudo cp -r /tmp/calculator_frontend/src/. /var/www/calculator/

# Option B: upload with rsync from your local machine
# run locally:
# rsync -avz calculator_frontend/src/ root@<server-ip>:/var/www/calculator/

# set permissions: nginx only needs read access
sudo chown -R www-data:www-data /var/www/calculator
sudo find /var/www/calculator -type d -exec chmod 755 {} \;
sudo find /var/www/calculator -type f -exec chmod 644 {} \;
```

> Note that what gets copied is the **contents** of the `src/` directory, so that
> `index.html` sits directly under `/var/www/calculator/`. The README and codestyle
> documents do not need to be deployed to the web directory.

Verify the files are in place:

```bash
ls -la /var/www/calculator/
# you should see index.html, css/, js/
```

---

## 3. Configuring nginx

### 3.1 Choosing an approach

| Approach | When it applies | Key nginx configuration points | Configuration file |
| --- | --- | --- | --- |
| **IP + port** | No domain name; 80/443 already taken by another site | nginx additionally listens on a high port (such as 8000) | `nginx-ip-port.conf.example` |
| Subdomain | A domain name exists, but 80/443 are already taken by another site | create a new server block with `server_name calc.example.com;` | `nginx.conf.example` |
| Path prefix | Only one domain, and it has to be mounted under `/calc/` | the API address and the static asset paths both have to be adjusted | see [3.4](#34-path-prefix-option-supplement) |

**This project uses the "IP + port" approach** (no domain name). The full steps are in
[3.5 Deployment Without a Domain Name (IP + Port)](#35-deployment-without-a-domain-name-ip--port).

The deployment steps for choosing a subdomain are in 3.2 – 3.3 below.

> **Why open an extra port instead of using the backend's 5000 directly?**
> Letting nginx be the single public face exposes only one port, and lets it serve both the
> static files and the API proxy; the frontend and the API stay same-origin (so no CORS is
> needed), while the backend always listens only on `127.0.0.1`.
> If the backend's port 5000 were exposed to the public internet directly instead, the
> frontend would have to access the backend cross-origin, CORS would have to be configured,
> and the backend would face internet-wide scanning head-on.

### 3.2 Install the configuration

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/calculator
sudo nano /etc/nginx/sites-available/calculator
# replace the three placeholders <DOMAIN>, <FRONTEND_ROOT>, <CERT_PATH>

sudo ln -s /etc/nginx/sites-available/calculator /etc/nginx/sites-enabled/
```

### 3.3 Syntax check and reload

```bash
sudo nginx -t
# continue only if it prints "syntax is ok" and "test is successful"

sudo systemctl reload nginx
```

### 3.4 Path Prefix Option (Supplement)

If it has to be mounted under `https://example.com/calc/`, three adjustments are needed:

**a) nginx**: put both the static files and the API under the `/calc/` prefix

```nginx
location /calc/ {
    alias /var/www/calculator/;
    try_files $uri $uri/ /calc/index.html;
}

location /calc/api/ {
    proxy_pass http://calculator_backend/api/;
    # ... the remaining proxy settings are the same as in the example
}
```

**b) Asset paths in the frontend HTML**: `./css/style.css` and `./js/app.js` in
`index.html` are relative paths; they remain correct under `/calc/` and need no change.

**c) Frontend API address**: declare it explicitly in the `<head>` of `index.html`:

```html
<script>
  window.__CALCULATOR_CONFIG__ = { apiBaseUrl: '/calc/api' };
</script>
```

Alternatively, hard-code `apiBaseUrl` to `'/calc/api'` in `src/js/config.js`.

> A path prefix significantly increases configuration complexity (static asset paths, API
> paths, and cookie scope all have to be aligned).
> **Unless a domain name constraint really makes it necessary, prefer the IP + port or
> subdomain approach.**

### 3.5 Deployment Without a Domain Name (IP + Port)

Without a domain name, access is by "public IP + high port". This is the approach this
project's deployment uses.

#### 3.5.1 Why 80 / 443 cannot be used

Port 80 on the server is usually already taken by another site (confirm with
`ss -ltn | grep :80` and `nginx -T | grep server_name`). Adding a default server with
`server_name _` on port 80 directly would **displace the existing site**, which is a
serious misstep.

The approach is therefore to have nginx **listen on an additional high port** and create a
separate server block for it. nginx routes by "port + server_name", so the existing sites
are undisturbed.

#### 3.5.2 Choose a free port

```bash
# see which ports are taken
ss -ltn

# check whether a candidate port is free (no output below means it is free)
ss -ltn | grep -E ':(8000|8080|8081|9000)\s'
```

This document uses **8000** as the example. If it is already taken, 8080 / 8081 / 9000 all
work as substitutes, but remember to update the nginx configuration to match.

> As an aside: the frontend's API-address inference logic recognizes "same-origin
> deployment" automatically, so whichever port is finally used it requests
> `http://<IP>:<port>/api` without any code change.
> That logic is covered by 13 test cases (run `npm test` under `calculator_frontend`).

#### 3.5.3 Install the configuration

```bash
sudo cp deploy/nginx-ip-port.conf.example /etc/nginx/sites-available/calculator
sudo nano /etc/nginx/sites-available/calculator
# replace <FRONTEND_ROOT> with /var/www/calculator
# if the port needs changing, edit both listen lines as well

sudo ln -s /etc/nginx/sites-available/calculator /etc/nginx/sites-enabled/
sudo nginx -t                     # must show test is successful
sudo systemctl reload nginx
```

#### 3.5.4 Opening the port (the step most often missed)

**Both layers must be checked; neither can be skipped:**

**Layer one: the server's own firewall**

```bash
# first see which firewall is in use
sudo ufw status            # common on Ubuntu
sudo firewall-cmd --state  # common on CentOS / RHEL
sudo iptables -L -n        # generic

# if ufw is active
sudo ufw allow 8000/tcp

# if firewalld is running
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --reload
```

If none of the three is enabled (the output shows it is inactive), the host layer has no
firewall; skip to layer two.

**Layer two: the cloud provider's security group / network ACL**

This step is done in the cloud provider's console and cannot be changed from the command
line. Most cloud servers **allow only 22 / 80 / 443 by default**, so a new port requires an
inbound rule added by hand in the console's security group:

```
Protocol: TCP
Port: 8000
Source: 0.0.0.0/0
```

> **This is where this approach most often gets stuck.** The symptom: `curl` works from the
> server itself, but external access keeps timing out. When that happens, suspect the
> security group first, not the nginx configuration.

#### 3.5.5 Verification

On the **server itself**:

```bash
curl -s http://127.0.0.1:8000/healthz
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/
```

On **your own computer** (only this step verifies whether the security group lets it through):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<public-IP>:8000/
curl -s http://<public-IP>:8000/api/health
```

Both returning `200` is what counts as success.

#### 3.5.6 About HTTPS

Let's Encrypt **does not issue certificates for a bare IP**, so this approach can only use HTTP.

That is acceptable for this project: the calculator transmits no credentials, and neither
expressions nor history records are sensitive. Two things do, however, need to be handled
honestly:

1. **Do not set HSTS on an HTTP site** — the browser would remember that "this domain is
   HTTPS-only", while the IP has no certificate, and the result is locking yourself out.
   The example configuration deliberately omits that header.
2. **State this in the assignment blog** — explain that "HTTP is used because there is no
   domain name, and the frontend and API are same-origin; if a domain name is obtained
   later, certbot can upgrade it smoothly to HTTPS".
   That is more professional than being vague.

If HTTPS is wanted, the least-effort path is to obtain a free domain name (most cloud
providers offer a free subdomain) and then follow the subdomain approach in 3.2 – 3.4; the
frontend code needs no changes at all.

---

## 4. Configuring HTTPS

A web project deployed on the public internet **must enable HTTPS**. The reason is not only
that "it is more secure": browsers block HTTP requests made from an HTTPS page as mixed
content, and some campus network environments impose extra restrictions on HTTP pages.

### Issuing a free certificate with certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx

sudo certbot --nginx -d calc.example.com
# follow the prompts; certbot modifies the nginx configuration automatically and sets up auto-renewal
```

Verify auto-renewal:

```bash
sudo certbot renew --dry-run
```

### If there is no domain name, only an IP

Let's Encrypt does not issue certificates for a bare IP. The options are:

1. obtain a free domain name (such as freenom, or the free subdomains offered by the various
   cloud providers);
2. use a self-signed certificate — the browser displays a security warning and the TA's
   acceptance experience suffers; **not recommended**;
3. if the assignment only requires that "it is reachable", deploy over HTTP for now and
   explain the access method in the blog.

---

## 5. Acceptance Testing

Once deployment is finished, confirm each item in turn.

### 5.1 The backend is reachable

```bash
curl -s https://calc.example.com/api/health
# should return {"success":true,"status":"ok","database":"ok",...}
```

### 5.2 The calculation API works

```bash
curl -s -X POST https://calc.example.com/api/calculate \
  -H "Content-Type: application/json" \
  -d '{"expression":"12+8"}'
```

### 5.3 The frontend page is reachable

Open `https://calc.example.com` in a browser and confirm:

- [ ] the page renders correctly with no missing styles
- [ ] the header status indicator is green: "backend OK · N records"
- [ ] typing `1+2*3` and pressing Enter gives `7`
- [ ] the history panel shows the calculation just performed
- [ ] deleting a record refreshes the list
- [ ] the history survives a browser refresh (the data lives in the backend database)

### 5.4 Cross-origin and cache-header checks

```bash
# confirm API responses are not cached
curl -sI https://calc.example.com/api/health | grep -i cache-control
```

### 5.5 Verifying the frontend/backend separation (required by the assignment)

This is the acceptance method the assignment specifies explicitly; be sure to test it
yourself first:

1. Stop the backend: `sudo systemctl stop calculator-backend`
2. Refresh the frontend page
3. Confirm: the page loads, buttons respond, expressions can be typed
4. Click `=` and confirm the result is `—` with a "cannot connect to the backend service" message
5. **Confirm the frontend has not computed any result locally**
6. Start the backend again: `sudo systemctl start calculator-backend`

### 5.6 Confirming memory usage

```bash
free -m
systemctl show calculator-backend -p MemoryCurrent -p MemoryMax
```

If other services also run on the server, confirm the new backend has not pushed them into
swap:

```bash
vmstat 1 5
# watch the si / so columns: they should be 0; persistently non-zero means heavy memory pressure
```

---

## 6. Day-to-Day Operations

### Checking status and logs

```bash
sudo systemctl status calculator-backend
sudo journalctl -u calculator-backend -n 50 --no-pager
sudo journalctl -u calculator-backend -f          # follow in real time
sudo journalctl -u calculator-backend --since today
```

### Restarting and stopping

```bash
sudo systemctl restart calculator-backend
sudo systemctl stop calculator-backend
sudo systemctl disable calculator-backend         # disable start on boot
```

### Updating the code

```bash
cd /opt/calculator/calculator_backend
sudo -u calculator git pull
sudo -u calculator npm install --omit=dev         # only needed when dependencies changed
sudo systemctl restart calculator-backend
```

Updating the frontend:

```bash
cd /tmp/calculator_frontend && sudo git pull
sudo cp -r /tmp/calculator_frontend/src/. /var/www/calculator/
sudo systemctl reload nginx
```

### Database backup

SQLite is a single-file database, so a backup is a file copy. But **a file that is being
written to cannot simply be copied**; the correct approach is SQLite's online backup command:

```bash
# option one: sqlite3's .backup (requires sqlite3 to be installed)
sudo -u calculator sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite \
  ".backup '/opt/calculator/backup/calculator-$(date +%F).sqlite'"

# option two: VACUUM INTO (SQLite 3.27+, no extra tooling, safe and defragments)
sudo -u calculator sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite \
  "VACUUM INTO '/opt/calculator/backup/calculator-$(date +%F).sqlite'"
```

Setting up a daily automatic backup (crontab):

```bash
sudo crontab -e
# add one line:
0 3 * * * sqlite3 /opt/calculator/calculator_backend/data/calculator.sqlite "VACUUM INTO '/opt/calculator/backup/calculator-$(date +\%F).sqlite'" && find /opt/calculator/backup -name '*.sqlite' -mtime +14 -delete
```

### Log rotation

The backend writes its logs to the systemd journal, managed centrally by journald. Cap the
journal's disk usage so that long-running operation does not fill the disk:

```bash
sudo nano /etc/systemd/journald.conf
# set:
#   SystemMaxUse=200M
#   MaxRetentionSec=1month
sudo systemctl restart systemd-journald
```

---

## Troubleshooting

### The service fails to start

```bash
sudo systemctl status calculator-backend -l
sudo journalctl -u calculator-backend -n 100 --no-pager
```

**Common causes:**

| Error | Cause | Fix |
| --- | --- | --- |
| `Cannot find module 'node:sqlite'` | Node version below 22.5 | upgrade Node and update `<NODE_BIN>` in systemd to match |
| `EADDRINUSE` | port 5000 is in use | `ss -ltnp \| grep :5000` to find the owner, or change `PORT` |
| `EACCES: permission denied` | wrong owner on the `data/` directory | `chown -R calculator:calculator /opt/calculator` |
| `status=226/NAMESPACE` | sandbox options are incompatible with the system | comment out `RestrictNamespaces` and `MemoryDenyWriteExecute`, then retry |
| `Failed to write to /opt/...` | `ProtectSystem=strict` is in effect but the data directory is not allowed | confirm `ReadWritePaths` points at the correct data directory |

### 502 Bad Gateway

nginx responds but the backend is unreachable:

```bash
# 1. is the backend running
sudo systemctl status calculator-backend
# 2. is the port listening
ss -ltn | grep :5000
# 3. does it work from this machine
curl -s http://127.0.0.1:5000/api/health
# 4. is SELinux / AppArmor blocking it (occasional on Ubuntu)
sudo dmesg | tail -20
```

### Frontend page 404 or missing styles

```bash
# confirm file permissions: nginx runs as www-data and needs read access
ls -la /var/www/calculator/
sudo -u www-data cat /var/www/calculator/index.html > /dev/null && echo "readable"

# confirm the root path in the nginx configuration is correct
sudo nginx -T | grep -A2 "root "
```

### The API returns a CORS error

This means the frontend and the API are not same-origin. Check:

1. Is the address the frontend requests the relative path `/api` (same-origin)?
   If `config.js` inferred an absolute address (for example `http://ip:5000/api`), the page
   was judged to be "running on a development port"; check the `DEVELOPMENT_PORTS` list.
2. If cross-origin deployment is intentional, add the frontend origin to the backend's
   `CORS_ORIGINS` environment variable.

### The result is wrong when the expression uses full-width operators

Confirm the character encoding when transmitting through the API. Operating the browser
directly is fine; if testing with curl, beware of how the shell handles multibyte
characters — the recommendation is to write the JSON into a file and submit it with
`--data-binary @file.json`:

```bash
printf '{"expression":"100÷4"}' > /tmp/req.json
curl -s -X POST http://127.0.0.1:5000/api/calculate \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/req.json
```

---

## Appendix: Measured Resource Usage

The following data comes from one real deployment (Debian 12, 2 cores / 3.8GiB of memory,
with other services also running on the same machine):

| Item | Usage |
| --- | --- |
| Backend process resident memory (RSS) | about 20 MB at rest; up to about 44 MB after a burst of large base conversions |
| Node runtime + dependencies on disk | about 40 MB |
| Frontend static files | about 100 KB |
| SQLite data file (one thousand records) | about 100–200 KB |
| CPU (idle) | ≈ 0% |
| CPU (a single calculation request) | < 5 ms |

**Conclusion**: this is a very low-footprint service that can safely coexist with other
services. The `MemoryMax=192M` ceiling leaves roughly a 2.5x margin and will never be
reached under normal conditions; if it ever is, a memory leak has appeared, and systemd
restarts the process without affecting the other services on the same machine.
