/**
 * src/next.ts
 *
 * Next.js adapter and utilities for @crispice/universal-content.
 * Tailored for Next.js 14 / 15 App Router, Pages Router, and Server Components.
 * Author: MURAGEH (murageh.co.ke).
 *
 * Features:
 *   - createRevalidateHandler: Native Web API Route Handler for WP publish webhooks.
 *   - createSitemapRouteHandler: Native Web API Route Handler for serving sitemap.xml.
 *   - getNextDocs & getNextDocBySlug: Pre-configured content getters for Server Components.
 *   - getRawDocBySlug: Guarantees fetching the original unsuffixed document.
 *   - SEO & Sitemap helpers: generateSitemapXml, parseSitemapXml, mergeSitemaps, getDocJsonLd, getDocMetaTags.
 */

import {
  getAllDocs,
  getDocBySlug,
  formatDate,
  type ContentLayerOptions,
  type UnifiedDoc,
  type ContentType,
} from './content.js';

import {
  getSitemapEntries,
  generateSitemapXml,
  parseSitemapXml,
  mergeSitemaps,
  getDocJsonLd,
  getDocMetaTags,
  type SitemapEntry,
  type GetSitemapOptions,
  type JsonLdArticle,
  type DocMetaTags,
} from './seo.js';

export { getAllDocs, getDocBySlug, formatDate };
export { getWPAllDocs, getWPDocBySlug } from './wordpress.js';
export {
  getSitemapEntries,
  generateSitemapXml,
  parseSitemapXml,
  mergeSitemaps,
  getDocJsonLd,
  getDocMetaTags,
};
export type {
  ContentLayerOptions,
  UnifiedDoc,
  ContentType,
  SitemapEntry,
  GetSitemapOptions,
  JsonLdArticle,
  DocMetaTags,
};

// ── Next.js Revalidation Webhook Handler ──

export interface NextRevalidateOptions {
  /**
   * Secret key to authenticate incoming WordPress webhooks.
   * Matches `X-WP-Webhook-Secret`, `X-Fastify-WP-Secret`, or `?secret=...`.
   */
  secret?: string;

  /**
   * Next.js cache tag to invalidate (e.g. 'wordpress').
   * @default 'wordpress'
   */
  revalidateTag?: string;

  /**
   * Optional custom callback invoked upon successful revalidation.
   * Use this to call Next.js `revalidateTag(tag)` or `revalidatePath(path)`.
   */
  onRevalidate?: (info: {
    type: ContentType;
    slug?: string;
    postType: string;
  }) => Promise<void> | void;
}

function mapWpType(raw: string): ContentType {
  const norm = raw.toLowerCase().replace(/[-_]/g, '');
  if (norm === 'post' || norm === 'posts' || norm === 'blog') return 'blog';
  if (norm.includes('news')) return 'news';
  if (norm.includes('project')) return 'projects';
  return 'blog';
}

/**
 * Creates an App Router Route Handler (`export const POST = createRevalidateHandler(...)`)
 * for instant Next.js on-demand revalidation when WordPress posts are published.
 */
export function createRevalidateHandler(options: NextRevalidateOptions = {}) {
  return async (req: Request): Promise<Response> => {
    if (options.secret) {
      const headerSecret =
        req.headers.get('x-wp-webhook-secret') ??
        req.headers.get('x-fastify-wp-secret');

      const url = new URL(req.url);
      const querySecret = url.searchParams.get('secret');

      if (headerSecret !== options.secret && querySecret !== options.secret) {
        return Response.json(
          { error: 'Unauthorized: invalid or missing webhook secret' },
          { status: 401 },
        );
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      // Body may be empty on simple pings
    }

    const postType = String(body['postType'] ?? body['post_type'] ?? 'blog');
    const slug = body['slug'] != null
      ? String(body['slug'])
      : (body['post_name'] != null ? String(body['post_name']) : undefined);

    const type = mapWpType(postType);

    if (options.onRevalidate) {
      await options.onRevalidate({
        type,
        postType,
        ...(slug !== undefined ? { slug } : {}),
      });
    }

    return Response.json({
      revalidated: true,
      type,
      ...(slug !== undefined ? { slug } : {}),
      tag: options.revalidateTag ?? 'wordpress',
    });
  };
}

// ── Next.js Sitemap Route Handler ──

export interface NextSitemapHandlerOptions extends GetSitemapOptions {
  /**
   * Hook for providing additional dynamic host app entries (products, categories, platform pages, etc.).
   */
  customEntries?: () => Promise<SitemapEntry[]> | SitemapEntry[];
}

/**
 * Creates an App Router Route Handler (`export const GET = createSitemapRouteHandler(...)`)
 * for serving `/sitemap.xml` directly in Next.js.
 */
export function createSitemapRouteHandler(
  opts: ContentLayerOptions,
  options: NextSitemapHandlerOptions = {},
) {
  return async (_req?: Request): Promise<Response> => {
    const contentEntries = await getSitemapEntries(opts, options);
    let custom: SitemapEntry[] = [];
    if (options.customEntries) {
      custom = await options.customEntries();
    }
    const all = [...custom, ...contentEntries];
    const xml = generateSitemapXml(all);

    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  };
}

// ── Next.js Content Helpers ──

/**
 * Fetches all documents for a collection in a Next.js Server Component or Route Handler.
 * Returns UnifiedDoc[] sorted newest-first.
 */
export async function getNextDocs(
  opts: ContentLayerOptions,
  type: ContentType,
): Promise<UnifiedDoc[]> {
  return getAllDocs(opts, type);
}

/**
 * Fetches a single document by slug in a Next.js Server Component.
 * Returns null if not found, allowing Next.js to trigger `notFound()`.
 */
export async function getNextDocBySlug(
  opts: ContentLayerOptions,
  type: ContentType,
  slug: string,
): Promise<UnifiedDoc | null> {
  return getDocBySlug(opts, type, slug);
}

/**
 * Explicitly fetches a document by its original source slug (before collision resolution).
 * Guarantees that someone on Next.js receives the original WordPress or Markdown document.
 */
export async function getRawDocBySlug(
  opts: ContentLayerOptions,
  type: ContentType,
  rawSlug: string,
): Promise<UnifiedDoc | null> {
  const docs = await getAllDocs(opts, type);
  return docs.find((d) => d.rawSlug === rawSlug) ?? null;
}