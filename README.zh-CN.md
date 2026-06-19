# reliable-web-search

**多供应商 Web 搜索，自动降级、熔断保护、零配置启动。**

[![npm version](https://img.shields.io/npm/v/reliable-web-search)](https://www.npmjs.com/package/reliable-web-search)
[![license](https://img.shields.io/npm/l/reliable-web-search)](LICENSE)

[English](./README.md)

---

## 为什么需要它

每个搜索 API 都可能挂——被限流、key 过期、网络抖一下。`reliable-web-search` 帮你兜底：

- **顺序降级** — 第一个挂了？自动切第二个
- **熔断保护** — 连续失败的 provider 暂停 60 秒，避免雪崩
- **零配置启动** — DuckDuckGo 开箱即用，不需要任何 API key
- **环境变量自检测** — 设了 key 就自动选最好的 provider
- **统一结果格式** — 不管底层用谁，返回格式都一样

## 快速开始

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

// 零配置 — 自动使用 DuckDuckGo（无需 API key）
const result = await reliableSearch('量子计算最新进展');

console.log(result.results);
// [
//   { title: '...', url: 'https://...', snippet: '...', provider: 'duckduckgo' },
//   ...
// ]

console.log(result.provider);    // 'duckduckgo'
console.log(result.elapsedMs);   // 342
```

## 加上 API Key（结果更准，依旧自动）

```bash
# 设好环境变量就行，包会自动发现
export BRAVE_API_KEY="your-key"     # https://brave.com/search/api/
export BOCHA_API_KEY="your-key"     # https://open.bochaai.com
export METASO_API_KEY="your-key"    # https://metaso.cn
export TAVILY_API_KEY="your-key"    # https://tavily.com
export GEMINI_API_KEY="your-key"    # https://aistudio.google.com/apikey
export SERPAPI_API_KEY="your-key"   # https://serpapi.com
export SEARXNG_BASE_URL="http://localhost:8080"  # 自托管 SearXNG
```

```ts
// 不用改代码 — 自动探测哪些 provider 有 key
const result = await reliableSearch('RISC-V vector extension');
// 实际用哪个取决于你配了哪些 key
```

## 指定 Provider 顺序

```ts
const result = await reliableSearch('深度学习框架对比', {
  providers: ['bocha', 'metaso', 'duckduckgo'],
  count: 10,
  language: 'zh',
  freshness: 'month',
});
```

## API

### `reliableSearch(query, options?)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | `string` | *(必填)* | 搜索关键词 |
| `providers` | `string[]` | 自动检测 | provider 优先级列表 |
| `count` | `number` | `5` | 最大返回数（1–20） |
| `country` | `string` | — | ISO 3166-1 alpha-2 国家代码，如 `'cn'` |
| `language` | `string` | — | ISO 639-1 语言代码，如 `'zh'` |
| `freshness` | `'day' \| 'week' \| 'month' \| 'year'` | — | 时间过滤 |
| `timeout` | `number` | `15000` | 单 provider 超时 (ms) |
| `signal` | `AbortSignal` | — | 取消搜索 |
| `fallback` | `FallbackConfig` | sequential | 降级策略 |
| `cache` | `CacheConfig` | 开启 | 结果缓存 |

### `ReliableSearchResult`

```ts
interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;           // 实际使用的 provider
  providerPath: string[];      // 完整调用链，如 ['brave', 'tavily', 'duckduckgo']
  fallbackReason?: string;     // 降级原因，如 'brave: rate_limited'
  attempts: Record<string, number>;  // 每个 provider 的尝试次数
  elapsedMs: number;           // 总耗时 (ms)
}
```

## 降级模式

| 模式 | 行为 |
|------|------|
| `sequential` (默认) | 一个一个试，成功就停 |
| `parallel` | 全部同时发，取最快回来那个 |
| `best-effort` | 全部同时发，合并所有成功的结果 |

## 内置 Provider

| Provider | ID | 需要 Key | 适合场景 |
|----------|----|---------|----------|
| DuckDuckGo | `duckduckgo` | 不需要 | 零配置默认，中英文均可 |
| Brave | `brave` | `BRAVE_API_KEY` | 英文网页搜索 |
| Bocha (博查) | `bocha` | `BOCHA_API_KEY` | 中文网页搜索 |
| Metaso (秘塔) | `metaso` | `METASO_API_KEY` | 中文 AI 搜索 |
| Tavily | `tavily` | `TAVILY_API_KEY` | AI / RAG 场景 |
| Gemini | `gemini` | `GEMINI_API_KEY` | Google 搜索 |
| SerpAPI | `serpapi` | `SERPAPI_API_KEY` | 多引擎聚合（百度/Google 等） |
| SearXNG | `searxng` | `SEARXNG_BASE_URL` | 自托管，隐私友好 |

## 自定义 Provider

```ts
import { registry } from 'reliable-web-search';
import type { SearchProvider } from 'reliable-web-search';

const myProvider: SearchProvider = {
  id: 'my-search',
  name: '我的搜索引擎',
  requiresKey: true,
  envVars: ['MY_SEARCH_API_KEY'],

  async search(params) {
    const key = process.env.MY_SEARCH_API_KEY;
    const res = await fetch(`https://api.example.com/search?q=${params.query}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    return { results: data.items };
  },

  normalize(raw, query) {
    return raw.results.map(r => ({
      title: r.title, url: r.url, snippet: r.desc, provider: 'my-search',
    }));
  },
};

registry.register(myProvider);
```

## 零运行时依赖

整个包**没有运行时依赖**，只用了 `fetch`（Node 18+ 内置）。打包后体积 < 20 KB。

## License

MIT
