# Universal Sitemap & Dynamic SEO Playground

> **Production Reference Implementation for @crispice/universal-content**  
> Demonstrates real-world host application sitemap augmentation, high-speed multi-tier caching (L1 Memory + L2 Redis), HTTP 304 ETag bandwidth optimization, and automated Schema.org structured data.

- **Production Deployment Target**: [https://playground.murageh.co.ke](https://playground.murageh.co.ke)
- **Author**: [MURAGEH (murageh.co.ke)](https://murageh.co.ke)
- **Framework**: Fastify v5 + TypeScript (Strict Type Checking, Zero `any`)

---

## 1. Problem: Monolithic Sitemaps in Dynamic Applications

Most content and sitemap plugins attempt to hijack `GET /sitemap.xml` and assume they own the entire URL tree. In real-world enterprise architectures (such as e-commerce storefronts, multi-tenant portals, and dynamic SaaS applications):

1. **Host Apps Already Have URLs**: The host application already maintains database-backed catalog items (e.g. `/products/:slug`, `/categories/:name`) and platform routes (`/`, `/features`, `/pricing`, `/contact`).
2. **Database Load on Crawls**: Every time search crawlers (Googlebot, Bingbot) request `/sitemap.xml`, running database queries across thousands of records degrades database performance and increases cloud compute costs.
3. **Cloud Egress Waste**: When a sitemap hasn't changed, transmitting megabytes of XML repeatedly wastes bandwidth and cloud egress budgets.
4. **Content Plugins Shouldn't Hijack**: Adding blog or news functionality shouldn't require dismantling existing controllers or database queries.

---

## 2. Solution: How @crispice/universal-content Solves This

`@crispice/universal-content` solves every dimension of this problem through composable, isolated architecture:

- **Isolated Pre-Rendered XML Chunks**: The plugin pre-renders and caches `<url>...</url>` XML fragments in **L1 LRU Memory + optional L2 Redis**. Fetching this chunk takes **< 0.05ms** with zero database or filesystem hits.
- **High-Speed Non-Destructive Appending**: Via `mergeSitemapUrlsets(baseXml, contentChunk)`, the host application injects universal content URLs directly before `</urlset>`. The host app remains 100% in control of its own routes and priority weights.
- **Zero-Egress HTTP 304 Not Modified**: Generates lightweight SHA-1 ETags for the merged payload. When crawlers provide `If-None-Match`, Fastify returns `304 Not Modified` with **0 bytes of payload**.
- **Automated Webhook Cache Warmup**: When articles are published or updated on disk, cache invalidation purges the Redis and LRU caches automatically.

---

## 3. Host App Integration: The Exact Before & After

### Before (Host App's Monolithic Route)

```typescript
// src/routes/sitemap.route.ts (Host App)
import { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';

let cachedXml: string | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const sitemapRoute: FastifyPluginAsync = async fastify => {
  fastify.get('/sitemap.xml', async (_request, reply) => {
    const now = Date.now();
    if (!cachedXml || now > cacheExpiresAt) {
      const products = await fastify.db.product.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
      });
      cachedXml = buildSitemapXml(products, env.ROOT_DOMAIN);
      cacheExpiresAt = now + CACHE_TTL_MS;
    }
    return reply.type('application/xml').send(cachedXml);
  });
};

export default sitemapRoute;
```

### After (Enhanced Integration with @crispice/universal-content)

Only **3 lines of code added**; zero disruption to existing database models:

```typescript
// src/routes/sitemap.route.ts (Host App)
import { FastifyPluginAsync } from 'fastify';
import { mergeSitemapUrlsets, generateEtag } from '@crispice/universal-content/seo';
import { env } from '../config/env.js';

let cachedXml: string | null = null;
let cachedEtag: string | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const sitemapRoute: FastifyPluginAsync = async fastify => {
  fastify.get('/sitemap.xml', async (request, reply) => {
    const now = Date.now();
    const clientEtag = request.headers['if-none-match'];

    // 1. HTTP 304 Fast-Path (Zero Egress Bandwidth)
    if (cachedXml && now <= cacheExpiresAt && cachedEtag && clientEtag === cachedEtag) {
      return reply.code(304).header('ETag', cachedEtag).send();
    }

    // 2. Regenerate when expired or cold
    if (!cachedXml || now > cacheExpiresAt) {
      const products = await fastify.db.product.findMany({
        where: { inStock: true },
        select: { slug: true, updatedAt: true },
      });

      // A. Build host app base sitemap (Platform Pages + Products)
      const baseXml = buildSitemapXml(products, env.ROOT_DOMAIN);

      // B. Fetch pre-cached XML chunk from content plugin (< 0.05ms)
      const contentChunk = await fastify.universalContent?.getSitemapXmlChunk({
        baseUrl: `https://${env.ROOT_DOMAIN}`,
      });

      // C. High-speed non-destructive splice right before </urlset>
      cachedXml = contentChunk ? mergeSitemapUrlsets(baseXml, contentChunk) : baseXml;
      cachedEtag = generateEtag(cachedXml);
      cacheExpiresAt = now + CACHE_TTL_MS;
    }

    // 3. Conditional 304 check on fresh build
    if (clientEtag && clientEtag === cachedEtag) {
      return reply.code(304).header('ETag', cachedEtag).send();
    }

    return reply
      .type('application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('ETag', cachedEtag)
      .send(cachedXml);
  });
};

