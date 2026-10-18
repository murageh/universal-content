/**
 * src/__tests__/markdown.test.ts
 *
 * Unit tests for the core Markdown processing engine.
 * Uses vitest. No Vite/Next/Fastify runtime needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAllDocs, getDocBySlug, formatDate, processMarkdown } from '../markdown.js';

// ─── Temp fixture directory ───────────────────────────────────────────────────

const FIXTURE_DIR = join(tmpdir(), 'vite-plugin-md-content-test');
const BLOG_DIR = join(FIXTURE_DIR, 'blog');

const POST_1 = `---
title: "Test Post Alpha"
date: "2026-09-01"
category: "Testing"
metaDescription: "A test post about testing."
---

# Alpha

This is **alpha** content with a [link](https://murageh.co.ke).
`;

const POST_2 = `---
title: "Test Post Beta"
date: "2026-08-01"
category: "Testing"
---

Beta content.
`;

beforeAll(() => {
  mkdirSync(BLOG_DIR, { recursive: true });
  writeFileSync(join(BLOG_DIR, 'alpha.md'), POST_1, 'utf8');
  writeFileSync(join(BLOG_DIR, 'beta.md'), POST_2, 'utf8');
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('processMarkdown', () => {
  it('converts markdown to HTML', async () => {
    const html = await processMarkdown('# Hello\n\nWorld');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>World</p>');
  });

  it('renders GFM tables', async () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = await processMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
});

describe('getAllDocs', () => {
  it('returns all docs sorted newest-first', async () => {
    const docs = await getAllDocs(FIXTURE_DIR, 'blog');
    expect(docs).toHaveLength(2);
    expect(docs[0]?.slug).toBe('alpha'); // 2026-09-01 > 2026-08-01
    expect(docs[1]?.slug).toBe('beta');
  });

  it('maps frontmatter fields correctly', async () => {
    const docs = await getAllDocs(FIXTURE_DIR, 'blog');
    const alpha = docs.find((d) => d.slug === 'alpha');
    expect(alpha?.title).toBe('Test Post Alpha');
    expect(alpha?.date).toBe('2026-09-01');
    expect(alpha?.category).toBe('Testing');
    expect(alpha?.excerpt).toBe('A test post about testing.');
  });

  it('renders contentHtml', async () => {
    const docs = await getAllDocs(FIXTURE_DIR, 'blog');
    const alpha = docs.find((d) => d.slug === 'alpha');
    expect(alpha?.contentHtml).toContain('<strong>alpha</strong>');
    expect(alpha?.contentHtml).toContain('<a href="https://murageh.co.ke">link</a>');
  });

  it('returns [] for a non-existent collection', async () => {
    const docs = await getAllDocs(FIXTURE_DIR, 'news');
    expect(docs).toHaveLength(0);
  });
});

describe('getDocBySlug', () => {
  it('returns null for a missing slug', async () => {
    const doc = await getDocBySlug(FIXTURE_DIR, 'blog', 'does-not-exist');
    expect(doc).toBeNull();
  });

  it('returns the correct doc', async () => {
    const doc = await getDocBySlug(FIXTURE_DIR, 'blog', 'beta');
    expect(doc?.title).toBe('Test Post Beta');
    expect(doc?.contentHtml).toContain('Beta content');
  });
});

describe('formatDate', () => {
  it('formats dates with default locale (en-KE)', () => {
    const formatted = formatDate('2026-09-01');
    // Locale output varies; just check it includes the year and month-ish.
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/September|Sept/i);
  });

  it('respects a custom locale', () => {
    const formatted = formatDate('2026-09-01', 'en-US');
    expect(formatted).toMatch(/September/i);
    expect(formatted).toMatch(/2026/);
  });
});
