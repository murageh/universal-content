import { W as WordPressOptions, C as ContentType, U as UnifiedDoc } from './types-CFpEjJJH.cjs';
import 'ioredis';

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

/**
 * Generates a stable 3-char hex suffix from source + rawSlug.
 * Used by the unified content layer to disambiguate slug collisions.
 */
declare function sourceHash(source: 'wordpress' | 'markdown', rawSlug: string): string;
/**
 * Appends a deterministic suffix to a slug.
 * Only call this when a collision has actually been detected.
 */
declare function buildSuffixedSlug(source: 'wordpress' | 'markdown', rawSlug: string): string;
/**
 * Fetches all published posts for a given content type.
 * Returns [] if the WPGraphQL endpoint is not reachable.
 */
declare function getWPAllDocs(options: WordPressOptions, type: ContentType): Promise<UnifiedDoc[]>;
/**
 * Fetches a single published post by its raw WordPress slug.
 * Returns null if the document does not exist.
 */
declare function getWPDocBySlug(options: WordPressOptions, type: ContentType, rawSlug: string): Promise<UnifiedDoc | null>;

export { ContentType, UnifiedDoc, WordPressOptions, buildSuffixedSlug, getWPAllDocs, getWPDocBySlug, sourceHash };
