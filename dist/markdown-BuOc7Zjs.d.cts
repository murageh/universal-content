import { C as ContentType, a as MarkdownDoc } from './types-BkjruK9s.cjs';

/**
 * src/markdown.ts
 *
 * Core Markdown processing engine.
 * Framework-agnostic: works in Vite plugins, Node servers, and Fastify.
 * Part of the MURAGEH ecosystem (murageh.co.ke).
 *
 * Features:
 *   - `contentDir` is injected rather than hard-coded.
 *   - Configurable `dateLocale`.
 *   - Resilient file reading: ignores corrupt files without crashing the server.
 */

/**
 * Processes raw Markdown content into an HTML string.
 * Uses remark + remark-gfm + remark-html (unsanitised to preserve HTML in .md files).
 */
declare function processMarkdown(content: string): Promise<string>;
/**
 * Parses a single Markdown file into a MarkdownDoc.
 * @param filePath - absolute path to the .md file.
 * @param slug     - derived from the filename when not provided.
 */
declare function parseMarkdownFile(filePath: string, slug?: string): Promise<MarkdownDoc>;
/**
 * Returns all documents in a content collection, sorted newest-first.
 *
 * @param contentDir - absolute path to the content root.
 * @param type       - collection name.
 */
declare function getAllDocs(contentDir: string, type: ContentType): Promise<MarkdownDoc[]>;
/**
 * Fetches a single document by its slug.
 * Returns null if the file does not exist or fails to parse.
 *
 * @param contentDir - absolute path to the content root.
 * @param type       - collection name.
 * @param slug       - filename without the .md extension.
 */
declare function getDocBySlug(contentDir: string, type: ContentType, slug: string): Promise<MarkdownDoc | null>;
/**
 * Formats an ISO date string using Intl.DateTimeFormat.
 *
 * @param dateStr   - ISO date string (e.g. "2026-09-01").
 * @param locale    - BCP 47 locale tag (defaults to 'en-KE').
 */
declare function formatDate(dateStr: string, locale?: string): string;

export { getDocBySlug as a, processMarkdown as b, formatDate as f, getAllDocs as g, parseMarkdownFile as p };
