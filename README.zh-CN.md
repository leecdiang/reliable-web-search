# reliable-web-search

**多供应商搜索，自动降级，熔断保护，凭据级故障转移，统一 MCP Agent 接入。**

[English](README.md) | [简体中文](README.zh-CN.md)

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)

---

## 为什么需要它

搜索是 AI Agent 和应用的基础能力，但生产级搜索有一个关键缺口：**没有哪个供应商是永远可用的**。限流、API 故障、认证失败、内容缺失——每次搜索请求都需要一张安全网：如果一个供应商失败，另一个应透明地顶上。

`reliable-web-search` 把搜索当作**弹性路由问题**来解决。你配置多个供应商和凭据，声明降级顺序，库负责其余部分：故障转移、熔断、退避重试、凭据轮换和基于 MCP 的 Agent 接入。

它不是元搜索引擎、网页爬虫或搜索聚合器。它是现有搜索 API 的**可靠性层**。

---

## 核心能力

- **多供应商、多凭据**——一个供应商可以配置多个 API Key，搜索路由中包含多个供应商
- **凭据级故障转移**——`rate_limited` / `quota_exhausted` / `auth_failure` → 同供应商切换凭据
- **供应商降级**——`network_error` / `timeout` / `no_results` → 路由中下一个供应商
- **熔断保护**——按供应商追踪失败、半开恢复
- **原生 MCP**——向 AI Agent 暴露单个 `reliable_web_search` 工具（OpenClaw、Codex、Claude Code、Generic MCP）
- **202+ 测试**——降级链、凭据故障转移、MCP 传输、打包 CLI 冒烟测试、环境变量路由生命周期
- **ESM + CJS 双构建**
- **CLI 交互式向导**——多凭据循环配置，带路由预览

---

## 安装

```bash
npm install --global reliable-web-search
rws setup
```

如果默认的 npm 全局目录需要 root 权限（macOS/Linux 常见），安全安装方式：

```bash
npm install --global \
  --prefix "$HOME/.local" \
  reliable-web-search
```

然后将 `$HOME/.local/bin` 加入 `PATH`。之后 `rws` 命令即可使用。

### 从 0.3.x 升级

现有 v1 配置会自动安全迁移：

```bash
npm install --global reliable-web-search@0.4.0
rws setup
```

已存在的 `config.json` 和 `credentials.json` 会被原子迁移到新的 v2 格式。自动创建备份，不丢失任何数据。

---

## 30 秒快速开始

```bash
rws "最新 RISC-V 新闻"
```

无配置时使用 DuckDuckGo Instant Answer（无需 API Key，但结果有限）。如需生产级结果，先运行一次安装向导：

```bash
rws setup
```

然后：

```bash
rws "最新 RISC-V 新闻"
```

在 TTY 下直接运行 `rws` 会进入交互式搜索。

---

## 交互式配置

`rws setup` 运行一个**循环式向导**，允许你在进入 Agent 检测之前配置多个供应商和凭据。

1. 选择供应商（Brave、Tavily、Gemini、SerpAPI、DuckDuckGo、SearXNG、Bocha、Metaso）
2. 输入 API Key（不回显）
3. 可选：用一次小搜索验证
4. 指定标签（如 `personal`）——第一个凭据默认为 `default`
5. 选择下一步：
   - **添加另一个供应商**
   - **管理凭据**——添加备份 Key、替换、禁用凭据
   - **查看和调整搜索路由**——重新排序、启用/禁用路由
   - **完成供应商配置**
6. 完成后向导检测 OpenClaw、Codex、Claude Code 和 Generic MCP，并询问是否安装 `reliable_web_search` 工具。

### 配置后检查

```bash
rws doctor
```

显示每条路由的健康状态：配置凭据、环境变量路由、禁用路由和 Agent 连接。

---

## Agent 接入

安装向导会自动检测已安装的 Agent，并注册 `reliable_web_search` MCP 工具。每个 Agent 收到相同的命令：

