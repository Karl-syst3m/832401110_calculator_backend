# 后端代码规范（Calculator Backend Codestyle）

## 规范来源

本文档的规范依据以下公开标准，并按本项目的技术栈做了取舍与细化：

| 来源 | 版本 / 链接 | 采用范围 |
| --- | --- | --- |
| **Google JavaScript Style Guide** | https://google.github.io/styleguide/jsguide.html | **主要依据**。命名、文件结构、导入顺序、注释、语言特性限制 |
| **Node.js Best Practices** | https://github.com/goldbergyoni/nodebestpractices | 项目结构分层、错误处理、配置管理、安全实践 |
| **MDN JavaScript Reference** | https://developer.mozilla.org/zh-CN/docs/Web/JavaScript | 语言特性语义确认 |
| **Airbnb JavaScript Style Guide** | https://github.com/airbnb/javascript | 在 Google 指南未覆盖处补充（如数组/对象解构习惯） |
| **Conventional Commits** | https://www.conventionalcommits.org/ | 提交信息格式 |

**与 Google 指南的差异说明**（差异处均在此明确列出，避免读者困惑）：

1. **使用 ES Module 而非 CommonJS**。Google 指南成文时 CommonJS 仍是主流，
   但 Node 22+ 已稳定支持 ESM，且与前端保持一致的模块语法可减少心智切换成本。
2. **不用 JSDoc 强制标注所有函数类型**。本项目不使用 TypeScript，
   对参数复杂、契约不直观的函数（尤其是 `calculator/` 与 `service/` 层）写 JSDoc；
   对一目了然的小函数只写说明性注释，避免注释噪音。
3. **注释使用中文**。本项目为课程作业，读者是中文母语者。
   标识符、错误码、对外接口的 `message` 字段仍全部使用英文。

---

## 目录

