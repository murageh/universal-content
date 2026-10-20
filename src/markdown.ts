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

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import type { MarkdownDoc, ContentType } from './types.js';

// Re-export the type so consumers only need one import.
export type { MarkdownDoc, ContentType };

// ── Helpers ──

function collectionDir(contentDir: string, type: ContentType): string {
  return path.join(contentDir, type);
}

/**
 * Processes raw Markdown content into an HTML string.
 * Uses remark + remark-gfm + remark-html (unsanitised to preserve HTML in .md files).
 */
export async function processMarkdown(content: string): Promise<string> {
  const result = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(content);
  return result.toString();
}

/**
 * Extracts trailing Schema.org JSON-LD code blocks from markdown content.
 * Strips the block from the content so it does not render into reader HTML,
 * and parses it into a structured object or array.
 */
function extractSchemaJsonLd(rawContent: string): {
  cleanContent: string;
  customJsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
} {
  const trimmed = rawContent.trimEnd();
  const trailingJsonBlockRegex = /```(?:json|ld\+json)?\s*\n([\s\S]*?)\n```$/;
  const match = trailingJsonBlockRegex.exec(trimmed);

  if (match && match[1]) {
    const candidate = match[1].trim();
    if (candidate.includes('schema.org')) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown> | Array<Record<string, unknown>>;
        if (typeof parsed === 'object' && parsed !== null) {
          const cleanContent = trimmed.slice(0, match.index).trimEnd();
          return { cleanContent, customJsonLd: parsed };
        }
      } catch {
        // If not valid JSON, leave content untouched
      }
    }
  }

  return { cleanContent: rawContent };
}

/**
 * Parses a single Markdown file into a MarkdownDoc.
 * @param filePath - absolute path to the .md file.
 * @param slug     - derived from the filename when not provided.
 */
export async function parseMarkdownFile(
  filePath: string,
  slug?: string,
): Promise<MarkdownDoc> {
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContents);

  const { cleanContent, customJsonLd } = extractSchemaJsonLd(content);
  const contentHtml = await processMarkdown(cleanContent);
  const derivedSlug = slug ?? path.basename(filePath, '.md');

  const frontmatterJsonLd = (data['customJsonLd'] ?? data['jsonLd']) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>
    | undefined;

  const doc: MarkdownDoc = {
    slug: derivedSlug,
    contentHtml,
    title:    typeof data['title'] === 'string' ? data['title'] : '',
    date:     typeof data['date'] === 'string' ? data['date'] : '',
    category: typeof data['category'] === 'string' ? data['category'] : '',
    excerpt:  typeof data['metaDescription'] === 'string' ? data['metaDescription'] : cleanContent.slice(0, 160),
    ...(customJsonLd || frontmatterJsonLd ? { customJsonLd: customJsonLd ?? frontmatterJsonLd } : {}),
    ...data,
  };

  return doc;
}

// ── Public API ──

/**
 * Returns all documents in a content collection, sorted newest-first.
 *
 * @param contentDir - absolute path to the content root.
 * @param type       - collection name.
 */
export async function getAllDocs(
  contentDir: string,
  type: ContentType,
): Promise<MarkdownDoc[]> {
  const dir = collectionDir(contentDir, type);

  if (!fs.existsSync(dir)) return [];

  const fileNames = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

  const docPromises = fileNames.map(async (fileName) => {
    const slug = fileName.replace(/\.md$/, '');
    try {
      return await parseMarkdownFile(path.join(dir, fileName), slug);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[markdown] Failed to parse file "${fileName}" in "${type}" collection (${msg}). Skipping.`);
      return null;
    }
  });

  const parsed = await Promise.all(docPromises);
  const docs = parsed.filter((d): d is MarkdownDoc => d !== null);

  return docs.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Fetches a single document by its slug.
 * Returns null if the file does not exist or fails to parse.
 *
 * @param contentDir - absolute path to the content root.
 * @param type       - collection name.
 * @param slug       - filename without the .md extension.
 */
export async function getDocBySlug(
  contentDir: string,
  type: ContentType,
  slug: string,
): Promise<MarkdownDoc | null> {
  const fullPath = path.join(collectionDir(contentDir, type), `${slug}.md`);
  if (!fs.existsSync(fullPath)) return null;

  try {
    return await parseMarkdownFile(fullPath, slug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[markdown] Error reading "${fullPath}" (${msg}).`);
    return null;
  }
}

/**
 * Formats an ISO date string using Intl.DateTimeFormat.
 *
 * @param dateStr   - ISO date string (e.g. "2026-09-01").
 * @param locale    - BCP 47 locale tag (defaults to 'en-KE').
 */
export function formatDate(dateStr: string, locale = 'en-KE'): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}