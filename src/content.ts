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

import {
  getAllDocs as getAllMarkdownDocs,
  getDocBySlug as getMarkdownDocBySlug,
  formatDate,
  type MarkdownDoc,
} from './markdown.js';

import {
  getWPAllDocs,
  getWPDocBySlug,
  buildSuffixedSlug,
  type UnifiedDoc,
  type WordPressOptions,
} from './wordpress.js';

import type { ContentType } from './types.js';

export { formatDate };
export type { UnifiedDoc, ContentType, MarkdownDoc, WordPressOptions };

// ── Adapter ──

function markdownToUnified(doc: MarkdownDoc): UnifiedDoc {
  return {
    ...doc,
    rawSlug: doc.slug,
    source:  'markdown',
    excerpt: (doc.excerpt as string | undefined) ?? '',
  };
}

// ── Collision detection ──

function findCollisions(a: UnifiedDoc[], b: UnifiedDoc[]): Set<string> {
  const aSet = new Set(a.map((d) => d.rawSlug));
  const collisions = new Set<string>();
  for (const doc of b) {
    if (aSet.has(doc.rawSlug)) collisions.add(doc.rawSlug);
  }
  return collisions;
}

function resolveCollisions(docs: UnifiedDoc[], collisions: Set<string>): UnifiedDoc[] {
  return docs.map((doc) => {
    if (!collisions.has(doc.rawSlug)) return doc;
    return { ...doc, slug: buildSuffixedSlug(doc.source, doc.rawSlug) };
  });
}

// ── Public API ──

export interface ContentLayerOptions {
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
export async function getAllDocs(
  opts: ContentLayerOptions,
  type: ContentType,
): Promise<UnifiedDoc[]> {
  const mdPromise = getAllMarkdownDocs(opts.contentDir, type).then((docs) =>
    docs.map(markdownToUnified),
  );

  const wpPromise = opts.wordpress
    ? getWPAllDocs(opts.wordpress, type).catch((err: unknown) => {
        if (opts.onWordPressError === 'throw') {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[content] WordPress fetch failed for "${type}" (${msg}). Falling back to local Markdown.`);
        return [] as UnifiedDoc[];
      })
    : Promise.resolve([] as UnifiedDoc[]);

  const [wpDocs, mdDocs] = await Promise.all([wpPromise, mdPromise]);
  const collisions = findCollisions(wpDocs, mdDocs);

  return [
    ...resolveCollisions(wpDocs, collisions),
    ...resolveCollisions(mdDocs, collisions),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Fetches a single document by its public slug (possibly collision-suffixed).
 * Resolution order: WordPress → Markdown → null.
 */
export async function getDocBySlug(
  opts: ContentLayerOptions,
  type: ContentType,
  publicSlug: string,
): Promise<UnifiedDoc | null> {
  const candidates = getCandidateRawSlugs(publicSlug);

  for (const rawSlug of candidates) {
    if (opts.wordpress) {
      try {
        const wpDoc = await getWPDocBySlug(opts.wordpress, type, rawSlug);
        if (wpDoc) {
          if (slugMatchesSource('wordpress', rawSlug, publicSlug) || rawSlug === publicSlug) {
            return { ...wpDoc, slug: publicSlug };
          }
        }
      } catch (err: unknown) {
        if (opts.onWordPressError === 'throw') {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[content] WordPress single-doc fetch failed for "${rawSlug}" (${msg}). Trying local Markdown.`);
      }
    }

    const mdDoc = await getMarkdownDocBySlug(opts.contentDir, type, rawSlug);
    if (mdDoc) {
      const unified = markdownToUnified(mdDoc);
      if (slugMatchesSource('markdown', rawSlug, publicSlug) || rawSlug === publicSlug) {
        return { ...unified, slug: publicSlug };
      }
    }
  }

  return null;
}

// ── Internal helpers ──

function getCandidateRawSlugs(publicSlug: string): string[] {
  const parts = publicSlug.split('-');
  const candidates = [publicSlug];
  if (parts.length > 1) {
    const lastSegment = parts[parts.length - 1];
    if (/^[0-9a-f]{3}$/.test(lastSegment ?? '')) {
      candidates.push(parts.slice(0, -1).join('-'));
    }
  }
  return candidates;
}

function slugMatchesSource(
  source: 'wordpress' | 'markdown',
  rawSlug: string,
  publicSlug: string,
): boolean {
  return buildSuffixedSlug(source, rawSlug) === publicSlug;
}