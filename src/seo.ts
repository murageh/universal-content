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

import crypto from 'node:crypto';
import { getAllDocs, type ContentLayerOptions } from './content.js';
import type { ContentType, UnifiedDoc } from './types.js';

export type ChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SitemapImage {
  url: string;
  title?: string;
  caption?: string;
}

export interface SitemapEntry {
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

export interface SimpleCacheInterface {
  get: (key: string) => Promise<string | null | undefined> | string | null | undefined;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<unknown> | unknown;
}

export interface GetSitemapOptions {
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

export interface JsonLdArticle {
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

export interface JsonLdGraph {
  '@context': 'https://schema.org';
  '@graph': Array<Record<string, unknown>>;
}

export interface GetDocJsonLdOptions {
  baseUrl: string;
  siteName?: string;
  publisherLogo?: string;
  authorName?: string;
  articleType?: 'Article' | 'BlogPosting' | 'NewsArticle';
  /** Additional Schema.org itemsets (e.g. FAQPage, ItemList, LocalBusiness) to merge into @graph. */
  additionalJsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface DocMetaTags {
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

// ── XML Escaping Helpers ──

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(escaped: string): string {
  return escaped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Public API ──

/**
 * Generates an ETag hash for an XML sitemap or payload string.
 */
export function generateEtag(content: string): string {
  const hash = crypto.createHash('sha1').update(content, 'utf8').digest('hex').slice(0, 16);
  return `"${hash}"`;
}

/**
 * Extracts all sitemap entries from content collections.
 * Supports optional caching via `options.cache`.
 */
export async function getSitemapEntries(
  opts: ContentLayerOptions,
  options: GetSitemapOptions = {},
): Promise<SitemapEntry[]> {
  const cacheKey = options.cacheKey ?? `seo:sitemap-entries:${options.baseUrl ?? 'default'}`;

  if (options.cache) {
    try {
      const cached = await options.cache.get(cacheKey);
      if (typeof cached === 'string' && cached.length > 0) {
        return JSON.parse(cached) as SitemapEntry[];
      }
    } catch {
      // Gracefully fall through
    }
  }

  const collections: ContentType[] = options.collections ?? ['blog', 'news', 'projects'];
  const base = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : '';

  const defaultPriorities: Record<ContentType, number> = {
    blog: 0.8,
    news: 0.7,
    projects: 0.7,
    ...options.defaultPriority,
  };

  const defaultFreqs: Record<ContentType, ChangeFrequency> = {
    blog: 'weekly',
    news: 'daily',
    projects: 'monthly',
    ...options.defaultChangefreq,
  };

  const allEntries: SitemapEntry[] = [];

  for (const type of collections) {
    const docs = await getAllDocs(opts, type);
    const prefix = options.pathPrefixMap?.[type] ?? type;

    for (const doc of docs) {
      const loc = base ? `${base}/${prefix}/${doc.slug}` : `/${prefix}/${doc.slug}`;

      let lastmod: string | undefined = undefined;
      const rawDate = doc['lastmod'] ?? doc['updatedAt'] ?? doc['modified'] ?? doc.date;
      if (typeof rawDate === 'string' && rawDate.length >= 10) {
        lastmod = rawDate.slice(0, 10);
      }

      let priority = defaultPriorities[type];
      if (typeof doc['priority'] === 'number') {
        priority = doc['priority'];
      }

      let changefreq = defaultFreqs[type];
      if (typeof doc['changefreq'] === 'string') {
        changefreq = doc['changefreq'] as ChangeFrequency;
      }

      const images: SitemapImage[] = [];
      const imgUrl = doc.featuredImage ?? (typeof doc['image'] === 'string' ? doc['image'] : undefined);
      if (imgUrl) {
        const imgTitle = typeof doc['imageTitle'] === 'string' ? doc['imageTitle'] : undefined;
        images.push({
          url: imgUrl,
          ...(imgTitle !== undefined ? { title: imgTitle } : {}),
        });
      }

      allEntries.push({
        loc,
        ...(lastmod !== undefined ? { lastmod } : {}),
        ...(changefreq !== undefined ? { changefreq } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(images.length > 0 ? { images } : {}),
        type,
        slug: doc.slug,
      });
    }
  }

  if (options.cache) {
    try {
      const ttl = options.cacheTtl ?? 3600;
      await options.cache.set(cacheKey, JSON.stringify(allEntries), ttl);
    } catch {
      // Graceful
    }
  }

  return allEntries;
}

/**
 * Generates only the inner <url> XML nodes (without the <urlset> wrapper).
 * Optimized for streaming or appending directly into a host application's existing sitemap.
 */
export async function getSitemapXmlChunk(
  opts: ContentLayerOptions,
  options: GetSitemapOptions = {},
): Promise<string> {
  const cacheKey = options.cacheKey ?? `seo:sitemap-chunk:${options.baseUrl ?? 'default'}`;

  if (options.cache) {
    try {
      const cached = await options.cache.get(cacheKey);
      if (typeof cached === 'string' && cached.length > 0) {
        return cached;
      }
    } catch {
      // Graceful
    }
  }

  const entries = await getSitemapEntries(opts, options);
  const lines: string[] = [];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    if (entry.images && entry.images.length > 0) {
      for (const img of entry.images) {
        lines.push('    <image:image>');
        lines.push(`      <image:loc>${escapeXml(img.url)}</image:loc>`);
        if (img.title) {
          lines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
        }
        lines.push('    </image:image>');
      }
    }
    lines.push('  </url>');
  }

  const chunk = lines.join('\n');

  if (options.cache) {
    try {
      const ttl = options.cacheTtl ?? 3600;
      await options.cache.set(cacheKey, chunk, ttl);
    } catch {
      // Graceful
    }
  }

  return chunk;
}

/**
 * Appends raw <url> XML nodes or an existing XML sitemap into a target base XML sitemap
 * right before the closing </urlset> tag.
 * Fast, non-destructive, and preserves existing host app sitemap formatting.
 */
export function mergeSitemapUrlsets(baseXml: string, additionalChunkOrXml: string): string {
  let targetBaseXml = baseXml;

  let chunkToInsert = additionalChunkOrXml.trim();
  if (chunkToInsert.includes('<urlset')) {
    const innerMatch = /<urlset\b[^>]*>([\s\S]*?)<\/urlset>/i.exec(chunkToInsert);
    if (innerMatch && innerMatch[1]) {
      chunkToInsert = innerMatch[1].trim();
    }
  }

  if (!chunkToInsert) {
    return baseXml;
  }

  // Ensure Google Image sitemap namespace is declared if images are being merged
  if (chunkToInsert.includes('<image:') && !targetBaseXml.includes('xmlns:image=')) {
    targetBaseXml = targetBaseXml.replace(
      /<urlset\b/i,
      '<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    );
  }

  const closingTagIndex = targetBaseXml.lastIndexOf('</urlset>');
  if (closingTagIndex === -1) {
    return mergeSitemaps(targetBaseXml, parseSitemapXml(additionalChunkOrXml));
  }

  const before = targetBaseXml.slice(0, closingTagIndex).trimEnd();
  const after = targetBaseXml.slice(closingTagIndex);

  return `${before}\n${chunkToInsert}\n${after}`;
}

/**
 * Serializes SitemapEntry[] into standards-compliant XML.
 */
export function generateSitemapXml(entries: SitemapEntry[]): string {
  const hasImages = entries.some((e) => e.images && e.images.length > 0);

  const xmlLines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${
      hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''
    }>`,
  ];

  for (const entry of entries) {
    xmlLines.push('  <url>');
    xmlLines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) {
      xmlLines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      xmlLines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      xmlLines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    if (entry.images && entry.images.length > 0) {
      for (const img of entry.images) {
        xmlLines.push('    <image:image>');
        xmlLines.push(`      <image:loc>${escapeXml(img.url)}</image:loc>`);
        if (img.title) {
          xmlLines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
        }
        xmlLines.push('    </image:image>');
      }
    }
    xmlLines.push('  </url>');
  }

  xmlLines.push('</urlset>');
  return xmlLines.join('\n');
}

/**
 * XML loader & processor: parses existing sitemap XML into structured SitemapEntry[].
 */
export function parseSitemapXml(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlRegex = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const locMatch = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(block);
    if (!locMatch || !locMatch[1]) continue;

    const loc = unescapeXml(locMatch[1].trim());

    const lastmodMatch = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block);
    const lastmod = lastmodMatch && lastmodMatch[1] ? unescapeXml(lastmodMatch[1].trim()) : undefined;

    const changefreqMatch = /<changefreq\b[^>]*>([\s\S]*?)<\/changefreq>/i.exec(block);
    const changefreq = changefreqMatch && changefreqMatch[1] ? (unescapeXml(changefreqMatch[1].trim()) as ChangeFrequency) : undefined;

    const priorityMatch = /<priority\b[^>]*>([\s\S]*?)<\/priority>/i.exec(block);
    const priority = priorityMatch && priorityMatch[1] ? parseFloat(priorityMatch[1].trim()) : undefined;

    const images: SitemapImage[] = [];
    const imgRegex = /<image:image\b[^>]*>([\s\S]*?)<\/image:image>/gi;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(block)) !== null) {
      const imgBlock = imgMatch[1] ?? '';
      const imgLocMatch = /<image:loc\b[^>]*>([\s\S]*?)<\/image:loc>/i.exec(imgBlock);
      if (imgLocMatch && imgLocMatch[1]) {
        const titleMatch = /<image:title\b[^>]*>([\s\S]*?)<\/image:title>/i.exec(imgBlock);
        images.push({
          url: unescapeXml(imgLocMatch[1].trim()),
          ...(titleMatch && titleMatch[1] ? { title: unescapeXml(titleMatch[1].trim()) } : {}),
        });
      }
    }

    entries.push({
      loc,
      ...(lastmod !== undefined ? { lastmod } : {}),
      ...(changefreq !== undefined ? { changefreq } : {}),
      ...(priority !== undefined && !isNaN(priority) ? { priority } : {}),
      ...(images.length > 0 ? { images } : {}),
    });
  }

  return entries;
}

/**
 * Merges existing sitemap XML (or entries) with new dynamic entries (e.g. product catalog items, platform pages),
 * deduplicating by URL (loc).
 */
export function mergeSitemaps(
  existingXmlOrEntries: string | SitemapEntry[],
  newEntries: SitemapEntry[],
): string {
  const existing = typeof existingXmlOrEntries === 'string'
    ? parseSitemapXml(existingXmlOrEntries)
    : existingXmlOrEntries;

  const map = new Map<string, SitemapEntry>();

  for (const entry of existing) {
    map.set(entry.loc, entry);
  }

  for (const entry of newEntries) {
    const current = map.get(entry.loc);
    map.set(entry.loc, { ...current, ...entry });
  }

  return generateSitemapXml(Array.from(map.values()));
}

/**
 * Merges multiple Schema.org JSON-LD objects or arrays into a clean, deduplicated @graph structure.
 * Strips duplicate '@context' declarations from nested child nodes inside the graph.
 */
export function mergeJsonLd(
  base: Record<string, unknown> | Array<Record<string, unknown>>,
  additional: Record<string, unknown> | Array<Record<string, unknown>>,
): JsonLdGraph {
  const items: Array<Record<string, unknown>> = [];

  function addItem(item: Record<string, unknown>) {
    if ('@graph' in item && Array.isArray(item['@graph'])) {
      for (const subItem of item['@graph']) {
        if (typeof subItem === 'object' && subItem !== null) {
          addItem(subItem as Record<string, unknown>);
        }
      }
      return;
    }

    // Strip child @context when placed inside a @graph container
    const { '@context': _ctx, ...rest } = item;
    items.push(rest);
  }

  const baseItems = Array.isArray(base) ? base : [base];
  for (const b of baseItems) {
    if (typeof b === 'object' && b !== null) {
      addItem(b);
    }
  }

  const additionalItems = Array.isArray(additional) ? additional : [additional];
  for (const a of additionalItems) {
    if (typeof a === 'object' && a !== null) {
      addItem(a);
    }
  }

  return {
    '@context': 'https://schema.org',
    '@graph': items,
  };
}

/**
 * Generates Schema.org JSON-LD Article or BlogPosting structured data.
 * When doc.customJsonLd or options.additionalJsonLd is present, merges all schemas
 * into a Schema.org @graph container.
 */
export function getDocJsonLd(
  doc: UnifiedDoc,
  options: GetDocJsonLdOptions,
): JsonLdArticle | JsonLdGraph {
  const base = options.baseUrl.replace(/\/+$/, '');
  const url = `${base}/${doc.category.toLowerCase() === 'news' ? 'news' : 'blog'}/${doc.slug}`;
  const type = options.articleType ?? (doc.category.toLowerCase() === 'news' ? 'NewsArticle' : 'BlogPosting');

  const jsonLd: JsonLdArticle = {
    '@context': 'https://schema.org',
    '@type': type,
    headline: doc.title,
    mainEntityOfPage: url,
    ...(doc.excerpt ? { description: doc.excerpt } : {}),
    ...(doc.date ? { datePublished: doc.date } : {}),
    ...(doc.featuredImage ? { image: doc.featuredImage } : {}),
    ...(doc.category ? { articleSection: doc.category } : {}),
    author: {
      '@type': 'Organization',
      name: options.authorName ?? options.siteName ?? 'MURAGEH',
    },
  };

  if (options.siteName) {
    jsonLd.publisher = {
      '@type': 'Organization',
      name: options.siteName,
      ...(options.publisherLogo !== undefined
        ? {
            logo: {
              '@type': 'ImageObject',
              url: options.publisherLogo,
            },
          }
        : {}),
    };
  }

  const additional = options.additionalJsonLd ?? (doc.customJsonLd as Record<string, unknown> | Array<Record<string, unknown>> | undefined);

  if (additional) {
    return mergeJsonLd(jsonLd as unknown as Record<string, unknown>, additional);
  }

  return jsonLd;
}

/**
 * Generates complete OpenGraph and Twitter meta tags.
 */
export function getDocMetaTags(
  doc: UnifiedDoc,
  options: {
    baseUrl: string;
    siteName?: string;
    defaultImage?: string;
  },
): DocMetaTags {
  const base = options.baseUrl.replace(/\/+$/, '');
  const canonicalUrl = `${base}/${doc.category.toLowerCase() === 'news' ? 'news' : 'blog'}/${doc.slug}`;
  const image = doc.featuredImage ?? options.defaultImage;

  return {
    title: doc.title,
    description: doc.excerpt,
    canonicalUrl,
    openGraph: {
      'og:title': doc.title,
      'og:description': doc.excerpt,
      'og:url': canonicalUrl,
      'og:type': 'article',
      ...(options.siteName !== undefined ? { 'og:site_name': options.siteName } : {}),
      ...(image !== undefined ? { 'og:image': image } : {}),
    },
    twitter: {
      'twitter:card': image ? 'summary_large_image' : 'summary',
      'twitter:title': doc.title,
      'twitter:description': doc.excerpt,
      ...(image !== undefined ? { 'twitter:image': image } : {}),
    },
  };
}