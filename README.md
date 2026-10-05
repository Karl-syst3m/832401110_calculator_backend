# 计算器系统 · 后端（Calculator Backend）

前后端分离架构的计算器系统**后端服务**。负责表达式的校验、解析、计算、异常处理，
以及计算历史的持久化与检索。所有数值计算都发生在这里，前端不参与任何计算。

> 本项目是软件工程课程第一次作业「前后端分离计算器系统」的后端部分。
> 前端仓库见配套项目 `calculator_frontend`。

---

## 目录

- [功能清单](#功能清单)
- [技术栈](#技术栈)
- [运行环境](#运行环境)
- [安装](#安装)
- [启动](#启动)
- [配置说明](#配置说明)
- [数据库初始化](#数据库初始化)
- [前后端连接方式](#前后端连接方式)
- [接口文档](#接口文档)
- [响应约定](#响应约定)
- [项目结构](#项目结构)
- [测试](#测试)
- [设计要点](#设计要点)
- [常见问题](#常见问题)

---

## 功能清单

### 必需功能

| 功能 | 说明 | 实现位置 |
| --- | --- | --- |
| 基础计算 | 加、减、乘、除四种运算 | `src/calculator/evaluator.js` |
| 复合表达式 | 运算符优先级、括号、一元正负号、小数 | `src/calculator/parser.js` |
| 历史记录 | 每次成功计算写入 SQLite 数据库 | `src/service/calculator.service.js` |
| 删除记录 | 按 id 删除指定记录，也支持清空全部 | `src/service/history.service.js` |
| 异常处理 | 非法表达式、除以零、定义域错误、结果溢出 | `src/calculator/errors.js` |
| 统一响应 | 标准化响应体与 HTTP 状态码 | `src/middleware/errorHandler.js` |

### 扩展功能

| 功能 | 说明 |
| --- | --- |
| 科学计算 | `sqrt` `abs` `sin` `cos` `tan` `asin` `acos` `atan` `ln` `log` `log2` `exp` `pow` `hypot` `sign` `mod` `round` `floor` `ceil` `min` `max` `fact`，常量 `pi` `e` `tau`，乘方运算符 `^` |
| 进制换算 | 2–36 任意进制互转，整数部分用 BigInt 保证精确 |
| 单位换算 | 长度、质量、面积、体积、时间、数据、速度、温度共 8 类 |
| 历史搜索 | 按表达式或结果文本模糊搜索（LIKE 通配符已转义） |
| 分页 | `page` / `pageSize`，并对 `pageSize` 设上限防止内存被打满 |
| 排序 | 按时间、结果、id 排序，字段走白名单校验 |
| 收藏 | 标记常用计算记录 |
| 统计 | 总记录数、今日计算、平均数、最常用表达式等，全部由 SQL 聚合 |
| 健康检查 | 用于部署验证与前端状态指示 |

---

## 技术栈

| 层次 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 22.5.0 | 需要 `node:sqlite` 内置模块 |
| Web 框架 | Express 4 | 课程允许的后端框架之一 |
| 数据库 | SQLite（`node:sqlite` 内置模块） | 零配置、零原生编译 |
| 测试 | `node:test` + `node:assert` | Node 内置，无第三方测试框架 |
| 模块格式 | ES Module（`import` / `export`） | 与前端保持一致的现代写法 |

**运行依赖只有 Express 一个包。** 数据库驱动用的是 Node 内置模块，因此
`npm install` 不会触发任何原生模块编译，这是本项目一个刻意的工程取舍，理由见
[设计要点](#设计要点)。

---

## 运行环境

- **Node.js ≥ 22.5.0**（`node:sqlite` 从该版本起可用；推荐 22 LTS 或 24）
- 操作系统：Windows / macOS / Linux 均可
- 无需单独安装数据库服务

检查 Node 版本：

```bash
node -v
```

若版本低于 22.5.0，服务会在启动时给出明确提示。推荐用 [nvm](https://github.com/nvm-sh/nvm)
（Windows 用 [nvm-windows](https://github.com/coreybutler/nvm-windows)）安装 Node 22 或 24：

```bash
nvm install 22
nvm use 22
```

---

## 安装

```bash
cd calculator_backend
npm install
```

安装完成后只有 `express` 及其少量依赖，不会编译任何原生模块。

---

## 启动

```bash
# 生产模式
npm start

# 开发模式（文件变更自动重启）
npm run dev
```

启动成功后终端会输出：

```
2026-10-04T16:53:47.000Z [INFO] [db] 数据库已打开: /path/to/data/calculator.sqlite
2026-10-04T16:53:47.010Z [INFO] [server] 计算器后端已启动: http://127.0.0.1:5000
2026-10-04T16:53:47.010Z [INFO] [server] 健康检查: http://127.0.0.1:5000/api/health
```

验证服务是否正常：

```bash
curl http://127.0.0.1:5000/api/health
```

预期返回：

```json
{
  "success": true,
  "service": "calculator-backend",
  "status": "ok",
  "database": "ok",
  "historyCount": 0,
  "uptimeSeconds": 5,
  "nodeVersion": "v22.20.0",
  "timestamp": "2026-10-04T16:53:52.000Z"
}
```

---

## 配置说明

所有配置都通过**环境变量**提供，均有合理默认值，因此本地开发可以零配置启动。
默认值集中定义在 `src/config/index.js`。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5000` | 服务监听端口 |
| `HOST` | `127.0.0.1` | 监听地址。生产环境建议保持回环地址，由 nginx 反代对外提供服务 |
| `NODE_ENV` | `development` | 设为 `production` 时，500 错误不再返回原始错误信息 |
| `DB_FILE` | `<项目根>/data/calculator.sqlite` | SQLite 数据文件路径，设为 `:memory:` 使用内存库 |
| `CORS_ORIGINS` | 见下 | 允许跨域的来源，逗号分隔；同源部署时留空即可 |
| `BODY_LIMIT` | `64kb` | 请求体大小上限 |
| `LOG_LEVEL` | `info` | 日志级别：`error` / `warn` / `info` / `debug` |
| `MAX_EXPRESSION_LENGTH` | `200` | 单个表达式的最大长度 |

`CORS_ORIGINS` 默认值：

```
http://localhost:5500,http://127.0.0.1:5500,http://localhost:8080,http://127.0.0.1:8080
```

使用示例：

```bash
# Linux / macOS
PORT=8080 DB_FILE=/var/lib/calculator/calculator.sqlite npm start

# Windows PowerShell
$env:PORT=8080; $env:DB_FILE="C:\data\calculator.sqlite"; npm start
```

> **关于 CORS**：如果让 nginx 把前端页面与 `/api` 放在同一个域名下（推荐做法），
> 浏览器不会发起跨域请求，`CORS_ORIGINS` 保持默认即可，无需额外配置。

---

## 数据库初始化

**不需要手动初始化。** 服务每次启动都会执行一次幂等的建表语句：

- 数据文件不存在时自动创建
- `data/` 目录不存在时自动创建
- 表已存在时不做任何改动

如果想单独查看表结构：

```bash
npm run init-db
```

输出示例：

```
数据库初始化完成
  文件路径: /path/to/data/calculator.sqlite
  数据表:   calculation_history
  索引:     idx_history_created_at, idx_history_expression, idx_history_favorite

calculation_history 表结构:
  id                      INTEGER  PRIMARY KEY
  expression              TEXT     NOT NULL
  normalized_expression   TEXT     NOT NULL
  result                  REAL     NOT NULL
  result_text             TEXT     NOT NULL
  is_favorite             INTEGER  NOT NULL
  created_at              TEXT     NOT NULL
```

### 表设计说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | 主键，自增。删除接口使用它定位记录 |
| `expression` | TEXT | 用户原始输入，保留原样以便回显 |
| `normalized_expression` | TEXT | 归一化后的表达式（`×` → `*`），便于排查问题 |
| `result` | REAL | 数值结果，供统计聚合使用 |
| `result_text` | TEXT | 文本结果，展示时以此为准 |
| `is_favorite` | INTEGER | 收藏标记（0/1），扩展功能 |
| `created_at` | TEXT | 计算时间，ISO 8601 UTC 格式 |

> **为什么 `result` 和 `result_text` 要同时存？**
> SQLite 的 `REAL` 是双精度浮点，读回 JavaScript 时对于 `1e18` 这种量级会出现尾数
> 精度损失。`result_text` 是格式化后的字符串，与计算当刻界面显示的结果完全一致。
> 约定：**展示用 `result_text`，统计用 `result`**。

### 示例数据（可选）

演示历史列表、搜索、分页时需要一些数据：

```bash
npm run seed          # 插入约 27 条覆盖各类情况的示例记录
npm run seed:clear    # 清空全部记录
```

> 正式截图演示前建议执行 `npm run seed:clear`，再用真实手工操作生成记录——
> 截图应当来自实际使用，而不是预置数据。

---

## 前后端连接方式

```
浏览器（前端 :5500）
        │  HTTP / JSON
        │  POST /api/calculate  { "expression": "1+2*3" }
        ▼
后端服务（Express :5000）
        │  SQL
        ▼
SQLite 数据库（data/calculator.sqlite）
```

前端通过环境相关的地址访问后端，规则由前端仓库的 `src/js/config.js` 决定：

| 前端运行方式 | 请求地址 |
| --- | --- |
| 本地开发（`http://127.0.0.1:5500`） | `http://127.0.0.1:5000/api` |
| nginx 同源部署 | `/api`（相对路径，无跨域） |
| 其他 | 可用 `?api=http://host:port/api` 临时覆盖 |

**本地联调步骤：**

1. 终端 A 启动后端：`cd calculator_backend && npm start`
2. 终端 B 启动前端：`cd calculator_frontend && npm run dev`
3. 浏览器打开 `http://127.0.0.1:5500`
4. 页头右上角的状态指示应显示绿色的「后端正常 · N 条记录」

---

## 接口文档

接口前缀统一为 `/api`。

### `GET /api/health` — 健康检查

无参数。返回服务与数据库状态。

```json
{
  "success": true,
  "service": "calculator-backend",
  "status": "ok",
  "database": "ok",
  "historyCount": 12,
  "uptimeSeconds": 305,
  "nodeVersion": "v24.15.0",
  "timestamp": "2026-10-04T16:53:52.000Z"
}
```

### `POST /api/calculate` — 计算表达式

**请求体**

```json
{ "expression": "(1+2)*3" }
```

**成功响应 `201 Created`**

```json
{
  "success": true,
  "id": 12,
  "expression": "(1+2)*3",
  "normalizedExpression": "(1+2)*3",
  "result": 9,
  "resultText": "9",
  "createdAt": "2026-10-04T16:53:52.000Z"
}
```

**失败响应 `400 Bad Request`**

```json
{
  "success": false,
  "code": "DIVISION_BY_ZERO",
  "message": "Division by zero is not allowed.",
  "detail": { "operation": "Division", "dividend": 1, "divisor": 0 }
}
```

> 返回 `201` 而不是 `200`：这次请求除了算出结果，还**创建了一条历史记录**这个新资源，
> 并返回了它的 `id`。按 HTTP 语义，产生新资源应使用 `201 Created`。

### `GET /api/history` — 查询历史记录

**查询参数**

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `page` | integer | `1` | 页码，从 1 开始 |
| `pageSize` | integer | `20` | 每页条数，上限 100（超出会被压到 100） |
| `keyword` | string | 空 | 关键词，匹配表达式或结果文本 |
| `favoriteOnly` | boolean | `false` | 只看收藏，传 `true` 或 `1` |
| `sortBy` | string | `createdAt` | 排序字段：`createdAt` / `result` / `id` |
| `order` | string | `desc` | 排序方向：`asc` / `desc` |

**成功响应 `200 OK`**

```json
{
  "success": true,
  "items": [
    {
      "id": 12,
      "expression": "(1+2)*3",
      "normalizedExpression": "(1+2)*3",
      "result": 9,
      "resultText": "9",
      "isFavorite": false,
      "createdAt": "2026-10-04T16:53:52.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "filters": { "keyword": "", "favoriteOnly": false, "sortBy": "createdAt", "order": "desc" }
}
```

### `GET /api/history/stats` — 汇总统计

```json
{
  "success": true,
  "stats": {
    "total": 27,
    "favorites": 3,
    "today": 12,
    "distinctExpressions": 23,
    "averageResult": 92.02,
    "firstAt": "2026-10-04T16:53:59.358Z",
    "latestAt": "2026-10-04T16:55:04.079Z",
    "mostFrequentExpression": "(1+2)*3",
    "mostFrequentCount": 2,
    "timezone": "UTC"
  }
}
```

> `today` 按 **UTC 日界** 统计，因此返回体中带 `timezone` 字段明示口径。

### `DELETE /api/history/:id` — 删除指定记录

**成功响应 `200 OK`**

```json
{ "success": true, "id": 12, "deleted": 1 }
```

**记录不存在 `404 Not Found`**

```json
{
  "success": false,
  "code": "HISTORY_NOT_FOUND",
  "message": "History record with id 999999 does not exist.",
  "detail": { "id": 999999 }
}
```

> 记录不存在时返回 404，而不是「假装成功」。否则前端删一个不存在的 id
> 会以为已经删掉，实际什么也没发生——这类「假成功」最难排查。

### `DELETE /api/history` — 清空全部记录

```json
{ "success": true, "deleted": 27 }
```

### `PATCH /api/history/:id/favorite` — 切换收藏

**请求体**（可省略，省略时按「取反」处理）

```json
{ "isFavorite": true }
```

**成功响应 `200 OK`**

```json
{ "success": true, "item": { "id": 12, "isFavorite": true, "...": "..." } }
```

### `GET /api/convert/units` — 查询支持的单位清单

返回全部换算类别与单位，供前端渲染下拉框。

```json
{
  "success": true,
  "categories": [
    {
      "key": "temperature",
      "label": "温度",
      "kind": "affine",
      "units": [
        { "key": "c", "label": "摄氏度" },
        { "key": "f", "label": "华氏度" },
        { "key": "k", "label": "开尔文" }
      ]
    }
  ]
}
```

### `POST /api/convert/base` — 进制换算

**请求体**

```json
{ "value": "ff", "fromBase": 16, "toBase": 10 }
```

**响应**

```json
{ "success": true, "input": "ff", "fromBase": 16, "toBase": 10, "output": "255", "decimalValue": "255" }
```

### `POST /api/convert/unit` — 单位换算

**请求体**

```json
{ "category": "temperature", "from": "c", "to": "f", "value": 100 }
```

**响应**

```json
{ "success": true, "category": "temperature", "from": "c", "to": "f", "input": 100, "output": 212, "outputText": "212" }
```

---

## 响应约定

### 状态码

| 状态码 | 使用场景 |
| --- | --- |
| `200 OK` | 查询成功、删除成功 |
| `201 Created` | 计算成功并创建了一条历史记录 |
| `204 No Content` | CORS 预检请求（`OPTIONS`） |
| `400 Bad Request` | 表达式非法、参数不合法、请求体不是合法 JSON |
| `404 Not Found` | 记录不存在、接口路径不存在 |
| `413 Payload Too Large` | 请求体超过上限 |
| `500 Internal Server Error` | 未预期的服务端异常 |
| `503 Service Unavailable` | 健康检查发现数据库不可用 |

### 错误码

响应体中的 `code` 是稳定的机器可读标识，前端据此做文案本地化。

| 错误码 | 含义 |
| --- | --- |
| `EXPRESSION_REQUIRED` | 缺少 `expression` 字段或为空 |
| `EXPRESSION_TOO_LONG` | 表达式超过长度上限 |
| `EXPRESSION_TOO_DEEP` | 括号嵌套超过 64 层 |
| `ILLEGAL_CHARACTER` | 出现无法识别的字符（`detail.position` 给出位置） |
| `UNEXPECTED_TOKEN` | 记号位置不对（例如 `1+2)`） |
| `UNEXPECTED_END` | 表达式未写完（例如 `1+`） |
| `UNBALANCED_PARENTHESIS` | 括号不配对 |
| `UNKNOWN_IDENTIFIER` | 未知的函数名或常量名 |
| `BAD_ARGUMENT_COUNT` | 函数参数个数错误 |
| `DIVISION_BY_ZERO` | 除以零 |
| `DOMAIN_ERROR` | 定义域错误（如 `sqrt(-1)`、`ln(0)`） |
| `RESULT_NOT_FINITE` | 结果超出双精度可表示范围 |
| `INVALID_HISTORY_ID` | 历史记录 id 不是正整数 |
| `HISTORY_NOT_FOUND` | 指定 id 的记录不存在 |
| `INVALID_PAGINATION` | 分页参数非法 |
| `MALFORMED_JSON` | 请求体不是合法 JSON |
| `INVALID_BASE_CONVERSION` | 进制换算参数非法 |
| `INVALID_UNIT_CONVERSION` | 单位换算参数非法 |
| `ROUTE_NOT_FOUND` | 请求的接口路径不存在 |
| `INTERNAL_ERROR` | 服务端内部错误 |

---

## 项目结构

```
calculator_backend/
├── src/
│   ├── server.js                 # 入口：连数据库、建表、监听端口、优雅退出
│   ├── app.js                    # Express 应用装配（中间件与路由顺序）
│   ├── config/
│   │   └── index.js              # 集中式配置（环境变量 -> 配置对象）
│   ├── calculator/               # ★ 计算内核：不依赖 HTTP，也不依赖数据库
│   │   ├── index.js              # 计算流程门面 calculate()
│   │   ├── tokenizer.js          # 词法分析：字符 -> 记号
│   │   ├── parser.js             # 语法分析：递归下降，记号 -> 抽象语法树
│   │   ├── evaluator.js          # 求值：语法树 -> 数值（函数白名单）
│   │   ├── format.js             # 数值规范化与格式化
│   │   └── errors.js             # 计算领域错误与错误码
│   ├── db/
│   │   ├── connection.js         # 数据库连接、PRAGMA 设置
│   │   └── schema.js             # 建表语句与索引
│   ├── model/
│   │   └── history.model.js      # 数据访问层：唯一书写 SQL 的地方
│   ├── service/                  # 业务编排
│   │   ├── calculator.service.js # 先计算，成功后再落库
│   │   ├── history.service.js    # 分页校验、404 判定、收藏切换
│   │   └── conversion.service.js # 进制换算、单位换算
│   ├── controller/               # 只处理 HTTP 输入输出
│   │   ├── calculator.controller.js
│   │   ├── history.controller.js
│   │   ├── conversion.controller.js
│   │   └── health.controller.js
│   ├── middleware/
│   │   ├── cors.js               # 跨域白名单
│   │   ├── requestLogger.js      # 请求日志
│   │   └── errorHandler.js       # 统一错误处理与状态码映射
│   ├── routes/
│   │   └── index.js              # 路由表
│   ├── data/
│   │   └── units.js              # 单位换算静态定义表
│   └── utils/
│       └── logger.js             # 极简结构化日志
├── tests/
│   ├── calculator.test.js        # 计算内核单元测试（含安全性测试）
│   └── api.test.js               # 接口集成测试
├── scripts/
│   ├── init-db.js                # 查看/初始化表结构
│   └── seed.js                   # 示例数据
├── data/                         # 运行时生成的数据库文件（不提交）
├── package.json
├── codestyle.md
└── README.md
```

### 分层与依赖方向

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator（纯计算，无外部依赖）
```

依赖只能自上而下。`calculator/` 不认识 HTTP，也不认识数据库，
因此可以脱离服务器单独测试——这也是它能被 60 多个单元测试快速覆盖的原因。

---

## 测试

```bash
npm test
```

使用 Node 内置测试运行器，无需安装任何测试框架。

**测试覆盖：**

| 测试文件 | 用例数 | 覆盖内容 |
| --- | --- | --- |
| `tests/calculator.test.js` | 约 60 | 四则运算、优先级、括号、一元正负号、小数、科学计数法、乘方、科学函数、全部异常分支、安全性（原型链攻击、恶意载荷） |
| `tests/api.test.js` | 约 60 | 全部接口的成功与失败路径、状态码、错误码、分页边界、数据库真实性校验、CORS |

**两条特别值得注意的测试：**

1. **`源码中不存在 eval / new Function 调用`**
   直接读取 `src/calculator/*.js` 的源码逐行检查（跳过注释行），
   从机制上保证不会有人后来偷偷加回 `eval`。这比人工审查可靠。

2. **`原型链属性不能冒充白名单条目`**
   这条测试源于一个真实修掉的缺陷：最初的实现写成 `CONSTANTS[name] !== undefined`，
   于是输入 `constructor` 会命中原型链上的 `Object.prototype.constructor`，
   绕过「未知标识符」检查。修复方式是把所有白名单查表改为 `Object.hasOwn`。
   测试覆盖 `constructor` / `toString` / `valueOf` / `__proto__` 等 8 个名字。

---

## 设计要点

### 1. 为什么手写表达式解析器，而不用第三方库？

作业明令**禁止 `eval` / `exec` 等任意代码执行方式**。在此基础上还有三个选择：

| 方案 | 评价 |
| --- | --- |
| `eval` / `new Function` | **禁止**。会把用户输入当程序执行，一句 `process.exit()` 就能打垮服务 |
| 第三方数学库（如 `mathjs`） | 合法，但会顺带引入赋值、单位、矩阵等能力，攻击面远大于计算器所需 |
| **手写递归下降解析器** | **本项目选择**。文法即代码，结构清晰，可测试，攻击面等于一张白名单 |

**递归下降的核心是让代码结构与数学书写习惯同形**，每条文法产生式对应一个函数：

```
expression     := additive
additive       := multiplicative ( ("+" | "-") multiplicative )*
multiplicative := unary ( ("*" | "/") unary )*
unary          := ("+" | "-") unary | power
power          := primary ( "^" unary )?
primary        := NUMBER | IDENTIFIER | IDENTIFIER "(" arguments ")" | "(" expression ")"
```

三处容易写错的优先级细节：

- `-2^2` 应等于 `-4`（先算幂再取负）→ `unary` 必须位于 `power` **之上**；
- `2^3^2` 应等于 `512`（右结合）→ `power` 的指数部分递归调用 `unary`；
- `2^-3` 应合法（等于 `0.125`）→ 指数用 `unary` 而非 `primary`，才能吃掉负号。

三者互相牵制，必须同时满足，这也是选择自己实现而不是调库的主要价值所在。

### 2. 为什么用 `node:sqlite` 而不是 `better-sqlite3`？

`better-sqlite3` 是**原生模块**，安装时要匹配 Node 的 ABI 版本下载预编译包；
匹配不上就回落到本地编译，需要 Python 与 C++ 工具链——这是 Node 项目部署最经典的翻车点。

`node:sqlite` 是 Node 22.5 起的内置模块，零安装、零编译。
对一个要求「助教能照着 README 跑起来」的课程作业来说，
把环境风险降到零比追求生态成熟度更重要。

两者的 API 形态高度相似（`prepare` / `run` / `get` / `all`），
将来若因版本限制需要换回 `better-sqlite3`，改动集中在 `src/model/` 一层。

### 3. 为什么把 HTTP 状态码映射单独放在错误处理中间件里？

`calculator/errors.js` 定义的 `CalculatorError` 只有 `code` / `message` / `detail`，
**故意不包含 HTTP 状态码**。理由：

- 计算内核可以脱离 HTTP 单独测试与复用（将来换成 CLI 或 gRPC 都不用改）；
- 「哪种错误该回 400 还是 404」是接口层的决策，集中在一张表里更易审查。

映射表位于 `src/middleware/errorHandler.js` 的 `CALCULATOR_ERROR_STATUS`。

### 4. 数值精度：12 位有效数字的取舍

`0.1 + 0.2` 在 IEEE-754 双精度下等于 `0.30000000000000004`。
直接显示会让人以为算错了。

处理方式是把结果四舍五入到 **12 位有效数字**：

- 12 位远小于双精度的约 15.95 位有效数字，对绝大多数算式不损失用户关心的精度；
- 又足够大，能保留 `1/3 = 0.333333333333` 这类结果的有效信息。

这是一个**面向人类阅读**的取舍，而非追求数学上的完全精确。
真正的精确十进制运算需要引入 `decimal.js` 之类的实现，对课程作业属过度设计。
实现见 `src/calculator/format.js`。

### 5. 大整数进制换算用 BigInt

JavaScript 的 `Number` 只能精确表示 2^53 以内的整数。
十六进制的 16 位数字（如 `ffffffffffffffff`）早已越界，
用 `Number` 转换会得到末位被抹平的错误结果。

`parseInBase` 因此对整数部分使用 `BigInt` 逐位累加，保证任意长度都精确：

```
ffffffffffffffff (16) -> 18446744073709551615 (10)
```

小数部分仍用双精度处理——小数换算本身就是近似值（`0.1` 在二进制中是无限循环），
用有限精度表示是行业通行做法。

---

## 常见问题

### 启动报错 `Cannot find module 'node:sqlite'`

Node 版本低于 22.5.0。执行 `node -v` 确认，然后升级 Node（推荐 22 LTS 或 24）。

### 端口被占用 `EADDRINUSE`

换一个端口启动：

```bash
# Linux / macOS
PORT=5001 npm start

# Windows PowerShell
$env:PORT=5001; npm start
```

### 前端页面显示「无法连接后端服务」

1. 确认后端已启动：`curl http://127.0.0.1:5000/api/health`
2. 确认端口与前端 `src/js/config.js` 中的约定一致（默认 5000）
3. 若前端部署在其他域名，检查 `CORS_ORIGINS` 是否包含该来源

### 历史记录为空

服务首次启动时数据库是空的，需要先做一次成功的计算。
失败的计算（如 `1/0`）不会写入历史，这是有意设计——作业要求「每次**成功**的计算"入库。
若需要一次性生成演示数据，运行 `npm run seed`。

### 想重置数据库

停止服务后删除数据文件即可，下次启动会自动重建：

```bash
rm -f data/calculator.sqlite data/calculator.sqlite-wal data/calculator.sqlite-shm
```

---

## 相关文档

- [codestyle.md](./codestyle.md) —— 代码规范（依据 Google JavaScript Style Guide）
- 前端仓库：`calculator_frontend`
