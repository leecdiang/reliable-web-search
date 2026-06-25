# reliable-web-search

**多供应商搜索，自动降级，熔断保护，统一 Agent 接入。**

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)

[English](./README.md)

---

## 安装

```bash
npm install --global reliable-web-search
rws
```

安装向导会帮你：

1. 选择搜索供应商（Brave、Tavily、Gemini、DuckDuckGo、SerpAPI、SearXNG、Bocha、Metaso）
2. 安全输入 API Key（不回显）
3. 用一次小搜索验证连接
4. 自动检测本机已安装的 OpenClaw、Codex、Claude Code
5. 把同一个 `reliable_web_search` MCP 工具接入选中的 Agent

配置完成后：

```bash
rws "最新 RISC-V 新闻"
```

### 其他命令

```bash
rws doctor        # 健康检查：Node.js、配置、凭据、供应商、Agent
rws setup         # 重新运行统一设置向导
rws connect       # 接入检测到的 Agent（或指定：openclaw、codex、claude-code、generic）
rws disconnect    # 移除 MCP 注册（供应商凭据不受影响）
```

Agent 集成：

| 宿主          | 检测方式 | 安装方式                          | 状态              |
|---------------|----------|-----------------------------------|-------------------|
| OpenClaw      | 自动     | `openclaw mcp add`                | ✅ 已验证         |
| Codex         | 自动     | `codex mcp add`                   | ⚠️ Beta           |
| Claude Code   | 自动     | `claude mcp add --transport stdio`| ⚠️ Beta           |
| Generic MCP   | 手动     | 标准 MCP 配置                     | 🔧 Standard MCP   |

## 快速开始 (SDK)

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

// 零配置使用 DuckDuckGo Instant Answer（功能有限，但无需 key）
const result = await reliableSearch('量子计算');

console.log(result.provider);      // 'duckduckgo'
console.log(result.resultStatus);  // 'success' | 'no_results' | ...
console.log(result.results);
```

```bash
# 设好环境变量，自动按优先级使用更强的供应商
export BRAVE_API_KEY="***"       # https://brave.com/search/api/
export TAVILY_API_KEY="***"      # https://tavily.com
export GEMINI_API_KEY="***"      # https://aistudio.google.com/apikey
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

## 供应商

| 供应商          | ID           | 需要 Key | 类型           | 状态           |
|-----------------|--------------|---------|-----------------|----------------|
| Brave           | `brave`      | 是      | 全文搜索         | ✅ 已验证       |
| Tavily          | `tavily`     | 是      | AI 优化          | ✅ 已验证       |
| Gemini          | `gemini`     | 是      | Grounded AI      | ✅ 已验证       |
| SerpAPI         | `serpapi`    | 是      | 多引擎           | ✅ 已验证       |
| DuckDuckGo      | `duckduckgo` | 否      | 即时答案*        | ✅ 已验证       |
| SearXNG         | `searxng`    | 配置    | 自托管           | ✅ 已验证       |
| Bocha (博查)    | `bocha`      | 是      | 全文搜索         | ⚠️ 实验性      |
| Metaso (秘塔)   | `metaso`     | 是      | AI 搜索          | ⚠️ 实验性      |

**\*DuckDuckGo 使用 Instant Answer API，不是全文搜索。** 返回百科式主题摘要，不是完整网页搜索结果。最优先级的兜底——适合零配置原型，不用于生产搜索。

## MCP 工具 — `reliable_web_search`

MCP 服务器暴露一个工具给 AI Agent 使用：

```ts
// 工具输入 schema
{
  query: string;                                          // 必填
  count?: number;                                         // 1–20
  strategy?: 'fallback' | 'race' | 'aggregate';
  providers?: string[];
  freshness?: 'day' | 'week' | 'month' | 'year';
}
```

工具描述告诉 Agent：

> 用这个工具获取当前可验证的外部信息。一次失败的检索不代表某个声明是假的。只在 `usableForReview` 为 true 时才把结果当作可审阅内容。

## API

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
  provider: string;
  providerPath: string[];
  fallbackReason?: string;
  attempts: AttemptRecord[];
  elapsedMs: number;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
  resultStatus: ResultStatus;
  cacheHit: boolean;
}
```

## 降级模式

| 模式        | 行为                                                    |
|-------------|---------------------------------------------------------|
| `fallback`  | 按优先级逐个尝试，空结果/失败自动跳到下一个              |
| `race`      | 全部同时发，最快成功者胜，用 AbortController 取消落败者  |
| `aggregate` | 全部同时发，合并所有成功结果                             |

## 配置

CLI 配置存储在：

- **Linux**: `${XDG_CONFIG_HOME:-~/.config}/reliable-web-search/`
- **macOS**: `~/.config/reliable-web-search/`
- **Windows**: `%APPDATA%/reliable-web-search/`

文件：

- `config.json` — 供应商、策略、超时、已接入 Agent
- `credentials.json` — API Key（Unix 上权限限制为 `0600`）

环境变量优先于凭据文件。API Key 不会写入 Agent 配置——Agent 启动 `rws mcp`，由 MCP 进程统一读取本地凭据。

> **安全提醒**：凭据以明文存储，受文件权限保护，不是操作系统 Keychain。如需更高安全性，请使用环境变量。

## 自定义供应商

```ts
import { registry } from 'reliable-web-search';
import type { SearchProvider } from 'reliable-web-search';

const myProvider: SearchProvider = {
  id: 'my-search',
  name: '我的搜索引擎',
  requiresKey: true,
  envVars: ['MY_API_KEY'],
  priority: 15,
  capabilities: {
    fullWebSearch: true, aiGenerated: false,
    maxResults: 20, freshnessSupport: false,
  },
  async search(params) {
    const key = process.env.MY_API_KEY;
    // ... 调用自己的 API
  },
  normalize(raw) {
    return raw.results.map(r => ({ ...r, provider: 'my-search' }));
  },
};

registry.register(myProvider);
```

## 架构

- **核心 SDK** — 零运行时依赖（只使用 `fetch`，Node 18+）
- **CLI** — 增加 `@modelcontextprotocol/sdk`、`zod`、`@inquirer/prompts`，用于交互式设置和 MCP 传输
- **ESM + CJS 双格式** — `import` 和 `require` 都可用
- **结构化 ProviderError** — 含 providerId、HTTP 状态、是否可重试、是否触发熔断

搜索核心保持轻量。CLI 增加少量依赖用于交互式设置和 MCP 传输。

## License

MIT
