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

import path from 'node:path';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { getAllDocs, getDocBySlug, type ContentLayerOptions } from './content.js';
import type { ContentType, RedisClientOrOptions, UnifiedDoc } from './types.js';
import {
  getSitemapEntries,
  getSitemapXmlChunk,
  generateSitemapXml,
  mergeSitemapUrlsets,
  parseSitemapXml,
  mergeSitemaps,
  generateEtag,
  getDocJsonLd,
  getDocMetaTags,
  type SitemapEntry,
  type GetSitemapOptions,
  type SimpleCacheInterface,
} from './seo.js';

export type { ContentLayerOptions };
export {
  getSitemapEntries,
  getSitemapXmlChunk,
  generateSitemapXml,
  mergeSitemapUrlsets,
  parseSitemapXml,
  mergeSitemaps,
  generateEtag,
  getDocJsonLd,
  getDocMetaTags,
  type SitemapEntry,
  type GetSitemapOptions,
};

// -- Fastify Type Augmentation --

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

// -- Plugin options --

export interface FastifyContentOptions extends ContentLayerOptions {
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
  customSitemapEntries?: (
    fastify: FastifyInstance,
  ) => Promise<SitemapEntry[]> | SitemapEntry[];

  /**
   * Additional options for sitemap generation (pathPrefixMap, defaultPriority, etc.).
   */
  sitemapOptions?: GetSitemapOptions;
}

// -- Simple In-Process LRU Cache (L1) --