- [1. 文件与目录](#1-文件与目录)
- [2. 命名规范](#2-命名规范)
- [3. 格式规范](#3-格式规范)
- [4. 模块与导入](#4-模块与导入)
- [5. 注释规范](#5-注释规范)
- [6. 语言特性限制](#6-语言特性限制)
- [7. 错误处理](#7-错误处理)
- [8. 安全规范](#8-安全规范)
- [9. 异步与数据库](#9-异步与数据库)
- [10. 分层架构约束](#10-分层架构约束)
- [11. Git 提交规范](#11-git-提交规范)
- [12. 提交前检查清单](#12-提交前检查清单)

---

## 1. 文件与目录

### 1.1 文件名

- **全部小写，单词间用连字符或点分隔**。不使用驼峰，避免在大小写不敏感的文件系统
  （Windows、macOS 默认）上出现 `UserModel.js` 与 `usermodel.js` 冲突。
- **职责后缀**体现文件角色，便于按名定位：

```
history.model.js        # 数据访问层
history.service.js      # 业务层
history.controller.js   # 接口层
errorHandler.js         # 中间件
calculator.test.js      # 测试
dev-server.mjs          # 独立可执行脚本
```

### 1.2 目录组织

按**职责**而不是按**技术类型**切分。同一个功能的相关代码相邻，而不是把
所有函数放一个目录、所有常量放另一个目录：

```
src/
├── calculator/     计算内核（纯逻辑，无 IO）
├── db/             数据库连接与表结构
├── model/          数据访问
├── service/        业务编排
├── controller/     HTTP 输入输出
├── middleware/     中间件
├── routes/         路由表
├── data/           静态配置数据
└── utils/          无业务含义的通用工具
```

### 1.3 一个文件一个主职责

单个文件建议不超过 400 行。超过时优先考虑是否混淆了多个职责，
而不是简单拆成 `xxx-part1.js`。

---

## 2. 命名规范

### 2.1 命名风格总表

| 对象 | 风格 | 示例 |
| --- | --- | --- |
| 变量、函数 | `lowerCamelCase` | `expressionInput`、`calculateAndRecord` |
| 类 | `UpperCamelCase` | `CalculatorError`、`AppError` |
| 常量（模块级不变值） | `UPPER_SNAKE_CASE` | `MAX_DEPTH`、`SIGNIFICANT_DIGITS` |
| 模块级私有变量 | 前缀 `_` **不使用**，改用不导出 | 见 2.3 |
| 数据库字段 | `snake_case` | `normalized_expression` |
| 接口 JSON 字段 | `lowerCamelCase` | `normalizedExpression` |
| 布尔值 | `is` / `has` / `can` / `should` 开头 | `isFavorite`、`hasFraction` |
| 事件处理函数 | `handle` + 事件名 | `handleKeypadClick` |
| 测试描述 | 中文，描述行为而非实现 | `'除以零返回 400 与明确错误码'` |

### 2.2 命名要有信息量

```javascript
// ✅ 好：名字说明了它是什么、单位是什么
const requestTimeoutMs = 10000;
const HISTORY_PAGE_SIZE_MAX = 100;

// ❌ 差：data、info、temp、flag 这类名字没有传递任何信息
const data = await fetch(url);
const flag = true;
```

> 例外：极短的局部作用域内（如 `map` 回调）允许 `x`、`item` 等简名。

### 2.3 私有成员

不使用 `_` 前缀表示私有。模块作用域内的非导出变量天然就是私有的：

```javascript
// ✅ 只导出需要的，其余留在模块作用域
const INTERNAL_CACHE = new Map();
export function getFromCache(key) { /* ... */ }
```

类内部真正需要隐藏的字段用 `#` 私有字段（ECMAScript 原生语法）。

### 2.4 数据库字段与接口字段的映射

数据库用 `snake_case`，接口用 `lowerCamelCase`，**转换只发生在 model 一层**：

```javascript
// src/model/history.model.js
function mapRow(row) {
  return {
    id: Number(row.id),
    normalizedExpression: row.normalized_expression,  // snake -> camel
    isFavorite: row.is_favorite === 1,                // 0/1 -> boolean
  };
}
```

这样前端不会看到下划线字段，改动数据库列名也不会波及前端。

---

## 3. 格式规范

### 3.1 缩进与行宽

- 缩进 **2 个空格**（Google 指南规定，不用 Tab）。
- 单行不超过 **100 个字符**。超过时按语义换行，而不是在运算符中间硬断。

### 3.2 分号

**必须写分号。** JavaScript 的自动分号插入（ASI）在以下情况会产生意外结果：

```javascript
// ❌ 危险：会被解析成 return; 之后是独立表达式
return
  { value: 1 }

// ✅ 正确
return { value: 1 };
```

### 3.3 引号

- 代码中统一使用**单引号**。
- 字符串里包含单引号时用模板字符串，而不是转义：

```javascript
const message = `History id must be a positive integer, received "${rawId}".`;
```

### 3.4 尾随逗号

多行数组与对象**保留尾随逗号**。这样在末尾增删一项时，
Git diff 只会显示一行变化，而不是两行：

```javascript
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',          // <- 尾随逗号
});
```

### 3.5 空行

- 函数之间：1 个空行
- 逻辑段落之间：1 个空行
- 文件末尾：1 个换行符（避免 diff 显示 `\ No newline at end of file`）
- **连续空行不超过 1 个**

---

## 4. 模块与导入

### 4.1 使用 ES Module

```javascript
// ✅
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function calculate() {}

// ❌ 不混用 CommonJS
const path = require('path');
```

### 4.2 导入顺序

按以下顺序分组，组间空一行。内置模块用 `node:` 前缀显式标识：

```javascript
// 1. Node 内置模块（必须带 node: 前缀）
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// 2. 第三方依赖
import express from 'express';

// 3. 项目内部模块（按依赖方向自上而下）
import config from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { insertHistory } from '../model/history.model.js';
```

> `node:` 前缀的作用：一眼区分「内置模块」与「名字恰好相同的 npm 包」，
> 并且可防止被同名第三方包劫持。

### 4.3 导入必须带扩展名

ESM 要求相对导入写明 `.js` 后缀：

```javascript
import { calculate } from './calculator/index.js';   // ✅
import { calculate } from './calculator';            // ❌ 运行时报错
```

### 4.4 禁止循环依赖

依赖方向必须是单向的：

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator
```

若发现两个模块互相 import，说明职责划分有误，应抽出公共部分到下层。

---

## 5. 注释规范

### 5.1 注释解释「为什么」，不解释「是什么」

这是本项目最重要的一条注释约定。

```javascript
// ❌ 无价值：代码已经说清楚了
// 把 i 加 1
i += 1;

// ✅ 有价值：说明了非显然的取舍
// 12 位远小于双精度的约 15.95 位有效数字，因此对绝大多数算式不损失精度；
// 又足够大，能保留 1/3 = 0.333333333333 这类结果的有效信息。
const SIGNIFICANT_DIGITS = 12;
```

### 5.2 JSDoc 的使用范围

**必须写 JSDoc** 的情况：

- 导出的函数，且参数或返回值不直观
- 会抛出异常的函数（写 `@throws`）
- 类的构造函数

**不必写**的情况：一目了然的小工具函数、内部回调。

```javascript
/**
 * 计算一个数学表达式。
 *
 * @param {unknown} rawExpression 前端传来的原始表达式
 * @param {object} [options]
 * @param {number} [options.maxLength] 长度上限
 * @returns {{value: number, valueText: string, ast: object}}
 * @throws {CalculatorError} 表达式非法或无法计算时抛出
 */
export function calculate(rawExpression, options = {}) { /* ... */ }
```

### 5.3 安全相关的代码必须注释原因

任何防御性代码都要写明**防御的是什么**，否则后人会认为是多余检查而删掉：

```javascript
// 必须用 Object.hasOwn 判断，不能只判断 !== undefined。
// 原因：CONSTANTS 是普通对象，原型链上挂着 constructor / toString 等属性，
// 直接取值会让输入 "constructor" 命中原型链属性，绕过白名单检查。
const value = Object.hasOwn(CONSTANTS, node.name) ? CONSTANTS[node.name] : undefined;
```

### 5.4 待办标记

未完成事项统一用 `TODO:` 开头，并说明原因：

```javascript
// TODO: 支持弧度/角度模式切换，需要在前端增加开关并透传到 API
```

---

## 6. 语言特性限制

### 6.1 严禁使用的特性

| 特性 | 原因 |
| --- | --- |
| `eval()` / `new Function()` | **作业明令禁止**。会把用户输入当代码执行，属注入漏洞 |
| `child_process` 执行拼接命令 | 命令注入风险 |
| `node:vm` | 无法提供真正的安全沙箱，易被逃逸 |
| `var` | 函数作用域易导致变量提升问题，用 `const` / `let` |
| `==` / `!=` | 隐式类型转换易产生意外，用 `===` / `!==` |
| `with` | 严格模式下禁用，作用域不清晰 |
| 直接修改内置原型 | 污染全局环境污染所有依赖 |
| 同步阻塞式 IO（`fs.readFileSync` 等）于请求路径中 | 阻塞事件循环，拖垮并发 |

本项目通过一条**自动测试**保证 `eval` 类调用不会回流：

```javascript
// tests/calculator.test.js
test('源码中不存在 eval / new Function 调用', async () => {
  // 逐行读取 src/calculator/*.js（跳过注释行），断言不出现 eval / new Function
});
```

### 6.2 优先使用的写法

```javascript
// ✅ const 优先，需要重新赋值才用 let，永不用 var
const items = [];

// ✅ 解构
const { position, character } = error.detail;

// ✅ 可选链与空值合并
const message = error?.message ?? 'Unknown error';

// ✅ 模板字符串
const url = `${baseUrl}/api/history`;

// ✅ Object.hasOwn 判断自有属性（替代 obj.hasOwnProperty）
if (Object.hasOwn(TABLE, key)) { /* ... */ }

// ✅ 数组的不可变方法
const doubled = numbers.map((n) => n * 2);
```

### 6.3 查表时必须用 `Object.hasOwn`

这是本项目的一条**强制规则**，因为已经因此出过一次真实缺陷：

```javascript
// ❌ 错误：输入 "constructor" 会命中原型链上的 Object.prototype.constructor
const spec = FUNCTIONS[name];
if (spec !== undefined) { /* 把函数当数值用了 */ }

// ✅ 正确
const spec = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
if (spec === undefined) { /* 正确的未知标识符处理 */ }
```

适用范围：所有以用户输入或外部参数作为键去查普通对象的地方。

---

## 7. 错误处理

### 7.1 错误分层

| 错误类 | 位置 | 含义 | 是否含 HTTP 状态码 |
| --- | --- | --- | --- |
| `CalculatorError` | `src/calculator/errors.js` | 表达式本身有问题 | **否**（刻意） |
| `AppError` | `src/errors/appError.js` | 资源不存在、参数非法 | 是 |

计算内核不携带 HTTP 语义，是为了让它能脱离 HTTP 单独测试与复用。

### 7.2 状态码映射集中管理

**唯一**的映射位置是 `src/middleware/errorHandler.js`。禁止在 controller 里
自行判断错误类型并拼装响应：

```javascript
// ❌ 错误：每个 controller 各拼一份，格式迟早不一致
export function calculate(req, res) {
  try {
    /* ... */
  } catch (error) {
    res.status(400).json({ error: error.message });   // 缺少 code 字段
  }
}

// ✅ 正确：交给统一错误处理中间件
export function calculate(req, res, next) {
  try {
    /* ... */
  } catch (error) {
    next(error);
  }
}
```

### 7.3 错误码用常量，不用裸字符串

```javascript
// ✅
import { ErrorCodes } from './errors.js';
throw new CalculatorError(ErrorCodes.DIVISION_BY_ZERO, 'Division by zero is not allowed.');

// ❌ 拼错不会报错，只会在运行时表现为「奇怪的错误码」
throw new CalculatorError('DIVISON_BY_ZERO', '...');
```

### 7.4 错误响应格式必须统一

```json
{
  "success": false,
  "code": "DIVISION_BY_ZERO",
  "message": "Division by zero is not allowed.",
  "detail": { "dividend": 1, "divisor": 0 }
}
```

- `code`：稳定的机器可读标识，前端据此做文案本地化
- `message`：面向接口调用者的英文说明
- `detail`：可选，附加上下文（出错位置、函数名、期望值等）；为空时省略该字段

### 7.5 不吞掉异常

```javascript
// ❌ 禁止空 catch
try {
  doSomething();
} catch (error) {}

// ✅ 至少记录，或明确说明为何可以忽略
try {
  window.localStorage.setItem(key, value);
} catch {
  // 隐私模式下 localStorage 不可用，降级为不持久化即可，无需中断流程
}
```

### 7.6 500 错误不泄露内部信息

生产环境下 `NODE_ENV=production` 时，500 响应体只返回通用消息，
原始错误信息（可能包含文件路径、SQL 语句）只写日志：

```javascript
config.isProduction ? {} : { originalMessage: error.message }
```

---

## 8. 安全规范

### 8.1 SQL 一律使用参数绑定

```javascript
// ✅ 参数绑定
db.prepare('SELECT * FROM calculation_history WHERE id = ?').get(id);

// ❌ 字符串拼接（SQL 注入）
db.prepare(`SELECT * FROM calculation_history WHERE id = ${id}`).get();
```

**唯一的例外**是排序字段名与排序方向——它们无法用占位符绑定。
处理方式是**白名单校验**：

```javascript
const SORTABLE_COLUMNS = Object.freeze({
  createdAt: 'created_at',
  result: 'result',
  id: 'id',
});
const column = Object.hasOwn(SORTABLE_COLUMNS, sortBy)
  ? SORTABLE_COLUMNS[sortBy]
  : SORTABLE_COLUMNS.createdAt;
```

### 8.2 LIKE 通配符必须转义

```javascript
// 不转义时，用户搜索 "5%" 会被当成「以 5 开头」的模糊匹配
function escapeLikePattern(keyword) {
  return keyword.replace(/[\\%_]/g, (match) => `\\${match}`);
}
// SQL 中配合 ESCAPE '\' 使用
```

### 8.3 不信任任何客户端输入

- 分页 `pageSize` 在服务端强制压到上限（`Math.min(raw, maxPageSize)`）
- 表达式长度、嵌套深度设上限
- 请求体大小设上限（`bodyLimit`）
- 类型必须校验（`typeof rawExpression !== 'string'` 直接拒绝）

### 8.4 不执行用户输入

这是本项目的核心安全约束。所有用户可控的标识符（函数名、常量名、单位名、类别名）
都只能用于**查表**，查不到即拒绝，不存在任何「按名字动态取函数」的路径。

### 8.5 关掉框架指纹

```javascript
app.disable('x-powered-by');   // 不告诉攻击者这是 Express
```

### 8.6 CORS 白名单，不用通配符

```javascript
// ✅ 回显具体来源
res.setHeader('Access-Control-Allow-Origin', origin);
res.setHeader('Vary', 'Origin');   // 防止缓存把 A 站的响应发给 B 站

// ❌ 通配符：任何网站都能带用户浏览器来调用本接口
res.setHeader('Access-Control-Allow-Origin', '*');
```

---

## 9. 异步与数据库

### 9.1 数据库连接全局唯一

全项目只有 `src/db/connection.js` 持有数据库句柄，
其余代码通过 `getDatabase()` 获取。这样「连接何时建立、何时关闭」只有一个事实来源。

### 9.2 未初始化即抛错，不返回 `null`

```javascript
export function getDatabase() {
  if (database === null) {
    throw new Error('数据库尚未初始化，请先调用 initDatabase()。');
  }
  return database;
}
```

返回 `null` 会让问题延迟到某个请求里变成一句莫名的 `TypeError`；
直接抛错能让它在启动阶段立刻暴露。

### 9.3 写操作必须关心影响行数

```javascript
const deleted = statement.run(id).changes;
if (deleted === 0) {
  // 记录不存在 —— 这应当是一个 404，而不是静默成功
  throw new AppError(AppErrorCodes.HISTORY_NOT_FOUND, `...`, { status: 404 });
}
```

### 9.4 优雅退出

进程退出前必须关闭数据库连接，让 WAL 内容回写主库文件：

```javascript
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

同时设置兜底超时（10 秒），避免某个挂起的连接导致 systemd 最终 SIGKILL。

### 9.5 时间统一用 ISO 8601 UTC 存储

```javascript
const createdAt = new Date().toISOString();   // ✅
```

由前端按用户时区呈现。若按服务器本地时区存储，夏令时切换日会出现歧义。

---

## 10. 分层架构约束

### 10.1 依赖方向

```
routes -> controller -> service -> model -> db
                            |
                            +-> calculator
```

**只允许自上而下依赖，禁止反向。** 具体禁止事项：

| 层 | 禁止 |
| --- | --- |
| `calculator/` | 禁止 import `db/`、`model/`、`express`、`node:http` |
| `model/` | 禁止 import `express`，禁止处理 HTTP 概念（状态码、请求对象） |
| `service/` | 禁止直接书写 SQL，必须通过 `model/` |
| `controller/` | 禁止书写业务规则，禁止直接访问数据库 |

### 10.2 各层职责速查

| 层 | 该做什么 | 不该做什么 |
| --- | --- | --- |
| `calculator/` | 词法、语法、求值、数值格式化 | 知道 HTTP、数据库的存在 |
| `model/` | SQL、行到对象的映射 | 分页合法性判断、业务规则 |
| `service/` | 业务规则、事务编排、错误语义 | 拼 HTTP 响应 |
| `controller/` | 读取请求、调用 service、按约定输出 | 写 try/catch 拼错误响应（交给中间件） |

---

## 11. Git 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<类型>(<范围>): <简短描述>

<可选正文：说明为什么这样改>
```

**类型**

| 类型 | 含义 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档变更 |
| `style` | 格式调整（不影响逻辑） |
| `refactor` | 重构（既不修缺陷也不加功能） |
| `test` | 测试相关 |
| `chore` | 构建、依赖、配置 |

**示例**

```
feat(calculator): 支持一元正负号与乘方右结合

一元符号放在 power 之上，使 -2^2 得到 -4；
power 的指数递归调用 unary，使 2^3^2 右结合为 512，且 2^-3 合法。
```

**要求**

- 描述用中文，祈使句，不超过 50 字
- 一次提交只做一件事
- 不提交 `node_modules/`、`data/`、`.env`

---

## 12. 提交前检查清单

运行以下命令应全部通过：

```bash
node --check src/server.js     # 语法检查
npm test                        # 全部测试通过
```

逐项确认：

- [ ] 没有 `console.log` 残留在 `src/`（日志统一走 `utils/logger.js`）
- [ ] 没有 `eval` / `new Function` / `child_process`
- [ ] 所有 SQL 使用参数绑定；动态部分（排序字段）经过白名单校验
- [ ] 查普通对象时使用了 `Object.hasOwn`
- [ ] 新增的错误码已登记到 `ErrorCodes` 或 `AppErrorCodes`
- [ ] 新增的错误码已在 `errorHandler.js` 的映射表中标注状态码
- [ ] 新增的接口已在 `README.md` 的接口文档中补充
- [ ] 每个导出函数都有职责说明；非显然的取舍写明了原因
- [ ] 敏感信息（密钥、密码、真实 IP）没有硬编码
- [ ] 数据文件 `data/` 未被 `git add`
