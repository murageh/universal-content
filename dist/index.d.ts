import { Plugin } from 'vite';
import { M as MdContentPluginOptions } from './types-DDx-Ufje.js';
export { C as ContentType, a as MarkdownDoc, R as RedisClientOrOptions, U as UnifiedDoc, b as UniversalContentPluginOptions, W as WordPressOptions } from './types-DDx-Ufje.js';
export { j as ChangeFrequency, C as ContentLayerOptions, D as DocMetaTags, k as GetDocJsonLdOptions, G as GetSitemapOptions, J as JsonLdArticle, l as JsonLdGraph, n as SimpleCacheInterface, S as SitemapEntry, o as SitemapImage, g as generateEtag, a as generateSitemapXml, b as getAllDocs, c as getDocBySlug, d as getDocJsonLd, e as getDocMetaTags, f as getSitemapEntries, h as getSitemapXmlChunk, q as mergeJsonLd, m as mergeSitemapUrlsets, i as mergeSitemaps, p as parseSitemapXml } from './seo-BJPTjKho.js';
export { f as formatDate, g as getAllMarkdownDocs, a as getMarkdownDocBySlug, p as parseMarkdownFile, b as processMarkdown } from './markdown-BEVfzctz.js';
import 'ioredis';

/**
 * src/plugin.ts
 *
 * Vite plugin for @crispice/universal-content.
 *
 * Exposes virtual modules to your Vite app:
 *   - virtual:content/<type>         (e.g. virtual:content/blog)
 *   - virtual:content/<type>/<slug>  (e.g. virtual:content/blog/solar-tips)
 * Also supports legacy prefix `virtual:md-content/` for backwards compatibility.
 *
 * Watches content directory and triggers instant HMR on changes.
 */

type UniversalContentPluginOptions = MdContentPluginOptions;
declare function universalContentPlugin(options?: UniversalContentPluginOptions): Plugin;
declare const mdContentPlugin: typeof universalContentPlugin;

export { MdContentPluginOptions, mdContentPlugin, universalContentPlugin };
