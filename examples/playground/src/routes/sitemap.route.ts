/**
 * src/routes/sitemap.route.ts
 *
 * Production-ready Fastify route demonstrating how a host application
 * merges its existing dynamic database records (e.g. Products, Profiles, Catalog items)
 * and static platform pages with @crispice/universal-content routes.
 *
 * Optimizations Included:
 *   1. Two-Tier Caching (L1 Memory LRU + L2 Redis via universalContent).
 *   2. Non-blocking string chunk injection (mergeSitemapUrlsets).
 *   3. HTTP ETag generation & 304 Not Modified verification (Zero egress bandwidth).
 *   4. Agnostic naming: Platform Pages + Dynamic Catalog Products + Blog Content.
 */

import type { FastifyPluginAsync } from 'fastify';
import { mergeSitemapUrlsets, generateEtag } from '@crispice/universal-content/seo';
import type { MockDatabase } from '../mock-db.js';

// FastifyInstance augmented in mock-db.ts

export interface EntitySlug {
  slug: string;
}

export interface SitemapMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  etagHits304: number;
  lastGeneratedAt: string | null;
  lastLatencyMs: number;
  cachedEtag: string | null;
  xmlSizeBytes: number;
  totalUrlCount: number;
}

export const sitemapMetrics: SitemapMetrics = {
  totalRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  etagHits304: 0,
  lastGeneratedAt: null,
  lastLatencyMs: 0,
  cachedEtag: null,
  xmlSizeBytes: 0,
  totalUrlCount: 0,
};

let cachedXml: string | null = null;
let cachedEtag: string | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Pure function — builds sitemap XML for core platform and dynamic database routes.
 */
export function buildSitemapXml(items: EntitySlug[], rootDomain: string): string {
  const platformUrls = [
    `https://${rootDomain}/`,
    `https://${rootDomain}/features`,
    `https://${rootDomain}/pricing`,
    `https://${rootDomain}/catalog`,
    `https://${rootDomain}/docs`,
    `https://${rootDomain}/contact`,
  ];

  const itemUrls = items.map((item) => `https://${rootDomain}/products/${item.slug}`);

  const locs = [...platformUrls, ...itemUrls].map((u) => `  <url><loc>${u}</loc></url>`).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    locs,
    '</urlset>',
  ].join('\n');
}

/**
 * Invalidation hook allowing external triggers (e.g. database change or CMS publish)
 * to bust the combined sitemap cache.
 */
export function invalidateCombinedSitemap(): void {
  cachedXml = null;
  cachedEtag = null;
  cacheExpiresAt = 0;
  sitemapMetrics.cachedEtag = null;
}

const sitemapRoute: FastifyPluginAsync<{ rootDomain?: string }> = async (fastify, opts) => {
  const rootDomain = opts.rootDomain ?? process.env.ROOT_DOMAIN ?? 'murageh.co.ke';

  fastify.get('/sitemap.xml', async (request, reply) => {
    const startTime = performance.now();
    sitemapMetrics.totalRequests++;

    const clientEtag = request.headers['if-none-match'];

    // 1. Fast-path: Check HTTP 304 conditional request if ETag is still fresh
    const now = Date.now();
    const isCacheFresh = cachedXml !== null && now <= cacheExpiresAt;

    if (isCacheFresh && cachedEtag && clientEtag === cachedEtag) {
      sitemapMetrics.etagHits304++;
      sitemapMetrics.lastLatencyMs = Number((performance.now() - startTime).toFixed(3));
      return reply
        .code(304)
        .header('ETag', cachedEtag)
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Expose-Headers', 'ETag, X-Cache-Status, X-Response-Time-Ms')
        .header('X-Cache-Status', 'HIT (304)')
        .send();
    }

    // 2. Cache Miss or Expired: Regenerate merged sitemap
    if (!isCacheFresh) {
      sitemapMetrics.cacheMisses++;

      // A. Query dynamic database entities (products, catalog items, etc.)
      const dbClient = fastify.db ?? fastify.authPrisma;
      const products = dbClient
        ? await dbClient.product.findMany({
            where: { inStock: true, isPubliclySearchable: true },
            select: { slug: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];

      // B. Build host application base XML
      const baseXml = buildSitemapXml(products, rootDomain);

      // C. Retrieve pre-cached XML chunk from @crispice/universal-content (< 0.05ms)
      let finalXml = baseXml;
      if (fastify.universalContent) {
        const contentChunk = await fastify.universalContent.getSitemapXmlChunk({
          baseUrl: `https://${rootDomain}`,
        });

        // D. Non-destructive, high-speed injection right before </urlset>
        finalXml = mergeSitemapUrlsets(baseXml, contentChunk);
      }

      cachedXml = finalXml;
      cachedEtag = generateEtag(cachedXml);
      cacheExpiresAt = now + CACHE_TTL_MS;

      // Update metrics
      sitemapMetrics.lastGeneratedAt = new Date().toISOString();
      sitemapMetrics.cachedEtag = cachedEtag;
      sitemapMetrics.xmlSizeBytes = Buffer.byteLength(cachedXml, 'utf8');
      sitemapMetrics.totalUrlCount = (cachedXml.match(/<loc>/g) || []).length;
    } else {
      sitemapMetrics.cacheHits++;
    }

    sitemapMetrics.lastLatencyMs = Number((performance.now() - startTime).toFixed(3));

    // 3. ETag check for conditional requests
    if (clientEtag && clientEtag === cachedEtag) {
      sitemapMetrics.etagHits304++;
      return reply
        .code(304)
        .header('ETag', cachedEtag)
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Expose-Headers', 'ETag, X-Cache-Status, X-Response-Time-Ms')
        .header('X-Cache-Status', 'HIT (304)')
        .send();
    }

    // 4. Send full XML with ETag and Cache-Control
    return reply
      .type('application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('ETag', cachedEtag)
      .header('Access-Control-Expose-Headers', 'ETag, X-Cache-Status, X-Response-Time-Ms')
      .header('X-Response-Time-Ms', sitemapMetrics.lastLatencyMs.toString())
      .header('X-Cache-Status', isCacheFresh ? 'HIT' : 'MISS')
      .send(cachedXml);
  });
};

export default sitemapRoute;
