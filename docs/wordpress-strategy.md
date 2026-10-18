# WordPress ↔ Fastify & Next.js Integration Strategies

> Architecture guide for connecting headless WordPress (WPGraphQL) to the
> `@crispice/universal-content` stack across both **Fastify/Vite monorepos** and **Next.js applications** (such as author website [`murageh.co.ke`](https://murageh.co.ke)).
> Author: **MURAGEH** ([murageh.co.ke](https://murageh.co.ke)).

---

## 1. Universal Architecture (One Codebase, Two Primary Environments)

`@crispice/universal-content` is built to serve two distinct operational models from the **same single package**:

1. **The Fastify Backend / Vite Monorepo**:
   - Fastify v5 exposes REST endpoints (`/api/content/:type`, `/api/content/:type/:slug`) with two-tier caching (L1 in-process LRU + L2 `ioredis`).
   - Serves static pages or APIs to clients without client-side Node dependencies.
   - Webhook route `POST /api/content/webhook` invalidates cache across workers.

2. **Next.js Applications (e.g. [`murageh.co.ke`](https://murageh.co.ke))**:
   - Uses `@crispice/universal-content/next`.
   - Native App Router Server Components fetch content with ISR tag-based caching (`next: { tags: ['wordpress'] }`).
   - Route Handler (`app/api/revalidate/route.ts`) handles WordPress publish webhooks using `createRevalidateHandler()` for instantaneous on-demand cache revalidation.

```
                    ┌──────────────────────────────────────────────┐
                    │          WordPress CMS (WPGraphQL)           │
                    │              cms.murageh.co.ke               │
                    └──────┬────────────────────────────────┬──────┘
                           │                                │
             (Push: Webhook on publish)         (Pull: GraphQL query with retries)
                           │                                │
              ┌────────────┴─────────────┐    ┌─────────────┴────────────┐
              ▼                          ▼    ▼                          ▼
┌──────────────────────────────┐ ┌───────────────────────────────────────────────┐
│     Next.js Application      │ │     Fastify Monorepo (Backend + Vite)         │
│     (e.g. murageh.co.ke)     │ │                                               │
│                              │ │   GET /api/content/:type                      │
│ • Server Components          │ │   POST /api/content/webhook                   │
│ • import ... from './next'   │ │   • L1 In-process LRU                         │
│ • revalidateTag('wordpress') │ │   • L2 ioredis worker cache                   │
│ • Native notFound() handling │ │   • Serves Vite static pages                  │
└──────────────────────────────┘ └───────────────────────────────────────────────┘
```

---

## 2. Clarifying "Fallback" & Error Handling

> [!IMPORTANT]
> **What does "fallback" actually mean? Does it make up files?**
> **No.** Fallback strictly means:
> 1. **Single Post Request**: If a requested slug was in WordPress and WordPress is unreachable:
>    - The plugin checks if that exact slug exists as a local file (`<slug>.md`).
>    - If it does NOT exist locally: `getDocBySlug` / `getNextDocBySlug` returns `null`.
>    - In **Fastify**: returns HTTP **`404 Not Found`** (`{ "error": "Not found" }`).
>    - In **Next.js**: returns `null`, allowing your component to call Next.js **`notFound()`** (rendering your 404 page).
>    - The plugin **never** invents files, serves random content, or guesses filenames.
> 2. **Collection List Request**: If WordPress is unreachable, `getAllDocs` logs a warning and returns whatever local Markdown posts exist in that collection (or `[]` if none exist).
> 3. **Strict Mode (`onWordPressError: 'throw'`)**: If you prefer WordPress failures to bubble up rather than returning 404/empty, set `onWordPressError: 'throw'`. The host app can then catch the error and render a 503 error boundary.

---

## 3. Next.js 14 / 15 Integration (`./next`)

Using the plugin in Next.js requires zero Fastify dependencies:

### Server Component (App Router)

```ts
// app/blog/page.tsx
import { getNextDocs } from '@crispice/universal-content/next'
import path from 'node:path'

export const revalidate = 3600 // ISR: 1 hour (webhook invalidates on-demand)

export default async function BlogPage() {
  const posts = await getNextDocs({
    contentDir: path.join(process.cwd(), 'content'),
    wordpress: {
      graphqlUrl: process.env.WORDPRESS_GRAPHQL_URL ?? 'https://cms.murageh.co.ke/graphql',
      apiSecret:  process.env.WORDPRESS_API_SECRET,
    },
  }, 'blog')

  return (
    <main>
      <h1>Blog</h1>
      {posts.map((post) => (
        <article key={post.slug}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </main>
  )
}
```

### On-Demand Revalidation Route Handler

```ts
// app/api/revalidate/route.ts
import { createRevalidateHandler } from '@crispice/universal-content/next'
import { revalidateTag } from 'next/cache'

export const POST = createRevalidateHandler({
  secret: process.env.WP_WEBHOOK_SECRET,
  revalidateTag: 'wordpress',
  onRevalidate: async () => {
    revalidateTag('wordpress')
  },
})
```

---

## 4. Fastify Monorepo Adapter (`./fastify`)

### Setup with `ioredis`

```ts
// server.ts
import Fastify from 'fastify'
import Redis from 'ioredis'
import { contentPlugin } from '@crispice/universal-content/fastify'

const app = Fastify({ logger: true })

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

await app.register(contentPlugin, {
  contentDir: new URL('../content', import.meta.url).pathname,
  prefix: '/api/content',
  cache: true,          // L1 in-process LRU
  redis,                // L2 persistent cache via ioredis
  redisTtl: 86400,      // 24 hours
  enableWebhook: true,
  webhookSecret: process.env.FASTIFY_WEBHOOK_SECRET,
  wordpress: {
    graphqlUrl: 'https://cms.murageh.co.ke/graphql',
  },
})

await app.listen({ port: 3001, host: '0.0.0.0' })
```

---

## 5. Strategy A (Proxy Reads) + Strategy B (Webhook Invalidation) Co-existence

| Path | Mechanism | Latency | Reliability Guarantee |
|---|---|---|---|
| **Read Path** | Serves from L1 (LRU) → L2 (`ioredis`) → WPGraphQL | < 1ms on hit, ~200ms on miss | If WP is down, returns local doc or clean 404 |
| **Write Path** | WordPress webhook pushes to Fastify `/api/content/webhook` and/or Next.js `/api/revalidate` | < 100ms | Immediately busts cache; retried warmup (3x) repopulates |
| **Missed Webhook** | Long TTL (e.g. 24h) | Eventual consistency | Cache automatically purges even if webhook fails |
