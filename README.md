# @crispice/universal-content

> The universal content engine for **Next.js**, **Fastify**, and **Vite**.

> Framework-agnostic Markdown content pipeline with two-tier caching (LRU + ioredis), optional headless WordPress/WPGraphQL merge, and first-class adapters for **Next.js**, **Fastify v5**, and **Vite**.
> Author: **MURAGEH** ([murageh.co.ke](https://murageh.co.ke)).

---

## 🌐 Universal Architecture (One Codebase, Multiple Environments)

`@crispice/universal-content` is designed to be used across diverse architectures from a single, unified codebase:

1. **Next.js Applications** (e.g. author site [`murageh.co.ke`](https://murageh.co.ke)) — Server Components, App Router Route Handlers, on-demand ISR tag revalidation.
2. **Fastify Backend APIs** (monorepo backend) — High-throughput REST API with two-tier caching (L1 LRU + L2 `ioredis`) and publish webhook receiver.
3. **Vite Frontend SPAs / Static Sites** — Virtual module imports (`virtual:md-content/blog`), HMR, and build-time JSON asset generation.

---

## Features

- **Next.js App Router Adapter** (`./next`) — `getNextDocs`, `getNextDocBySlug`, `getRawDocBySlug`, and `createRevalidateHandler` for instant ISR revalidation.
- **Fastify v5 Adapter** (`./fastify`) — REST endpoints (`GET /api/content/:type`, `GET /api/content/:type/:slug`) with two-tier caching.
- **Two-Tier Caching** — L1 in-process LRU (sub-millisecond hot reads) + L2 `ioredis` (cross-process persistence and cluster sharing).
- **Vite Virtual Modules** — `import docs from 'virtual:md-content/blog'` with instant dev HMR.
- **WordPress WPGraphQL Integration** (`./wordpress`) — Merge remote WordPress posts with local Markdown with deterministic SHA-256 slug collision handling.
- **Configurable Fallback & Error Handling** — Controlled via `onWordPressError: 'fallback' | 'throw'`.

---

## Installation

```bash
npm install @crispice/universal-content

# Optional (recommended for persistent cache across restarts in Fastify):
npm install ioredis
```

---

## Usage Guide

### 1. Next.js 14 / 15 (App Router & Server Components)

Use the dedicated Next.js entry point:

```ts
// app/blog/page.tsx (Next.js Server Component)
import { getNextDocs } from '@crispice/universal-content/next'
import path from 'node:path'

export const revalidate = 3600 // Cache for 1 hour; webhook busts it instantly

export default async function BlogPage() {
  const posts = await getNextDocs({
    contentDir: path.join(process.cwd(), 'content'),
    wordpress: {
      graphqlUrl: process.env.WORDPRESS_GRAPHQL_URL ?? 'https://cms.yourdomain.com/graphql',
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

#### Single Post Page with `notFound()`

```ts
// app/blog/[slug]/page.tsx
import { getNextDocBySlug } from '@crispice/universal-content/next'
import { notFound } from 'next/navigation'
import path from 'node:path'

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getNextDocBySlug({
    contentDir: path.join(process.cwd(), 'content'),
    wordpress: {
      graphqlUrl: process.env.WORDPRESS_GRAPHQL_URL!,
    },
  }, 'blog', slug)

  // Clean 404 when post doesn't exist
  if (!post) notFound()

  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  )
}
```

#### On-Demand Revalidation Route Handler (Push on Publish)

Set up a Next.js Route Handler to handle WordPress publish webhooks:

```ts
// app/api/revalidate/route.ts
import { createRevalidateHandler } from '@crispice/universal-content/next'
import { revalidateTag } from 'next/cache'

export const POST = createRevalidateHandler({
  secret: process.env.WP_WEBHOOK_SECRET,
  revalidateTag: 'wordpress',
  onRevalidate: async ({ type, slug }) => {
    revalidateTag('wordpress')
  },
})
```

---

### 2. Fastify Adapter (Backend API + Two-Tier Cache)

```ts
// server.ts
import Fastify from 'fastify'
import Redis from 'ioredis'
import { contentPlugin } from '@crispice/universal-content/fastify'

const app = Fastify({ logger: true })

// Optional ioredis instance or worker config
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

await app.register(contentPlugin, {
  contentDir: new URL('../content', import.meta.url).pathname,
  prefix: '/api/content',

  // Caching
  cache: true,          // L1 in-process LRU
  redis,                // L2 persistent cache via ioredis
  redisTtl: 86400,      // 24 hours (webhook invalidates immediately)

  // Webhook listener
  enableWebhook: true,
  webhookSecret: process.env.FASTIFY_WEBHOOK_SECRET,

  // WordPress GraphQL
  wordpress: {
    graphqlUrl: 'https://cms.yourdomain.com/graphql',
  },
})

await app.listen({ port: 3001, host: '0.0.0.0' })
// GET  /api/content/:type            UnifiedDoc[]
// GET  /api/content/:type/:slug      UnifiedDoc | 404
// POST /api/content/webhook          Invalidates cache & warms up with retries
```

---

### 3. Vite Plugin (Frontend SPA)

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { mdContentPlugin } from '@crispice/universal-content'

export default defineConfig({
  plugins: [
    mdContentPlugin({
      contentDir: new URL('./content', import.meta.url).pathname,
      collections: ['blog', 'news', 'projects'],
    }),
  ],
})
```

Import virtual modules directly in your components:

```ts
import allPosts from 'virtual:md-content/blog'
import post from 'virtual:md-content/blog/my-guide'
```

---

## 🛡️ Error Handling & Fallback Behavior Clarified

| Scenario | What Happens | Result for Host App |
| --- | --- | --- |
| **Single post requested, does not exist** | `getDocBySlug` / `getNextDocBySlug` returns `null` | **Fastify**: returns `404 Not Found`.<br>**Next.js**: triggers `notFound()`. |
| **WordPress is DOWN** (default `onWordPressError: 'fallback'`) | Logs a warning, queries local Markdown files | If the post is local, returns 200.<br>If the post was only in WP (doesn't exist locally), returns `null` (**404 Not Found**). Never invents or serves wrong files. |
| **WordPress is DOWN** (`onWordPressError: 'throw'`) | Re-throws the WordPress network error | Host app catches error in error boundary or returns **503 Service Unavailable**. |
| **Redis is DOWN** | Logs a warning, bypasses Redis | Transparently reads from L1 LRU or data source without failing the request. |
| **Webhook secret invalid** | Returns `401 Unauthorized` | Prevents unauthorized cache tampering. |

---

---

## 🗺️ Sitemap & Dynamic SEO Engine (`/seo`)

`@crispice/universal-content` includes a full-featured Sitemap 0.9 + Google Image XML generator, parser, and merger designed specifically for apps with dynamic SEO routes (like product catalogs, user profiles, category landing pages, or multi-tenant portals).

### 1. Fastify Monorepo (`GET /sitemap.xml` with Host App Hook)

In Fastify, simply enable the sitemap route. You can hook directly into your database or business logic to inject dynamic URLs (e.g. database products, category landing pages):

```ts
await app.register(contentPlugin, {
  contentDir: './content',
  baseUrl: 'https://yourdomain.com',

  // Enable dynamic sitemap route at /sitemap.xml
  enableSitemap: true,
  sitemapPath: '/sitemap.xml',

  // Dynamic hook: Host app injects custom catalog & platform routes!
  customSitemapEntries: async (fastify) => {
    // Example: fetch active products & categories from your DB/ORM
    return [
      {
        loc: 'https://yourdomain.com/products',
        lastmod: '2026-10-18',
        changefreq: 'daily',
        priority: 0.9,
      },
      {
        loc: 'https://yourdomain.com/categories',
        lastmod: '2026-10-18',
        changefreq: 'weekly',
        priority: 0.8,
      },
    ]
  },
})

// Now GET /sitemap.xml returns a merged, cached, standards-compliant XML sitemap!
```

### 2. Next.js App Router (`app/sitemap.xml/route.ts` or `app/sitemap.ts`)

```ts
// app/sitemap.xml/route.ts
import { createSitemapRouteHandler } from '@crispice/universal-content/next'
import path from 'node:path'

export const GET = createSitemapRouteHandler(
  { contentDir: path.join(process.cwd(), 'content') },
  {
    baseUrl: 'https://yourdomain.com',
    // Inject dynamic catalog & service pages
    customEntries: async () => [
      { loc: 'https://yourdomain.com/services', priority: 0.9 },
      { loc: 'https://yourdomain.com/contact', priority: 0.7 },
    ],
  },
)
```

### 3. XML Loader & Processor (Parsing & Merging Existing Sitemaps)

If your host app already has an existing static XML sitemap (or pulls one from an external service), you can load, parse, and merge content URLs into it without overwriting:

```ts
import { parseSitemapXml, mergeSitemaps } from '@crispice/universal-content/seo'

// 1. Parse an existing XML sitemap into structured entries
const existingEntries = parseSitemapXml(existingXmlString)

// 2. Merge existing sitemap with new dynamic entries (deduplicates by loc URL)
const updatedXml = mergeSitemaps(existingXmlString, [
  { loc: 'https://yourdomain.com/products/featured-collection', priority: 0.8 },
])
```

### 4. Rich Snippets: JSON-LD Structured Data & OpenGraph Meta Tags

```ts
import { getDocJsonLd, getDocMetaTags } from '@crispice/universal-content/seo'

// Generates Schema.org/BlogPosting or Article JSON-LD for Google Rich Results
const jsonLd = getDocJsonLd(post, {
  baseUrl: 'https://yourdomain.com',
  siteName: 'MURAGEH',
})

// Generates canonical URL, OpenGraph (og:title, og:image), and Twitter Card meta tags
const metaTags = getDocMetaTags(post, {
  baseUrl: 'https://yourdomain.com',
  siteName: 'MURAGEH',
})
```

## 🧪 Interactive SEO & Sitemap Playground

A complete, runnable reference implementation demonstrating host application sitemap integration, two-tier Redis caching, and dynamic Schema.org SEO is available under [examples/playground/](./examples/playground):

- **Live Demonstration**: [https://playground.murageh.co.ke](https://playground.murageh.co.ke)
- **Fastify v5 + Prisma Database Integration**: Shows the exact 3-line drop-in enhancement for host application sitemap routes.
- **HTTP 304 ETag Optimization**: Zero-payload crawler bandwidth savings.
- **Run locally**:
  ``bash
  cd examples/playground
  npm test
  npm run dev
  ``

## Author

**MURAGEH** ([murageh.co.ke](https://murageh.co.ke))

## License

MIT
