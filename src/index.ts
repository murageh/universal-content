/**
 * src/index.ts
 *
 * Main entry point for @crispice/universal-content.
 * Universal content engine for Next.js, Fastify, and Vite.
 * Author: MURAGEH (murageh.co.ke).
 */

// Vite plugin exports
export { universalContentPlugin, mdContentPlugin } from './plugin.js';

// Core content functions (framework-agnostic)
export { getAllDocs, getDocBySlug, formatDate } from './content.js';

// Markdown engine
export {
  processMarkdown,
  parseMarkdownFile,
  getAllDocs as getAllMarkdownDocs,
  getDocBySlug as getMarkdownDocBySlug,
} from './markdown.js';

// SEO & Sitemap Engine
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
} from './seo.js';

// Types
export type {
  ContentType,
  MarkdownDoc,
  UnifiedDoc,
  UniversalContentPluginOptions,
  MdContentPluginOptions,
  WordPressOptions,
  RedisClientOrOptions,
} from './types.js';
export type { ContentLayerOptions } from './content.js';
export type {
  SitemapEntry,
  SitemapImage,
  ChangeFrequency,
  GetSitemapOptions,
  SimpleCacheInterface,
  JsonLdArticle,
  DocMetaTags,
} from './seo.js';