class LRUCache<K, V> {
  private readonly max: number;
  private map = new Map<K, V>();

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(key, value);
  }

  del(key: K): void {
    this.map.delete(key);
  }

  evictPrefix(prefix: string): void {
    for (const k of Array.from(this.map.keys())) {
      if (typeof k === 'string' && k.startsWith(prefix)) {
        this.map.delete(k);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

// -- Helpers --

const VALID_TYPES: ContentType[] = ['blog', 'news', 'projects'];

function mapWpPostType(rawType: string): ContentType {
  const normalized = rawType.toLowerCase().replace(/[-_]/g, '');
  if (normalized === 'post' || normalized === 'posts' || normalized === 'blog') {
    return 'blog';
  }
  if (normalized.includes('news')) {
    return 'news';
  }
  if (normalized.includes('project')) {
    return 'projects';
  }
  return 'blog';
}

type LoggerLike = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

async function scanAndDelPrefix(client: Redis, pattern: string): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
  } catch {
    // Ignore scan errors gracefully
  }
}

async function warmupWithRetries(
  logger: LoggerLike,
  opts: ContentLayerOptions,
  type: ContentType,
  l1: LRUCache<string, unknown> | null,
  redisClient: Redis | null,
  rKey: string,
  redisTtl: number,
): Promise<void> {
  const delays = [500, 1000, 2000];
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      const freshDocs = await getAllDocs(opts, type);
      if (freshDocs.length > 0) {
        l1?.set(`list:${type}`, freshDocs);
        if (redisClient) {
          try {
            await redisClient.set(rKey, JSON.stringify(freshDocs), 'EX', redisTtl);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`[md-content] Redis SET warmup error for ${type}: ${msg}`);
          }
        }
        logger.info(`[md-content] Webhook warmup succeeded for "${type}" (${freshDocs.length} docs cached).`);
        return;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[md-content] Webhook warmup attempt ${attempt + 1} failed for "${type}": ${msg}`);
    }
  }
  logger.warn(`[md-content] Webhook warmup exhausted retries for "${type}". Cache will populate on next request.`);
}

// -- Fastify plugin --

const contentPluginFn: FastifyPluginAsync<FastifyContentOptions> = async (
  fastify,
  opts,
) => {
  const prefix         = opts.prefix ?? '/api/content';
  const useL1          = opts.cache ?? true;
  const cacheSize      = opts.cacheSize ?? 200;
  const redisTtl       = opts.redisTtl ?? 3600;
  const redisKeyPrefix = opts.redisKeyPrefix ?? 'md-content';
  const isWebhookOn    = opts.enableWebhook ?? (opts.webhookSecret !== undefined);
  const webhookPath    = opts.webhookPath ?? `${prefix}/webhook`;
  const isSitemapOn    = opts.enableSitemap ?? false;
  const sitemapRoute   = opts.sitemapPath ?? '/sitemap.xml';

  const layerOpts: ContentLayerOptions = {
    contentDir: opts.contentDir,
    ...(opts.wordpress !== undefined ? { wordpress: opts.wordpress } : {}),
    ...(opts.onWordPressError !== undefined ? { onWordPressError: opts.onWordPressError } : {}),
  };

  // 1. Initialize L1 (In-process LRU)
  const l1Cache = useL1 ? new LRUCache<string, unknown>(cacheSize) : null;

  // 2. Initialize L2 (ioredis)
  let redisClient: Redis | null = null;
  let ownsRedisInstance = false;

  if (opts.redis) {
    if (typeof opts.redis === 'object' && 'get' in opts.redis && typeof (opts.redis as Redis).get === 'function') {
      redisClient = opts.redis as Redis;
    } else {
      try {
        const { default: RedisConstructor } = await import('ioredis');
        // @ts-expect-error - ioredis supports string or RedisOptions in constructor
        const client = new RedisConstructor(opts.redis);
        redisClient = client;
        ownsRedisInstance = true;

        client.on('error', (err: Error) => {
          fastify.log.warn(`[md-content] Redis connection error: ${err.message}`);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.warn(`[md-content] Failed to initialize ioredis (${msg}). Falling back to in-memory LRU.`);
      }
    }
  } else if ((fastify as unknown as { redis?: Redis }).redis) {
    redisClient = (fastify as unknown as { redis: Redis }).redis;
    fastify.log.info('[md-content] Auto-detected fastify.redis instance from host app.');
  }

  if (ownsRedisInstance && redisClient) {
    const clientToClose = redisClient;
    fastify.addHook('onClose', async () => {
      try {
        await clientToClose.quit();
      } catch {
        clientToClose.disconnect();
      }
    });
  }

  const redisListKey = (type: string) => `${redisKeyPrefix}:list:${type}`;
  const redisDocKey  = (type: string, slug: string) => `${redisKeyPrefix}:doc:${type}:${slug}`;

  // Shared internal cache adapter for sitemap and SEO operations
  const seoCacheAdapter: SimpleCacheInterface = {
    get: async (key: string) => {
      if (l1Cache) {
        const hit = l1Cache.get(key);
        if (typeof hit === 'string') return hit;
      }
      if (redisClient) {
        try {
          const cached = await redisClient.get(`${redisKeyPrefix}:${key}`);
          if (cached) {
            l1Cache?.set(key, cached);
            return cached;
          }
        } catch {
          // Graceful fallback
        }
      }
      return null;
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      l1Cache?.set(key, value);
      if (redisClient) {
        try {
          await redisClient.set(`${redisKeyPrefix}:${key}`, value, 'EX', ttlSeconds ?? redisTtl);
        } catch {
          // Graceful fallback
        }
      }
    },
  };

  async function invalidateSitemapCache(): Promise<void> {
    l1Cache?.evictPrefix('seo:');
    l1Cache?.del('sitemap:xml');
    if (redisClient) {
      try {
        await scanAndDelPrefix(redisClient, `${redisKeyPrefix}:seo:*`);
        await redisClient.del(`${redisKeyPrefix}:sitemap:xml`);
      } catch {
        // Graceful
      }
    }
  }

  async function invalidateCache(type: ContentType, slug?: string): Promise<void> {
    l1Cache?.del(`list:${type}`);
    if (slug) {
      l1Cache?.del(`doc:${type}:${slug}`);
    } else {
      l1Cache?.evictPrefix(`doc:${type}:`);
    }

    await invalidateSitemapCache();

    if (redisClient) {
      try {
        const keysToDelete = [redisListKey(type)];
        if (slug) {
          keysToDelete.push(redisDocKey(type, slug));
        }
        await redisClient.del(...keysToDelete);

        if (!slug) {
          await scanAndDelPrefix(redisClient, `${redisKeyPrefix}:doc:${type}:*`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.warn(`[md-content] Redis DEL error during invalidation: ${msg}`);
      }
    }
  }

  // -- Decorate fastify.universalContent --
  // Provides clean, non-intrusive access for the host app's existing routes (like sitemap.route.ts)

  if (!fastify.hasDecorator('universalContent')) {
    fastify.decorate('universalContent', {
      getAllDocs: async (type: ContentType) => getAllDocs(layerOpts, type),
      getDocBySlug: async (type: ContentType, slug: string) => getDocBySlug(layerOpts, type, slug),
      getSitemapEntries: async (options?: GetSitemapOptions) => {
        return getSitemapEntries(layerOpts, {
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          cache: seoCacheAdapter,
          ...opts.sitemapOptions,
          ...options,
        });
      },
      getSitemapXmlChunk: async (options?: GetSitemapOptions) => {
        return getSitemapXmlChunk(layerOpts, {
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          cache: seoCacheAdapter,
          ...opts.sitemapOptions,
          ...options,
        });
      },
      invalidateCache,
      invalidateSitemapCache,
    });
  }

  // -- GET /api/content/:type --

  fastify.get<{ Params: { type: string } }>(
    `${prefix}/:type`,
    async (req: FastifyRequest<{ Params: { type: string } }>, reply: FastifyReply) => {
      const { type } = req.params;

      if (!VALID_TYPES.includes(type as ContentType)) {
        return reply.code(404).send({ error: `Unknown content type: ${type}` });
      }

      const l1Key = `list:${type}`;
      const rKey  = redisListKey(type);

      if (l1Cache) {
        const l1Hit = l1Cache.get(l1Key) as UnifiedDoc[] | undefined;
        if (l1Hit) return reply.send(l1Hit);
      }

      if (redisClient) {
        try {
          const cached = await redisClient.get(rKey);
          if (cached) {
            const parsed = JSON.parse(cached) as UnifiedDoc[];
            l1Cache?.set(l1Key, parsed);
            return reply.send(parsed);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          fastify.log.warn(`[md-content] Redis GET error: ${msg}`);
        }
      }

      try {
        const docs = await getAllDocs(layerOpts, type as ContentType);
        l1Cache?.set(l1Key, docs);

        if (redisClient) {
          try {
            await redisClient.set(rKey, JSON.stringify(docs), 'EX', redisTtl);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            fastify.log.warn(`[md-content] Redis SET error: ${msg}`);
          }
        }

        return reply.send(docs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[md-content] Failed to load docs for "${type}": ${msg}`);
        return reply.code(500).send({ error: 'Failed to retrieve content' });
      }
    },
  );

  // -- GET /api/content/:type/:slug --

  fastify.get<{ Params: { type: string; slug: string } }>(
    `${prefix}/:type/:slug`,
    async (
      req: FastifyRequest<{ Params: { type: string; slug: string } }>,
      reply: FastifyReply,
    ) => {
      const { type, slug } = req.params;

      if (!VALID_TYPES.includes(type as ContentType)) {
        return reply.code(404).send({ error: `Unknown content type: ${type}` });
      }

      const l1Key = `doc:${type}:${slug}`;
      const rKey  = redisDocKey(type, slug);

      if (l1Cache) {
        const l1Hit = l1Cache.get(l1Key);
        if (l1Hit !== undefined) {
          if (l1Hit === null) return reply.code(404).send({ error: 'Not found' });
          return reply.send(l1Hit);
        }
      }

      if (redisClient) {
        try {
          const cached = await redisClient.get(rKey);
          if (cached !== null) {
            const parsed = JSON.parse(cached) as UnifiedDoc | null;
            l1Cache?.set(l1Key, parsed);
            if (parsed === null) return reply.code(404).send({ error: 'Not found' });
            return reply.send(parsed);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          fastify.log.warn(`[md-content] Redis GET single-doc error: ${msg}`);
        }
      }

      try {
        const doc = await getDocBySlug(layerOpts, type as ContentType, slug);
        l1Cache?.set(l1Key, doc);

        if (redisClient) {
          try {
            await redisClient.set(rKey, JSON.stringify(doc), 'EX', redisTtl);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            fastify.log.warn(`[md-content] Redis SET single-doc error: ${msg}`);
          }
        }

        if (!doc) return reply.code(404).send({ error: 'Not found' });
        return reply.send(doc);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[md-content] Failed to load doc "${slug}" in "${type}": ${msg}`);
        return reply.code(500).send({ error: 'Failed to retrieve document' });
      }
    },
  );

  // -- POST /api/content/webhook --

  if (isWebhookOn) {
    fastify.post(
      webhookPath,
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (opts.webhookSecret) {
          const headerSecret =
            req.headers['x-wp-webhook-secret'] ??
            req.headers['x-fastify-wp-secret'];

          if (headerSecret !== opts.webhookSecret) {
            fastify.log.warn('[md-content] Webhook rejected: invalid or missing secret.');
            return reply.code(401).send({ error: 'Unauthorized: invalid secret' });
          }
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const rawType = String(body['postType'] ?? body['post_type'] ?? 'blog');
        const rawSlug = body['slug'] != null
          ? String(body['slug'])
          : (body['post_name'] != null ? String(body['post_name']) : undefined);

        const type = mapWpPostType(rawType);

        await invalidateCache(type, rawSlug);

        if (opts.webhookWarmup !== false && layerOpts.wordpress) {
          const rKey = redisListKey(type);
          void warmupWithRetries(
            fastify.log,
            layerOpts,
            type,
            l1Cache,
            redisClient,
            rKey,
            redisTtl,
          );
        }

        return reply.send({
          ok: true,
          invalidated: true,
          type,
          ...(rawSlug !== undefined ? { slug: rawSlug } : {}),
        });
      },
    );
  }

  // -- Optional Standalone GET /sitemap.xml --

  if (isSitemapOn) {
    fastify.get(sitemapRoute, async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const sitemapOpts: GetSitemapOptions = {
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          cache: seoCacheAdapter,
          ...opts.sitemapOptions,
        };

        const contentEntries = await getSitemapEntries(layerOpts, sitemapOpts);

        let customEntries: SitemapEntry[] = [];
        if (opts.customSitemapEntries) {
          try {
            customEntries = await opts.customSitemapEntries(fastify);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            fastify.log.warn(`[md-content] Failed to load custom sitemap entries: ${msg}`);
          }
        }

        const allEntries = [...customEntries, ...contentEntries];
        const xml = generateSitemapXml(allEntries);

        // Conditional ETag caching
        const etag = generateEtag(xml);
        if (req.headers['if-none-match'] === etag) {
          return reply.code(304).send();
        }

        return reply
          .header('ETag', etag)
          .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
          .type('application/xml; charset=utf-8')
          .send(xml);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[md-content] Failed to generate sitemap.xml: ${msg}`);
        return reply.code(500).send({ error: 'Failed to generate sitemap' });
      }
    });
  }

  fastify.log.info(
    `[@crispice/universal-content] Fastify adapter ready. Decorator: fastify.universalContent. Routes: ${prefix}/:type, ${prefix}/:type/:slug${
      isWebhookOn ? `, ${webhookPath}` : ''
    }${isSitemapOn ? `, ${sitemapRoute}` : ''}`,
  );
};

export const contentPlugin = fp(contentPluginFn, {
  name: '@crispice/universal-content',
  fastify: '>=5.0.0',
});

export default contentPlugin;

// -- Standalone helpers --

export { getAllDocs, getDocBySlug } from './content.js';
export { formatDate } from './markdown.js';

/**
 * Build-time helper: writes all collections to JSON files on disk.
 * Pre-renders content for static hosting in monorepos.
 *
 * @param contentDir - absolute path to the content root directory.
 * @param outputDir  - where to write the JSON files (default: <contentDir>/../_content).
 */
export async function buildStaticContent(
  contentDir: string,
  outputDir?: string,
): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const out = outputDir ?? path.join(contentDir, '..', '_content');
  mkdirSync(out, { recursive: true });

  const types: ContentType[] = ['blog', 'news', 'projects'];
  for (const type of types) {
    const docs = await getAllDocs({ contentDir }, type);
    writeFileSync(
      path.join(out, `${type}.json`),
      JSON.stringify(docs, null, 2),
      'utf8',
    );
    console.log(`[universal-content] Wrote ${docs.length} ${type} docs ? ${out}/${type}.json`);
  }
}