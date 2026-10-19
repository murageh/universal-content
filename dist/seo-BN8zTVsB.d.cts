import { W as WordPressOptions, C as ContentType, U as UnifiedDoc } from './types-CFpEjJJH.cjs';

/**
 * src/content.ts
 *
 * Unified content layer - merges Markdown and WordPress sources.
 * Framework-agnostic. Works in Vite, Fastify, Next.js, and plain Node.
 * Part of the MURAGEH ecosystem (murageh.co.ke).
 *
 * Key features:
 *   - contentDir and WordPressOptions are injected; no hard-coded env access.
 *   - Stable SHA-256 slug collision algorithm.
 *   - Configurable error behavior (onWordPressError: fallback vs throw).
 */

interface ContentLayerOptions {
    /** Absolute path to the directory containing collection subdirectories. */
    contentDir: string;
    /**
     * Optional WordPress connection config.
     * When omitted, the layer works in markdown-only mode.
     */
    wordpress?: WordPressOptions;
    /**
     * Behavior when WordPress is unreachable or returns an error.
     * - 'fallback': (default) logs a warning and returns Markdown docs or null if not found.
     * - 'throw': re-throws the WordPress error so the host app can handle it (e.g. 503 / error boundary).
     * @default 'fallback'
     */
    onWordPressError?: 'fallback' | 'throw';
}
/**
 * Returns all published documents for a content type, merged from both
 * WordPress and Markdown, sorted newest-first.
 *
 * Falls back to markdown-only when WordPress is not configured or unreachable (unless onWordPressError is 'throw').
 */
declare function getAllDocs(opts: ContentLayerOptions, type: ContentType): Promise<UnifiedDoc[]>;
/**
 * Fetches a single document by its public slug (possibly collision-suffixed).
 * Resolution order: WordPress → Markdown → null.
 */
declare function getDocBySlug(opts: ContentLayerOptions, type: ContentType, publicSlug: string): Promise<UnifiedDoc | null>;

/**
 * src/seo.ts
 *
 * Comprehensive SEO & Sitemap Engine for @crispice/universal-content.
 * Framework-agnostic: Works in Fastify, Next.js, Vite, and plain Node.
 * Author: MURAGEH (murageh.co.ke).
 *
 * Features:
 *   - getSitemapEntries: Extracts structured URLs, lastmod, priority, and images from content.
 *   - getSitemapXmlChunk: Generates pre-formatted <url> nodes optimized for streaming/appending.
 *   - generateSitemapXml: Generates valid, standards-compliant Sitemap 0.9 + Image XML.
 *   - parseSitemapXml: XML loader & parser for reading existing sitemaps.
 *   - mergeSitemaps: Full deduplicated merge of sitemap entries into XML.
 *   - mergeSitemapUrlsets: High-speed injection of XML chunks into existing <urlset> sitemaps.
 *   - generateEtag: SHA-1 ETag generator for HTTP 304 Not Modified caching.
 *   - getDocJsonLd: Schema.org/BlogPosting & Article JSON-LD structured data generator.
 *   - getDocMetaTags: OpenGraph & Twitter card meta tag generator.
 */

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
interface SitemapImage {
    url: string;
    title?: string;
    caption?: string;
}
interface SitemapEntry {
    /** Full canonical URL or relative path. */
    loc: string;
    /** ISO date string YYYY-MM-DD or full timestamp. */
    lastmod?: string;
    /** Expected change frequency. */
    changefreq?: ChangeFrequency;
    /** Priority between 0.0 and 1.0. */
    priority?: number;
    /** Associated image metadata for Google Image Sitemaps. */
    images?: SitemapImage[];
    /** Content type collection name (e.g. 'blog', 'projects', 'news', or 'custom'). */
    type?: ContentType | 'custom' | string;
    /** Original or public slug. */
    slug?: string;
    [key: string]: unknown;
}
interface SimpleCacheInterface {
    get: (key: string) => Promise<string | null | undefined> | string | null | undefined;
    set: (key: string, value: string, ttlSeconds?: number) => Promise<unknown> | unknown;
}
interface GetSitemapOptions {
    /**
     * Base URL of the website (e.g. 'https://murageh.co.ke').
     * When provided, `loc` will be an absolute URL (`${baseUrl}/${pathPrefix}/${slug}`).
     */
    baseUrl?: string;
    /**
     * Collections to include in the sitemap.
     * @default ['blog', 'news', 'projects']
     */
    collections?: ContentType[];
    /**
     * Custom path prefix mapping for collections.
     * Example: `{ blog: 'articles', projects: 'case-studies' }`
     */
    pathPrefixMap?: Partial<Record<ContentType, string>>;
    /**
     * Default priorities per collection if not specified in frontmatter.
     * Defaults: blog = 0.8, news = 0.7, projects = 0.7.
     */
    defaultPriority?: Partial<Record<ContentType, number>>;
    /**
     * Default change frequency per collection if not specified in frontmatter.
     * Defaults: blog = 'weekly', news = 'daily', projects = 'monthly'.
     */
    defaultChangefreq?: Partial<Record<ContentType, ChangeFrequency>>;
    /**
     * Optional cache client (L1 LRU, Redis, or custom) to avoid re-generating entries.
     */
    cache?: SimpleCacheInterface;
    /**
     * Custom cache key.
     */
    cacheKey?: string;
    /**
     * Cache TTL in seconds.
     * @default 3600 (1 hour)
     */
    cacheTtl?: number;
}
interface JsonLdArticle {
    '@context': 'https://schema.org';
    '@type': 'Article' | 'BlogPosting' | 'NewsArticle';
    headline: string;
    description?: string;
    datePublished?: string;
    dateModified?: string;
    image?: string;
    mainEntityOfPage: string;
    author?: {
        '@type': 'Person' | 'Organization';
        name: string;
    };
    publisher?: {
        '@type': 'Organization';
        name: string;
        logo?: {
            '@type': 'ImageObject';
            url: string;
        };
    };
    articleSection?: string;
}
interface DocMetaTags {
    title: string;
    description: string;
    canonicalUrl: string;
    openGraph: {
        'og:title': string;
        'og:description': string;
        'og:url': string;
        'og:type': string;
        'og:site_name'?: string;
        'og:image'?: string;
    };
    twitter: {
        'twitter:card': 'summary' | 'summary_large_image';
        'twitter:title': string;
        'twitter:description': string;
        'twitter:image'?: string;
    };
}
/**
 * Generates an ETag hash for an XML sitemap or payload string.
 */