```json
{
  "command": "/path/to/rws",
  "args": ["mcp"]
}
```

所有 API Key 保留在本机 `credentials.json` 中——不会写入 Agent 配置。

| 宿主          | 检测方式 | 安装方式                          | 状态              |
|---------------|----------|-----------------------------------|-------------------|
| OpenClaw      | 自动     | `openclaw mcp add`                | ✅ 已验证         |
| Generic MCP   | 手动     | 标准 MCP 配置文件                  | 🔧 Standard MCP   |
| Codex         | 自动     | `codex mcp add`                   | ⚠️ Beta           |
| Claude Code   | 自动     | `claude mcp add --transport stdio`| ⚠️ Beta           |

---

## 多供应商与多凭据

你可以为同一个供应商配置多个**凭据**，也可以在一条搜索路由中配置多个**供应商**。

### 示例路由

```
 1. tavily.default        (最高优先级)
 2. tavily.backup-2       (同一供应商，备用 Key)
 3. gemini.default
 4. duckduckgo            (无需 Key 的兜底)
```

### 配置命令示例

```bash
rws credentials add tavily --label personal
rws credentials add tavily --label backup-2
rws credentials add gemini --label default

rws routes list
rws routes move tavily.backup-2 --before gemini.default
rws routes disable duckduckgo
```

**重要**：多账号适用于团队工作空间、Key 轮换、备用凭据等合法场景。请遵守各供应商的服务条款。

---

## 路由和故障转移语义

搜索路由是一个有序的 `(供应商, 凭据)` 对列表。执行遵循**两层故障决策模型**：

### 第一层：凭据级故障转移（同一供应商，切换 Key）

| 错误                            | 行为                               |
|---------------------------------|-----------------------------------|
| `rate_limited`                  | 按顺序尝试同一供应商的下一个 Key   |
| `quota_exhausted`               | 按顺序尝试同一供应商的下一个 Key   |
| `authentication_failure`         | 标记当前凭据不可用，尝试下一个     |

### 第二层：供应商降级（切换供应商）

| 错误                            | 行为                               |
|---------------------------------|-----------------------------------|
| `network_error`                 | 退避重试，然后切换供应商           |
| `timeout`                       | 退避重试，然后切换供应商           |
| `server_error`                  | 触发熔断器，然后切换供应商         |
| `provider_overloaded`           | 触发熔断器，然后切换供应商         |
| `no_results`                    | 直接切换供应商（不重试）           |
| `unusable_results`              | 直接切换供应商（不重试）           |

### 用户取消

如果用户提供 `AbortSignal` 并触发，**所有执行立即停止**——不做凭据重试、供应商降级。

### 搜索模式

| 模式        | 行为                                                    |
|-------------|---------------------------------------------------------|
| `fallback`  | 按优先级逐个尝试，空结果/失败自动跳到下一个              |
| `race`      | 全部同时发，最快成功者胜，用 AbortController 取消落败者  |
| `aggregate` | 全部同时发，合并所有成功结果                             |

> 当前凭据策略仅支持 `failover`。Round-robin、加权或基于健康评分的凭据选择尚未实现。

---

## CLI 命令参考

### 全局选项

| 标志                 | 说明                     |
|----------------------|--------------------------|
| `--json`             | JSON 格式输出            |
| `--verbose`          | 显示详细诊断信息          |
| `--strategy`         | `fallback` \| `race` \| `aggregate` |
| `--provider <id>`    | 指定供应商                |
| `--count <n>`        | 结果数 (1–20)            |

### 命令

