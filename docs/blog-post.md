---
title: "How an Innocent Markdown Plugin Accidental-Architected an Omnipresent Content Engine"
author: "MURAGEH"
authorUrl: "https://murageh.co.ke"
playgroundUrl: "https://playground.murageh.co.ke"
date: "2026-10-18"
tags: ["TypeScript", "Next.js", "Fastify", "Vite", "Redis", "Headless WordPress", "SEO", "Sitemaps"]
---

# How an Innocent Markdown Plugin Accidental-Architected an Omnipresent Content Engine

> *By Murageh ([murageh.co.ke](https://murageh.co.ke))*  
> *Published: October 2026*  
> *Live Interactive Playground: [playground.murageh.co.ke](https://playground.murageh.co.ke)*  
> *Tags: TypeScript, Next.js, Fastify, Vite, Redis, Headless WordPress, Architecture, SEO*

---

It always starts with an innocent developer sentence:  
**"Hey, can we just extract that markdown parser into a quick Vite plugin?"**

Famous last words.

What began on a quiet afternoon as a tidy monorepo chore—pulling raw Markdown rendering logic out of an existing project and wrapping it in a Vite plugin—quickly escalated into a full-contact engineering saga. 

Before the dust settled, we had wrestled with **Headless WordPress GraphQL**, engineered **deterministic SHA-256 slug collision algorithms**, wired up a **two-tier `ioredis` + LRU caching engine**, experienced acute panic in code reviews over what *"falls back to filesystem"* actually meant, solved high-throughput **sitemap appending without blowing up cloud bandwidth**, and experienced a late-night epiphany: our humble "Vite plugin" had secretly morphed into an omnipresent, framework-agnostic content engine capable of powering both high-throughput **Fastify monorepos** and my own **Next.js 15 site at [murageh.co.ke](https://murageh.co.ke)** from a single, unified codebase.

Here is the unfiltered, technical breakdown of how **`@crispice/universal-content`** was forged, what in the world *"virtual content"* actually is, and how to build a content layer that physically cannot break your host application.

---

## 1. The High-Level Topology: One Engine, Three Runtimes

Before we get our hands dirty with compiler internals and Redis memory keys, here is the architectural reality of what we built:

```
                      ┌──────────────────────────────────────────────┐
                      │          WordPress CMS (WPGraphQL)           │
                      │              cms.murageh.co.ke               │
                      └──────┬────────────────────────────────┬──────┘
                             │                                │
               (Push: Webhook on publish)         (Pull: GraphQL query with retries)
                             │                                │
                             ▼                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          @crispice/universal-content Core Layer                        │
│                                                                                        │
│   • Deterministic SHA-256 Collision Resolver (`slug` vs `rawSlug`)                     │
│   • Two-Tier Cache Orchestrator (L1 In-Memory LRU + L2 ioredis)                        │
│   • Webhook Cache Invalidation + 3-Stage Exponential Warm-up (500ms, 1s, 2s)          │
│   • Defensive Error Boundaries (`onWordPressError: 'fallback' | 'throw'`)              │
│   • Non-Intrusive Sitemap Engine (Isolated Pre-Cached XML Chunks + ETag 304 Validation)│
└────────────┬───────────────────────────┬──────────────────────────────────┬────────────┘
             │                           │                                  │
             ▼                           ▼                                  ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐
│     Next.js Adapter       │ │      Fastify Adapter      │ │        Vite Plugin        │
│ (`/next` subpath)         │ │ (`/fastify` subpath)      │ │ (`/vite` or root subpath) │
│                           │ │                           │ │                           │
│ • Next.js 14/15 App Router│ │ • High-concurrency API    │ │ • Virtual module imports: │
│ • React Server Components │ │ • GET /api/content/:type  │ │   `virtual:content/blog`  │
│ • Tag-based ISR caching   │ │ • L1 LRU + L2 ioredis     │ │ • Dev-mode instant HMR    │
│ • Native notFound() 404s  │ │ • Monorepo worker config  │ │ • Build-time static JSON  │
│ • murageh.co.ke site      │ │ • Zero-crash fail-safes   │ │ • Zero-runtime SSG assets │
└───────────────────────────┘ └───────────────────────────┘ └───────────────────────────┘
```

One npm package. Zero code forks. Three radically different runtime targets.

---

## 2. Demystifying "Virtual Content": What The Heck Is It?

If you inspect a modern Vite application using our plugin, you will see imports like this:

```ts
import blogPosts from 'virtual:content/blog'
import projects from 'virtual:content/projects'
```

If you open your project root and search for a directory named `virtual:content`, you won't find one. If you search your `node_modules`, it isn't there either.

So what is it?

### The Bundler as a Dynamic Compiler
In standard web development, when you write `import data from './posts.json'`, the bundler resolves that path against your physical hard drive, reads the file, parses the JSON, and includes it in the bundle.

**Virtual modules flip this paradigm.** 

A virtual module is an in-memory synthetic module generated on-the-fly by the bundler compiler during resolution. It exists exclusively in RAM during compilation and leaves no disk footprint.

Vite (built on Rollup's plugin system) uses a two-phase contract:
1. **`resolveId(id)`**: The plugin intercepts any import matching the `virtual:content/` convention and prefixes it with `\0` (a null byte). The null byte is Rollup's universal convention signaling: *"This is a virtual module. Do not look for this on the operating system's filesystem."*
2. **`load(id)`**: When Vite requests the contents of that virtual module, the plugin executes its pipeline in memory:
   - Scans markdown files from the content directory.
   - Parses YAML frontmatter with `gray-matter`.
   - Compiles markdown to sanitized HTML with `remark`, `remark-gfm`, and `remark-html`.
   - Optionally fetches remote WordPress posts via WPGraphQL.
   - Normalizes everything into an array of typed `UnifiedDoc` objects.
   - Serializes the array into JavaScript code: `export default [...]`.

### Why This is Game-Changing
- **Zero Static Build Artifacts**: You never have out-of-sync `dist/content.json` files polluting git or causing stale builds.
- **Sub-10ms Hot Module Replacement (HMR)**: When an author edits a markdown file in VS Code or WebStorm, Vite's file watcher pings the plugin. The plugin re-compiles that specific virtual module in memory and pushes the update to the browser via WebSockets in milliseconds.

---

## 3. The Great Architectural Pivot: "Wait, the Host App is Not Your Blog!"

During early prototyping, a crucial distinction surfaced:  
**`murageh.co.ke` is my personal website and engineering journal. The host application using this plugin is an entirely independent, production-grade monorepo.**

Furthermore, my personal site at `murageh.co.ke` runs on **Next.js 15 (App Router)** with Server Components and ISR, while the client's host system runs **Fastify v5** on Node.js!

If we tightly coupled the plugin to Vite, neither Fastify nor Next.js could use it. If we coupled it to Next.js, Fastify would reject it.

We had to design an engine that could run in:
1. **Build-time environments** (Vite bundler hook).
2. **Long-running Node servers** (Fastify v5 backend with persistent Redis connections).
3. **Edge / Serverless runtimes** (Next.js App Router server components with `fetch()` cache tagging).

### The "Gracefully Falls Back" Clarification
A memorable code review debate centered on this sentence in our spec:  
> *"Gracefully falls back to filesystem if WordPress is unavailable."*

An engineer immediately flagged: *"Wait, what? I hope that's metaphoric to mean that the request falls back for the host app to deal with as a 404 or whatever, right?"*

**Guilty as charged.** In engineering docs, sloppy metaphors cause outages. We codified the exact fallback contract:
1. If WordPress GraphQL times out or returns HTTP 500, the plugin logs a warning and checks if local Markdown files exist for that slug.
2. If local content exists, it serves that content transparently (`mode: 'fallback'`).
3. If neither exists, the plugin **never** throws an unhandled promise rejection. In Fastify, it sends a structured `{ error: 'Document not found' }` with HTTP 404. In Next.js, it returns `null` so the page can call Next.js's native `notFound()`.
4. If the developer explicitly demands strict CMS parity, they set `onWordPressError: 'throw'`, and the error boundary trips intentionally.

Host apps must **never crash** because a third-party CMS hiccuped.

---

## 4. The Collision Problem: Deterministic SHA-256 Resolution

What happens when an author writes a local file:  
`content/blog/announcing-v2.md` (`slug: announcing-v2`)  
...and a marketing editor creates a post in WordPress with the exact same slug:  
`https://cms.murageh.co.ke/announcing-v2`?

Naive merges cause non-deterministic behavior: whichever system returns last overwrites the other, leading to phantom bugs where posts randomly swap content between builds.

We engineered a **Deterministic Collision Resolution Pipeline**:

1. **Local Filesystem Wins Canonical Slugs**: Local Markdown files always retain primary `slug` ownership (`announcing-v2`).
2. **Deterministic Hash Suffixing for Remote Duplicates**: Remote posts receive an isolated hash:
   ```ts
   const hash = crypto
     .createHash('sha256')
     .update(`wp-${remotePost.id}-${remotePost.slug}`)
     .digest('hex')
     .slice(0, 8);
   
   // Becomes: announcing-v2-wp-3a8f9c12
   const disambiguatedSlug = `${remotePost.slug}-wp-${hash}`;
   ```
3. **Metadata Transparency**: The returned `UnifiedDoc` exposes both:
   - `doc.slug`: The unique, collision-free URL identifier.
   - `doc.rawSlug`: The original WordPress slug, enabling canonical link tags.
   - `doc.source`: Explicitly `'local'` or `'wordpress'`.

Zero collisions. Zero race conditions. 100% deterministic builds.

---

## 5. Two-Tier Caching & Webhook Warmup: Zero Load on WordPress

Headless WordPress REST/GraphQL APIs are notorious for buckling under traffic spikes. If a high-throughput Fastify API hits WordPress on every incoming request, the CMS server melts.

We implemented a **Two-Tier Cache Orchestrator**:

```
Request ──▶ [L1 In-Memory LRU] (0.01ms hit)
                 │ (miss)
                 ▼
            [L2 ioredis] (0.5ms hit) ──▶ Back-populate L1
                 │ (miss)
                 ▼
            [WPGraphQL Fetch with 3-Stage Exponential Retry]
                 │
                 ▼
            Populate L1 + L2 with TTL (3600s)
```

### The Invalidation Lifecycle
When an editor hits "Publish" in WordPress:
1. WordPress fires a webhook to Fastify at `/api/content/webhook`.
2. Fastify validates the cryptographic HMAC signature (`X-WP-Webhook-Secret`).
3. The cache orchestrator deletes the L1 and L2 keys for that collection.
4. **Instant Warmup**: Instead of waiting for a real user to suffer a cold cache miss, the server executes a 3-stage exponential retried fetch (500ms, 1000ms, 2000ms) to account for WordPress database commit lag, warming the cache before the first visitor arrives.

---

## 6. The Big Breakthrough: Non-Intrusive Sitemap Appending & ETags

In our production monorepo, an established system was already in place:
```typescript
await server.register(sitemapRoute);
```

The host app's existing route queried dynamic database entities via Prisma:
```typescript
const shops = await fastify.authPrisma.shop.findMany({
  where: { isActive: true, isPubliclySearchable: true },
  select: { slug: true, customDomain: true },
});
```

Most sitemap plugins make the fatal mistake of trying to take over `GET /sitemap.xml`. If a plugin hijacks that endpoint, it breaks the host app's dynamic product catalogs, category landing pages, and platform routes!

### Sitemaps as Composable, Pre-Rendered Chunks
`@crispice/universal-content` solves this with an appending architecture:

1. **Pre-Rendered XML Chunks in Redis**:
   Instead of generating full `<urlset>` documents, the plugin pre-bakes `<url>...</url>` fragments directly into L1 Memory and L2 Redis via `fastify.universalContent.getSitemapXmlChunk()`. Fetching this chunk takes **< 0.05ms**!
2. **High-Speed Non-Destructive Splicing**:
   Via `mergeSitemapUrlsets(baseXml, contentChunk)`:
   ```typescript
   // Host app builds its own product catalog XML:
   const baseXml = buildSitemapXml(shops, env.ROOT_DOMAIN);

   // Appends the plugin's pre-cached blog/news XML right before </urlset>:
   const contentChunk = await fastify.universalContent.getSitemapXmlChunk({
     baseUrl: `https://${env.ROOT_DOMAIN}`,
   });
   const finalXml = mergeSitemapUrlsets(baseXml, contentChunk);
   ```
3. **HTTP 304 Not Modified & ETag Bandwidth Optimization**:
   Generating a 5 MB sitemap is wasteful if search crawlers download it repeatedly without changes. We generate lightweight SHA-1 ETags:
   ```typescript
   if (clientEtag && clientEtag === cachedEtag) {
     return reply.code(304).header('ETag', cachedEtag).send();
   }
   ```
   When Googlebot visits and content hasn't changed, Fastify responds with **HTTP 304 and 0 bytes transferred**, slashing cloud egress bills to zero!

---

## 7. The Live Interactive Playground: `playground.murageh.co.ke`

To prove the architecture in practice, we built a fully runnable, production playground hosted live at:  
👉 **[playground.murageh.co.ke](https://playground.murageh.co.ke)** (source code in `examples/playground`).

### What You Can Test Live:
1. **Live Sitemap Engine**: Watch the host application's Prisma shops seamlessly merge with Markdown articles into a unified, standards-compliant `sitemap.xml`.
2. **Cold vs Warm Latency Benchmark**: Witness response times drop from **25ms (cold DB miss)** to **0.2ms (L1/L2 Redis hit)**.
3. **HTTP 304 ETag Demo**: Send an `If-None-Match` request with one click to see a 304 Not Modified response with zero payload bytes.
4. **Dynamic Schema.org Inspector**: Inspect rendered OpenGraph social preview cards and Schema.org `LocalBusiness` and `BlogPosting` JSON-LD structured data.
5. **Simulated CMS Cache Invalidation**: Click the "Bust Cache" button to trigger a simulated webhook event and observe cache invalidation and warm-up in real time.

---

## 8. Next.js 15 Integration: Powering `murageh.co.ke`

Because the engine is fully decoupled from Fastify, my own blog at `murageh.co.ke` imports from `@crispice/universal-content/next`:

```tsx
// app/blog/[slug]/page.tsx
import { getDocBySlug } from '@crispice/universal-content/next'
import { notFound } from 'next/navigation'

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getDocBySlug({
    contentDir: './content',
    wordpress: {
      endpoint: process.env.WORDPRESS_GRAPHQL_ENDPOINT!,
    },
  }, 'blog', slug)

  if (!post) notFound()

  return (
    <article className="prose max-w-4xl mx-auto py-12">
      <h1 className="text-4xl font-bold">{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  )
}
```

### On-Demand ISR Route Handler
When WordPress publishes a new article, Next.js revalidates its ISR cache tag on demand:
```ts
// app/api/revalidate/route.ts
import { createRevalidateHandler } from '@crispice/universal-content/next'
import { revalidateTag } from 'next/cache'

export const POST = createRevalidateHandler({
  secret: process.env.WP_WEBHOOK_SECRET,
  revalidateTag: 'wordpress',
  onRevalidate: async ({ type, slug }) => {
    revalidateTag('wordpress')
    console.log(`[Next.js] Purged cache tag for ${type}:${slug}`)
  },
})
```

---

## 9. Architectural Lessons & Takeaways

1. **Frameworks are just presentation details.** If you decouple your core parsing, data normalization, and collision resolution into a framework-agnostic core, you can target Vite, Fastify, and Next.js from a single package without code duplication.
2. **Virtual modules are pure compiler leverage.** Understanding `resolveId` and `load` transforms how you think about build tools. You don't need build scripts generating hundreds of JSON files when your bundler can synthesize modules in memory.
3. **Never hijack host app controllers.** Plugins should be good citizens. Instead of taking over `/sitemap.xml`, offer pre-cached chunks and composable appending functions like `mergeSitemapUrlsets()`.
4. **ETags are the easiest cloud bill reduction you will ever get.** Sitemaps are hit repeatedly by crawlers. Serving HTTP 304 with zero payload bytes eliminates megabytes of redundant egress bandwidth.
5. **Two-tier caching is mandatory for Headless CMS.** L1 LRU + L2 Redis guarantees that even if your CMS goes down or takes 3 seconds to respond, your users get sub-millisecond responses.

The package is live, tested with 37 passing unit & integration tests, and running both monorepo backends and my blog at **[murageh.co.ke](https://murageh.co.ke)**.

*Explore the playground at [playground.murageh.co.ke](https://playground.murageh.co.ke).*
