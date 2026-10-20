import { G as GetSitemapOptions, S as SitemapEntry, C as ContentLayerOptions } from './seo-C5K__9vN.js';
export { D as DocMetaTags, J as JsonLdArticle, a as generateSitemapXml, b as getAllDocs, c as getDocBySlug, d as getDocJsonLd, e as getDocMetaTags, f as getSitemapEntries, i as mergeSitemaps, p as parseSitemapXml } from './seo-C5K__9vN.js';
export { getWPAllDocs, getWPDocBySlug } from './wordpress.js';
import { C as ContentType, U as UnifiedDoc } from './types-BkjruK9s.js';
export { f as formatDate } from './markdown-DducjcBA.js';
import 'ioredis';

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

interface NextRevalidateOptions {
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
/**
 * Creates an App Router Route Handler (`export const POST = createRevalidateHandler(...)`)
 * for instant Next.js on-demand revalidation when WordPress posts are published.
 */
declare function createRevalidateHandler(options?: NextRevalidateOptions): (req: Request) => Promise<Response>;
interface NextSitemapHandlerOptions extends GetSitemapOptions {
    /**
     * Hook for providing additional dynamic host app entries (products, categories, platform pages, etc.).
     */
    customEntries?: () => Promise<SitemapEntry[]> | SitemapEntry[];
}
/**
 * Creates an App Router Route Handler (`export const GET = createSitemapRouteHandler(...)`)
 * for serving `/sitemap.xml` directly in Next.js.
 */
declare function createSitemapRouteHandler(opts: ContentLayerOptions, options?: NextSitemapHandlerOptions): (_req?: Request) => Promise<Response>;
/**
 * Fetches all documents for a collection in a Next.js Server Component or Route Handler.
 * Returns UnifiedDoc[] sorted newest-first.
 */
declare function getNextDocs(opts: ContentLayerOptions, type: ContentType): Promise<UnifiedDoc[]>;
/**
 * Fetches a single document by slug in a Next.js Server Component.
 * Returns null if not found, allowing Next.js to trigger `notFound()`.
 */
declare function getNextDocBySlug(opts: ContentLayerOptions, type: ContentType, slug: string): Promise<UnifiedDoc | null>;
/**
 * Explicitly fetches a document by its original source slug (before collision resolution).
 * Guarantees that someone on Next.js receives the original WordPress or Markdown document.
 */
declare function getRawDocBySlug(opts: ContentLayerOptions, type: ContentType, rawSlug: string): Promise<UnifiedDoc | null>;

export { ContentLayerOptions, ContentType, GetSitemapOptions, SitemapEntry, UnifiedDoc, createRevalidateHandler, createSitemapRouteHandler, getNextDocBySlug, getNextDocs, getRawDocBySlug };
export type { NextRevalidateOptions, NextSitemapHandlerOptions };