```bash
rws setup                              # 循环式配置向导
rws search <query>                     # 搜索（或 "rws <query>" 快捷方式）

rws doctor                             # 路由感知的健康检查
rws doctor --live                      # 验证每个供应商的首选凭据
rws doctor --live --all-credentials    # ⚠ 验证每个凭据（产生真实请求）

rws credentials list                   # 列出所有凭据（Key 已掩码）
rws credentials add <provider> [--label <name>]  # 新增凭据
rws credentials remove <profile-id>    # 删除凭据及关联路由
rws credentials enable <profile-id>    # 重新启用
rws credentials disable <profile-id>   # 禁用但不删除

rws routes list                        # 查看搜索顺序
rws routes move <route-id> --before <other-route-id>  # 调整顺序
rws routes enable <route-id>           # 启用路由
rws routes disable <route-id>          # 禁用路由

rws config                             # 显示配置摘要（Key 掩码）
rws config path                        # 打印配置目录路径

rws connect --all                      # 接入所有检测到的 Agent
rws connect openclaw                   # 接入指定 Agent
rws disconnect --all                   # 断开所有 Agent
rws mcp                                # 启动 MCP stdio 服务器
```

---

## MCP 使用和结果元数据

MCP 服务器提供一个 `reliable_web_search` 工具。

### 工具输入

```json
{
  "query": "RISC-V vector extension",
  "count": 5,
  "strategy": "fallback",
  "freshness": "month"
}
```

### 工具输出（截取）

```json
{
  "results": [
    {
      "title": "RISC-V Vector Extension Overview",
      "url": "https://...",
      "snippet": "...",
      "provider": "tavily"
    }
  ],
  "provider": "tavily",
  "providerPath": ["tavily.default"],
  "attempts": [
    {
      "providerId": "tavily",
      "routeId": "tavily.default",
      "credentialProfile": "default",
      "status": "success",
      "elapsedMs": 340,
      "resultCount": 5
    }
  ],
  "resultStatus": "success",
  "retrievalSucceeded": true,
  "usableForReview": true,
  "elapsedMs": 340,
  "cacheHit": false
}
```

工具描述告诉 AI Agent：

> 用这个工具获取当前可验证的外部信息。一次失败的检索不代表某个声明是假的。只在 `usableForReview` 为 true 时才把结果当作可审阅内容。

**API Key 不会出现**在工具响应、attemps、错误消息或 MCP 日志中。

---

## TypeScript SDK

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

const result = await reliableSearch('RISC-V vector extension');

console.log(result.results);
console.log(`服务供应商: ${result.provider}`);
console.log(`路由: ${result.providerPath.join(' → ')}`);

// 指定供应商（向后兼容——自动展开默认路由）
const explicit = await reliableSearch('quantum computing', {
  providers: ['tavily', 'brave'],
  count: 10,
  timeout: 10_000,
  fallback: { mode: 'fallback' },
});
```

### `reliableSearch(query, options?)`

| 参数                           | 类型                                        | 默认     | 说明             |
|--------------------------------|---------------------------------------------|----------|------------------|
| `query`                        | `string`                                    | *(必填)* | 搜索关键词        |
| `providers`                    | `string[]`                                  | 自动检测  | 供应商 id 列表    |
| `count`                        | `number`                                    | `5`      | 返回结果数        |
| `country`                      | `string`                                    | —        | ISO 3166-1 alpha-2 |
| `language`                     | `string`                                    | —        | ISO 639-1         |
| `freshness`                    | `'day'\|'week'\|'month'\|'year'`             | —        | 时间过滤          |
| `timeout`                      | `number`                                    | `15000`  | 单供应商超时 (ms)  |
| `minResults`                   | `number`                                    | `1`      | 最少结果数         |
| `fallback.mode`                | `'fallback'\|'race'\|'aggregate'`            | `'fallback'` | 降级策略     |
| `fallback.maxRetries`          | `number`                                    | `1`      | 每个供应商重试次数 |
| `fallback.circuitBreaker`      | `CircuitBreakerConfig\|false`                | enabled  | 熔断器配置         |
| `cache`                        | `CacheConfig`                               | enabled  | TTL 缓存          |
| `signal`                       | `AbortSignal`                               | —        | 取消整个搜索       |

### `ReliableSearchResult`

```ts
interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;              // 胜出供应商 id
  providerPath: string[];        // 按顺序尝试的路由 id
  fallbackReason?: string;
  attempts: AttemptRecord[];     // 每次尝试含 routeId、credentialProfile
  elapsedMs: number;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
  resultStatus: ResultStatus;
  cacheHit: boolean;
}
```

---

## 供应商

| 供应商          | ID           | 需要 Key | 类型           | 状态           | 优先级* |
|-----------------|--------------|---------|-----------------|----------------|---------|
| Brave           | `brave`      | 是      | 全文搜索         | ✅ 已验证      | 10      |
| Tavily          | `tavily`     | 是      | AI 优化          | ✅ 已验证      | 11      |
| Gemini          | `gemini`     | 是      | Grounded AI      | ✅ 已验证      | 12      |
| SerpAPI         | `serpapi`    | 是      | 多引擎           | ✅ 已验证      | 13      |
| SearXNG         | `searxng`    | 配置†    | 自托管           | ✅ 已验证      | 14      |
| DuckDuckGo      | `duckduckgo` | 否      | 即时答案‡        | ✅ 已验证      | 100     |
| Bocha (博查)    | `bocha`      | 是      | 全文搜索         | ⚠️ 实验性      | 90      |
| Metaso (秘塔)   | `metaso`     | 是      | AI 搜索          | ⚠️ 实验性      | 91      |

\* 优先级数值越低越优先。向导中根据你的路由配置重新排序。
† SearXNG 不需要 API Key，但需要设置 `SEARXNG_BASE_URL`。
‡ DuckDuckGo 使用 Instant Answer API（百科式主题摘要），不是全文搜索。无需配置的兜底，不适合生产搜索规模。

### 设置 API Key

```bash
# 推荐使用安装向导
rws setup