declare function generateEtag(content: string): string;
/**
 * Extracts all sitemap entries from content collections.
 * Supports optional caching via `options.cache`.
 */
declare function getSitemapEntries(opts: ContentLayerOptions, options?: GetSitemapOptions): Promise<SitemapEntry[]>;
/**
 * Generates only the inner <url> XML nodes (without the <urlset> wrapper).
 * Optimized for streaming or appending directly into a host application's existing sitemap.
 */
declare function getSitemapXmlChunk(opts: ContentLayerOptions, options?: GetSitemapOptions): Promise<string>;
/**
 * Appends raw <url> XML nodes or an existing XML sitemap into a target base XML sitemap
 * right before the closing </urlset> tag.
 * Fast, non-destructive, and preserves existing host app sitemap formatting.
 */
declare function mergeSitemapUrlsets(baseXml: string, additionalChunkOrXml: string): string;
/**
 * Serializes SitemapEntry[] into standards-compliant XML.
 */
declare function generateSitemapXml(entries: SitemapEntry[]): string;
/**
 * XML loader & processor: parses existing sitemap XML into structured SitemapEntry[].
 */
declare function parseSitemapXml(xml: string): SitemapEntry[];
/**
 * Merges existing sitemap XML (or entries) with new dynamic entries (e.g. product catalog items, platform pages),
 * deduplicating by URL (loc).
 */
declare function mergeSitemaps(existingXmlOrEntries: string | SitemapEntry[], newEntries: SitemapEntry[]): string;
/**
 * Generates Schema.org JSON-LD Article or BlogPosting structured data.
 */
declare function getDocJsonLd(doc: UnifiedDoc, options: {
    baseUrl: string;
    siteName?: string;
    publisherLogo?: string;
    authorName?: string;
    articleType?: 'Article' | 'BlogPosting' | 'NewsArticle';
}): JsonLdArticle;
/**
 * Generates complete OpenGraph and Twitter meta tags.
 */
declare function getDocMetaTags(doc: UnifiedDoc, options: {
    baseUrl: string;
    siteName?: string;
    defaultImage?: string;
}): DocMetaTags;

export { generateSitemapXml as a, getAllDocs as b, getDocBySlug as c, getDocJsonLd as d, getDocMetaTags as e, getSitemapEntries as f, generateEtag as g, getSitemapXmlChunk as h, mergeSitemaps as i, mergeSitemapUrlsets as m, parseSitemapXml as p };
export type { ContentLayerOptions as C, DocMetaTags as D, GetSitemapOptions as G, JsonLdArticle as J, SitemapEntry as S, ChangeFrequency as j, SimpleCacheInterface as k, SitemapImage as l };
