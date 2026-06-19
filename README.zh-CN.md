# reliable-web-search

**面向 AI Agent 和弹性应用的策略驱动多供应商 Web 搜索运行时。**

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)

[English](./README.md)

---

## 这是什么

每个搜索 API 都会挂——被限流、key 过期、网络抽风。`reliable-web-search` 是位于你的应用和多个搜索供应商之间的**路由与韧性层**，处理供应商选择、故障转移、结果验证和请求取消。

**这不是"搜一切"的聚合器。** 它是一个策略引擎：你来定义尝试哪些供应商、按什么顺序、什么算成功、什么触发降级。

## 核心能力

- **供应商路由** — 从环境变量自动发现可用供应商，按优先级降级
- **质量门** — 空结果自动切到下一个供应商；可配置最低结果阈值
- **真正的取消** — race 模式用 AbortController 取消落败者；超时取消卡住的请求
- **熔断保护** — 三态断路器隔离故障供应商
- **结果校验** — 拒绝占位 URL、空标题和搜索引擎重定向页面
- **结构化诊断** — 每次尝试记录供应商、状态、耗时和错误分类

## 供应商

| 供应商 | ID | 优先级 | 类型 | 状态 |
|--------|----|--------|------|------|
| Brave | `brave` | 10 | 全文搜索 | ✅ 已验证 |
| Tavily | `tavily` | 11 | 全文搜索 | ✅ 已验证 |
| Bocha (博查) | `bocha` | 12 | 中文搜索 | ⚠️ 实验性 |
| Metaso (秘塔) | `metaso` | 15 | AI 搜索 | ⚠️ 实验性 |
| Gemini | `gemini` | 20 | AI 答案 | ✅ 已验证 |
| SerpAPI | `serpapi` | 30 | 多引擎 | ✅ 已验证 |
| SearXNG | `searxng` | 50 | 自托管 | ✅ 已验证 |
| DuckDuckGo | `duckduckgo` | 100 | 即时答案* | ✅ 已验证 |

**\*DuckDuckGo 使用 Instant Answer API，不是全文搜索。** 返回百科式主题摘要，不是完整网页搜索结果。它是最低优先级的兜底——适合零配置原型开发，不适用于生产级搜索。

标记为**实验性**的供应商，其 API 契约还需真实验证。包中已包含适配器，但可能在真实调用时出现解析错误。

## 快速开始

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
export BOCHA_API_KEY="***"       # https://open.bochaai.com
export TAVILY_API_KEY="***"      # https://tavily.com
export GEMINI_API_KEY="***"      # https://aistudio.google.com/apikey
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

## API

### `reliableSearch(query, options?)`

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `query` | `string` | *(必填)* | 搜索关键词 |
| `providers` | `string[]` | 自动检测 | 供应商 id 优先级列表 |
| `count` | `number` | `5` | 返回结果数 |
| `freshness` | `'day'\|'week'\|'month'\|'year'` | — | 时间过滤 |
| `timeout` | `number` | `15000` | 单供应商超时 (ms) |
| `fallback.mode` | `'fallback'\|'race'\|'aggregate'` | `'fallback'` | 降级策略 |

## 三个降级模式

| 模式 | 行为 |
|------|------|
| `fallback` | 按优先级逐个尝试，空结果/失败自动跳过 |
| `race` | 全部同时发，最快成功者胜，用 AbortController 取消其他 |
| `aggregate` | 全部同时发，合并所有成功结果 |

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

- **零运行时依赖** — 只用 `fetch`（Node 18+）
- **ESM + CJS 双格式** — `import` 和 `require` 都可用
- **结构化 ProviderError** — 含 providerId、HTTP 状态、是否可重试、是否触发熔断

## License

MIT