# 或设置环境变量
export BRAVE_API_KEY="***"
export TAVILY_API_KEY="***"
export GEMINI_API_KEY="***"
export SERPAPI_API_KEY="***"
export BOCHA_API_KEY="***"
export METASO_API_KEY="***"

# SearXNG 需要 base URL 而非 API Key
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

---

## 凭据与安全

- **API Key 仅保存在 `credentials.json`**——不会出现在 `config.json`、MCP Host 配置、stdout、stderr 或日志中。
- **文件权限**：`credentials.json` 创建时权限为 `0600`（仅所有者可读写）。
- **输出掩码**：CLI 显示 Key 时格式为 `BSA••••7A9`（前 3 位 + 后 3 位）。完整 Key 不会出现在终端、doctor 报告或 MCP 响应中。
- **环境变量优先**于文件凭据。如果设置了 `TAVILY_API_KEY`，则优先于同一供应商的文件 Key。
- **v1→v2 迁移**：从 0.3.x 升级时，现有凭据会被原子转换为 v2 profile 格式。原 v1 文件不会自动删除——会创建备份。
- **损坏文件安全**：如果 `credentials.json` 或 `config.json` 不可读或格式错误，工具报错并使用默认值，**不会覆盖你的文件**。

---

## 环境变量路由

设置 `TAVILY_API_KEY="..."` 等环境变量会自动在运行时创建**临时路由**：

```
 1. tavily.env             [env]   (自动生成，最高优先级)
 2. tavily.default          [file]  (来自 credentials.json)
 3. duckduckgo
```

### 临时路由规则

- **不落盘**——不会写入 `config.json` 或 `credentials.json`。
- **自动检测**——每次进程启动时全新生成。
- **更高优先级**——执行顺序始终在文件路由之前。
- **同 Key 去重**——如果环境变量 Key 与文件凭据 Key 相同，只生成文件路由。
- **取消环境变量后消失**——运行 `unset TAVILY_API_KEY` 后该路由即消失。
- **在 `routes list` 中可见**——标记 `[env]`。
- **不能通过 `credentials remove` 删除**——必须取消环境变量。

---

## 代理支持

`reliable-web-search` 使用 `undici` 的 `EnvHttpProxyAgent` 支持代理。

