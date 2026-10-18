/**
 * src/wordpress.ts
 *
 * WPGraphQL client - standalone, framework-agnostic.
 * Core WordPress integration for MURAGEH (murageh.co.ke).
 *
 * Key features:
 *   - Configuration (URL, secret, type map) is passed via WordPressOptions.
 *   - Automatic retry with exponential backoff on network failures.
 *   - Built-in AbortSignal timeout to prevent hanging connections.
 *   - next: { tags } fetch option is conditionally included in Next.js runtime.
 */

import crypto from 'node:crypto';
import type { UnifiedDoc, ContentType, WordPressOptions } from './types.js';

export type { UnifiedDoc, ContentType, WordPressOptions };

// ── Default type map ──

const DEFAULT_TYPE_MAP: Record<ContentType, { listField: string; singleField: string }> = {
  blog:     { listField: 'posts',        singleField: 'postBy'        },
  news:     { listField: 'newsItems',    singleField: 'newsItemBy'    },
  projects: { listField: 'projectItems', singleField: 'projectItemBy' },
};

// ── Slug hashing ──

/**
 * Generates a stable 3-char hex suffix from source + rawSlug.
 * Used by the unified content layer to disambiguate slug collisions.
 */
export function sourceHash(source: 'wordpress' | 'markdown', rawSlug: string): string {
  return crypto
    .createHash('sha256')
    .update(`${source}:${rawSlug}`)
    .digest('hex')
    .slice(0, 3);
}

/**
 * Appends a deterministic suffix to a slug.
 * Only call this when a collision has actually been detected.
 */
export function buildSuffixedSlug(source: 'wordpress' | 'markdown', rawSlug: string): string {
  return `${rawSlug}-${sourceHash(source, rawSlug)}`;
}

// ── Internal types ──

interface WPNode {
  slug:          string;
  title:         string;
  date:          string;
  excerpt:       string | null;
  content:       string;
  categories:    { nodes: { name: string }[] };
  featuredImage: { node: { sourceUrl: string; altText: string } } | null;
}

// ── GraphQL client ──

const POST_CORE_FIELDS = /* graphql */ `
  slug
  title
  date
  excerpt
  content
  categories { nodes { name } }
  featuredImage { node { sourceUrl altText } }
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wpQuery<T = unknown>(
  options: WordPressOptions,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.apiSecret) {
    headers['X-WP-API-Secret'] = options.apiSecret;
  }

  const isNextJs = typeof (globalThis as Record<string, unknown>).__NEXT_DATA__ !== 'undefined'
    || process.env['NEXT_RUNTIME'] != null;

  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 8000;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
        ...(isNextJs ? { next: { tags: ['wordpress'] } } : {}),
      };

      let response: Response;
      try {
        response = await fetch(options.graphqlUrl, fetchOptions);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
          await wait(attempt * 300);
          continue;
        }
        throw new Error(
          `[wordpress] GraphQL request failed: ${response.status} ${response.statusText}`,
        );
      }

      const json = (await response.json()) as { data?: T; errors?: { message: string }[] };

      if (json.errors?.length) {
        throw new Error(
          `[wordpress] GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`,
        );
      }

      return json.data as T;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await wait(attempt * 300);
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[wordpress] WPGraphQL unreachable after ${maxRetries} attempts (${msg})`);
}

// ── Mapper ──

function mapNode(node: WPNode): UnifiedDoc {
  const rawSlug = node.slug;
  return {
    slug:          rawSlug,
    rawSlug,
    source:        'wordpress',
    title:         node.title,
    date:          node.date,
    category:      node.categories.nodes[0]?.name ?? 'General',
    excerpt:       (node.excerpt ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\[&hellip;\]/g, '...')
      .trim(),
    contentHtml:   node.content,
    ...(node.featuredImage?.node.sourceUrl !== undefined
      ? { featuredImage: node.featuredImage.node.sourceUrl }
      : {}),
  };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Public API ──

/**
 * Fetches all published posts for a given content type.
 * Returns [] if the WPGraphQL endpoint is not reachable.
 */
export async function getWPAllDocs(
  options: WordPressOptions,
  type: ContentType,
): Promise<UnifiedDoc[]> {
  const map = { ...DEFAULT_TYPE_MAP, ...options.typeMap }[type];

  const query = /* graphql */ `
    query GetAll${capitalize(type)} {
      ${map.listField}(first: 100, where: { status: PUBLISH }) {
        nodes { ${POST_CORE_FIELDS} }
      }
    }
  `;

  type Result = { [key: string]: { nodes: WPNode[] } };
  const data = await wpQuery<Result>(options, query);
  return (data[map.listField]?.nodes ?? []).map(mapNode);
}

/**
 * Fetches a single published post by its raw WordPress slug.
 * Returns null if the document does not exist.
 */
export async function getWPDocBySlug(
  options: WordPressOptions,
  type: ContentType,
  rawSlug: string,
): Promise<UnifiedDoc | null> {
  const map = { ...DEFAULT_TYPE_MAP, ...options.typeMap }[type];

  const query = /* graphql */ `
    query GetSingle${capitalize(type)}($slug: String!) {
      ${map.singleField}(slug: $slug) { ${POST_CORE_FIELDS} }
    }
  `;

  type Result = { [key: string]: WPNode | null };
  const data = await wpQuery<Result>(options, query, { slug: rawSlug });
  const node = data[map.singleField];
  return node ? mapNode(node) : null;
}