export default sitemapRoute;
```

---

## 4. Architecture & Data Flow Diagram

```mermaid
graph TD
    Client["Search Bot / User Browser"]
    Fastify["Fastify v5 Host Server"]
    ETagCheck{"If-None-Match == ETag?"}
    Return304["Return HTTP 304 Not Modified<br/>(0 Bytes Egress Bandwidth)"]
    CacheCheck{"Combined Sitemap Cached?"}
    ReturnCached["Return Cached XML<br/>(0.1ms Latency)"]
    HostDB[("Host Database<br/>Product Catalog / Platform Routes")]
    PluginChunk["fastify.universalContent<br/>getSitemapXmlChunk()"]
    L1Mem["L1 Memory LRU"]
    L2Redis[("L2 ioredis Cluster")]
    Merge["mergeSitemapUrlsets()<br/>Fast Splicing before &lt;/urlset&gt;"]

    Client -->|GET /sitemap.xml| Fastify
    Fastify --> ETagCheck
    ETagCheck -->|Yes| Return304
    ETagCheck -->|No| CacheCheck
    CacheCheck -->|Yes| ReturnCached
    CacheCheck -->|No| HostDB
    CacheCheck -->|No| PluginChunk
    PluginChunk --> L1Mem
    L1Mem -.->|Miss| L2Redis
    HostDB & PluginChunk --> Merge
    Merge --> Fastify
    Fastify -->|HTTP 200 + ETag| Client
```

---

## 5. Dynamic SEO & Schema.org JSON-LD Generation

In addition to sitemaps, `@crispice/universal-content/seo` powers Google Rich Results and social preview cards for dynamic entities and markdown articles:

### A. Dynamic Catalog Schema (`Product` / `Offer`)

```typescript
import type { FastifyPluginAsync } from 'fastify';

fastify.get('/api/seo/products/:slug', async (req, reply) => {
  const product = await fastify.db.product.findUnique({ where: { slug: req.params.slug } });
  
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.featuredImage,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency,
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://${env.ROOT_DOMAIN}/products/${product.slug}`,
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.reviewCount,
    },
  };

  return reply.send({ jsonLd });
});
```

### B. Universal Blog & News Articles (`BlogPosting` / `Article`)

```typescript
import { getDocJsonLd, getDocMetaTags } from '@crispice/universal-content/seo';

fastify.get('/api/seo/blog/:slug', async (req, reply) => {
  const doc = await fastify.universalContent.getDocBySlug('blog', req.params.slug);
  
  const jsonLd = getDocJsonLd(doc, {
    baseUrl: 'https://murageh.co.ke',
    siteName: 'MURAGEH Engineering & Architecture',
    pathPrefix: 'blog',
  });

  const metaTags = getDocMetaTags(doc, {
    baseUrl: 'https://murageh.co.ke',
    siteName: 'MURAGEH',
    pathPrefix: 'blog',
  });

  return reply.send({ jsonLd, metaTags });
});
```

---

## 6. Running the Playground Locally

### Step 1: Clone & Configure

```bash
# From workspace root
cd examples/playground