在环境中设置 `HTTPS_PROXY`、`HTTP_PROXY` 或其小写形式：

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
```

检测到代理时，在 CLI 和 MCP 入口激活代理支持。日志中 URL 已清理（不含凭据）。代理状态在 `rws doctor` 中可见。

---

## 配置迁移

### v1 → v2（自动）

| 方面              | v1 (0.3.x)                        | v2 (0.4.0)                                |
|-------------------|-----------------------------------|-------------------------------------------|
| `config.json`     | 扁平 `providers: string[]`        | `routes[]` 含 id、providerId、priority    |
| `credentials.json`| 扁平 `{ TAVILY_API_KEY: "..." }`  | `{ version: 2, profiles: { ... } }`      |
| 迁移              | —                                 | 首次加载时自动，原子操作，带备份            |

首次使用 v1 配置运行 `rws` 或 `rws setup` 时自动迁移：

1. v1 `config.json` 重写为 v2 格式（从扁平供应商列表提取路由）。
2. v1 `credentials.json` 重写为 v2 profiles 格式。
3. 两次操作均为原子操作（临时文件 → fsync → 重命名）。
4. 损坏文件不受影响，报错并使用默认值。

---

## 故障排除

```bash
# 检查所有系统
rws doctor

# 验证供应商是否正常工作（需要 API Key）
rws doctor --live

# 逐个检查每个凭据（每个凭据产生一次请求）
rws doctor --live --all-credentials

# 查看搜索路由顺序
rws routes list

# 列出凭据（Key 已掩码）
rws credentials list
```

### 常见问题

| 现象                            | 可能原因                                    |
|---------------------------------|--------------------------------------------|
| `All 0 route(s) exhausted`      | 未配置或检测到供应商                        |
| `auth_failed`                   | API Key 缺失、错误或已过期                  |
| `network_error`                 | 无网络连接或代理配置错误                    |
| 设置向导中"完成"选项不可用       | 尚未配置任何路由                             |
| 找不到配置                      | 首次运行——运行 `rws setup`                  |
| DuckDuckGo 返回空结果            | DDG Instant Answer API 覆盖范围有限          |

---

## 开发

```bash
git clone https://github.com/leecdiang/reliable-web-search
cd reliable-web-search
npm install
npm run typecheck
npm test
npm run build
npm run test:smoke
```

### 项目结构

```
├── src/
│   ├── index.ts              # SDK 入口，导出 + 自动注册
│   ├── cli.ts                # CLI 入口（rws 命令）
│   ├── reliable-search.ts    # 核心编排器
│   ├── config/               # 配置、凭据、路由解析
│   ├── providers/            # 供应商适配器（tavily、brave…）
│   ├── resilience/           # 降级链、熔断器、错误分类
│   ├── mcp/                  # MCP stdio 服务器
│   ├── adapters/             # Agent 宿主适配器
│   ├── network/              # 代理支持
│   └── setup/                # 交互式配置向导
├── tests/                    # 196+ 测试（降级、配置、供应商、MCP、CLI、环境变量路由）
└── dist/                     # 构建输出（ESM + CJS）
```

### 测试

```bash
npm test                # 完整测试套件
npm run test:smoke      # 打包 CLI / MCP 冒烟测试
```

---

## License

MIT

---

## npm 依赖说明

本包的运行时依赖服务于 CLI 和 MCP 组件：

| 依赖                             | 用途       | 说明                               |
|----------------------------------|-----------|-----------------------------------|
| `undici`                         | 核心 + CLI | HTTP 代理（EnvHttpProxyAgent）      |
| `@inquirer/prompts`              | CLI       | 交互式配置提示                       |
| `@modelcontextprotocol/sdk`      | MCP 服务器 | MCP 协议传输                        |
| `zod`                            | MCP 服务器 | 工具输入 schema 验证                  |

SDK 入口（`src/index.ts`）不直接导入这些依赖；惰性加载确保仅使用 SDK 的消费者不会产生 CLI/MCP 依赖成本。`undici` 仅在代理检测激活时使用。
