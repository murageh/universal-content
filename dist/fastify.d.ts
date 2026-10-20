import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { G as GetSitemapOptions, S as SitemapEntry, C as ContentLayerOptions } from './seo-C5K__9vN.js';
export { g as generateEtag, a as generateSitemapXml, b as getAllDocs, c as getDocBySlug, d as getDocJsonLd, e as getDocMetaTags, f as getSitemapEntries, h as getSitemapXmlChunk, m as mergeSitemapUrlsets, i as mergeSitemaps, p as parseSitemapXml } from './seo-C5K__9vN.js';
import { ContentType, UnifiedDoc, RedisClientOrOptions } from './index.js';
export { f as formatDate } from './markdown-DducjcBA.js';
import 'ioredis';

/**
 * src/fastify.ts
 *
 * Fastify v5 plugin & adapter for @crispice/universal-content.
 * Tailored for high-throughput monorepo backends and APIs.
 * Author: MURAGEH (murageh.co.ke).
 *
 * Features:
 *   - Two-tier caching: L1 (in-process LRU) + L2 (ioredis for persistence).
 *   - fastify.universalContent decoration for seamless host app integration.
 *   - getSitemapXmlChunk: Pre-cached XML chunk generator to append into existing sitemaps.
 *   - Webhook route with 3-stage exponential retried cache warmup.
 *   - Optional standalone sitemap.xml route (`enableSitemap: true`).
 *   - Graceful degradation: all Redis & WP errors handled; host app never crashes.
 */

declare module 'fastify' {
    interface FastifyInstance {
        universalContent: {
            getAllDocs: (type: ContentType) => Promise<UnifiedDoc[]>;
            getDocBySlug: (type: ContentType, slug: string) => Promise<UnifiedDoc | null>;
            getSitemapEntries: (options?: GetSitemapOptions) => Promise<SitemapEntry[]>;
            getSitemapXmlChunk: (options?: GetSitemapOptions) => Promise<string>;
            invalidateCache: (type: ContentType, slug?: string) => Promise<void>;
            invalidateSitemapCache: () => Promise<void>;
        };
    }
}
interface FastifyContentOptions extends ContentLayerOptions {
    /**
     * URL prefix for all content routes.
     * @default '/api/content'
     */
    prefix?: string;
    /**
     * Enable in-process LRU caching (L1).
     * @default true
     */
    cache?: boolean;
    /**
     * Maximum number of entries in the in-process LRU cache.
     * @default 200
     */
    cacheSize?: number;
    /**
     * Optional ioredis client instance, connection options, or connection URL.
     * When provided, Redis is used as the L2 persistent cache across restarts.
     * If omitted, can be auto-detected from `fastify.redis` if `@fastify/redis` is registered.
     */
    redis?: RedisClientOrOptions;
    /**
     * Time-to-live for Redis cache entries in seconds.
     * @default 3600 (1 hour)
     */
    redisTtl?: number;
    /**
     * Key prefix for Redis cache entries.
     * @default 'md-content'
     */
    redisKeyPrefix?: string;
    /**
     * Enable the WordPress publish webhook handler.
     * Defaults to true if `webhookSecret` is configured.
     * @default false
     */
    enableWebhook?: boolean;
    /**
     * Custom path for the webhook route.
     * @default `${prefix}/webhook`
     */
    webhookPath?: string;
    /**
     * Shared secret for authenticating WordPress publish webhooks.
     * Compared against header `X-WP-Webhook-Secret` or `X-Fastify-WP-Secret`.
     */
    webhookSecret?: string;
    /**
     * When a webhook arrives, re-fetch the collection with retries and warm the cache.
     * @default true
     */
    webhookWarmup?: boolean;
    /**
     * Enable the standalone sitemap.xml route.
     * If false (default), the plugin does NOT register `/sitemap.xml`, allowing the host app's
     * existing route to manage it while accessing `fastify.universalContent.getSitemapXmlChunk()`.
     * @default false
     */
    enableSitemap?: boolean;
    /**
     * Custom path for the standalone sitemap route.
     * @default '/sitemap.xml'
     */
    sitemapPath?: string;
    /**
     * Base URL of the website (e.g. 'https://murageh.co.ke').
     * Required for generating canonical sitemap URLs.
     */
    baseUrl?: string;
    /**
     * Dynamic hook allowing host app to inject additional custom URLs into the standalone sitemap.
     */
    customSitemapEntries?: (fastify: FastifyInstance) => Promise<SitemapEntry[]> | SitemapEntry[];
    /**
     * Additional options for sitemap generation (pathPrefixMap, defaultPriority, etc.).
     */
    sitemapOptions?: GetSitemapOptions;
}
declare const contentPlugin: FastifyPluginAsync<FastifyContentOptions>;

/**
 * Build-time helper: writes all collections to JSON files on disk.
 * Pre-renders content for static hosting in monorepos.
 *
 * @param contentDir - absolute path to the content root directory.
 * @param outputDir  - where to write the JSON files (default: <contentDir>/../_content).
 */
declare function buildStaticContent(contentDir: string, outputDir?: string): Promise<void>;

export { ContentLayerOptions, GetSitemapOptions, SitemapEntry, buildStaticContent, contentPlugin, contentPlugin as default };
export type { FastifyContentOptions };