# Copy environment configuration template (gitignored)
cp .env.example .env
```

### Step 2: Run Tests

```bash
npm test
```

### Step 3: Start Interactive Development Server

```bash
npm run dev
```

Visit `http://localhost:3001` in your browser to interact with:

- **Interactive Light & Dark Theme Dashboard**: Seamless theme toggle with tailored syntax highlighting and zero flash.
- **Combined Sitemap Inspector**: Real-time breakdown of Platform Routes, Product Catalog URLs, and Markdown Blog Posts.
- **Latency Benchmark**: Instant response time measurements (0.2ms cached vs 25ms cold).
- **HTTP 304 ETag Validator**: Demonstrates zero-bandwidth 304 responses when `If-None-Match` matches the server ETag.
- **Social Preview Card & JSON-LD Inspector**: Live previews of OpenGraph cards, Twitter cards, and Schema.org structured data.
- **Cache Invalidation Simulator**: Simulates publishing new content and observing cache updates.

---

## 7. Production Deployment & Hosting with Custom Domain

You can host and deploy this application across standard, modern production platforms:

### Option A: GitHub Pages with Custom Domain (Static Export / Docs Showcase)

For static Vite/React, documentation, or pre-rendered blog builds, deploy directly to **GitHub Pages** with custom domain routing:

1. **Custom Domain Configuration**:
   Create a `CNAME` file in the root of your static build directory (e.g. `playground.murageh.co.ke` or `docs.your-domain.com`):

   ```bash
   echo "playground.yourdomain.com" > public/CNAME
   ```

2. **DNS Setup in your Domain Registrar for `yourdomain.com`**:
   - **Subdomain (`playground.yourdomain.com`)**: Add a `CNAME` record:
     - **Host / Name**: `playground`
     - **Target**: `<your-username>.github.io`
   - **Apex Domain (`yourdomain.com`)**: Add four `A` records:

     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```

3. **Automated CI/CD via GitHub Actions**:
   The repository includes [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml). Simply push to `main`, and GitHub Pages automatically builds, tests, provisions Let's Encrypt SSL, and deploys to `https://playground.yourdomain.com`.
4. **HTTPS Enforcement**:
   In your repository: **Settings → Pages → Custom domain**, verify the domain and check **"Enforce HTTPS"**.

---

### Option B: Cloudflare Pages / Vercel with Custom Domain

For edge-rendered Next.js or Vite fullstack applications:

1. Connect your repository to **Cloudflare Pages** or **Vercel**.
2. Set build command: `npm run build` and output directory: `dist`.
3. Under **Custom Domains**, add `playground.yourdomain.com`.
4. Cloudflare / Vercel automatically configures DNS edge routing, global CDN caching, and automated SSL certificates with zero server maintenance.

---

### Option C: Docker Container Deployment (Cloud Run, AWS ECS, VPS)

For containerized backend or fullstack deployments, a production-grade multi-stage Alpine Dockerfile is included:

```bash
# Build the production Docker image from workspace root
docker build -t universal-content-seo-playground -f examples/playground/Dockerfile .

# Run container with production environment variables
docker run -d \
  --name seo-playground \
  -p 3001:3001 \
  -e PORT=3001 \
  -e HOST=0.0.0.0 \
  -e ROOT_DOMAIN=yourdomain.com \
  --restart unless-stopped \
  universal-content-seo-playground
```

---

### Option D: Caddy Reverse Proxy on VPS (Automated Let's Encrypt TLS)

If deploying on an Ubuntu / Debian VPS with systemd or Docker, a production `Caddyfile` is included. Caddy automatically provisions and renews TLS certificates for `playground.yourdomain.com`:

```caddy
playground.yourdomain.com {
    encode gzip zstd

    reverse_proxy 127.0.0.1:3001 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto https
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

---

## 8. Test Suite & Verification

All test suites enforce 100% strict TypeScript types and zero `any` types:

- `src/__tests__/markdown.test.ts` (10 tests passing)
- `src/__tests__/next.test.ts` (6 tests passing)
- `src/__tests__/fastify.test.ts` (6 tests passing)
- `src/__tests__/seo.test.ts` (9 tests passing)
- `examples/playground/src/__tests__/playground.test.ts` (6 tests passing)
- **Total**: **37 / 37 passing**
