import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createRevalidateHandler,
  getNextDocs,
  getNextDocBySlug,
  getRawDocBySlug,
} from '../next.js';

describe('Next.js Integration (TDD)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-next-test-'));
    fs.mkdirSync(path.join(tmpDir, 'blog'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'blog', 'next-post.md'),
      `---
title: "Next.js App Router Post"
date: "2026-10-18"
category: "Engineering"
metaDescription: "Read on Next.js"
---

# Next.js Server Component Content
Rendered natively in Next.js.`,
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createRevalidateHandler', () => {
    it('rejects requests without the correct webhook secret', async () => {
      const handler = createRevalidateHandler({
        secret: 'next-secret-key',
      });

      // Missing header
      const req1 = new Request('https://murageh.co.ke/api/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postType: 'post', slug: 'my-post' }),
      });
      const res1 = await handler(req1);
      expect(res1.status).toBe(401);
      const data1 = await res1.json();
      expect(data1.error).toContain('Unauthorized');

      // Invalid header
      const req2 = new Request('https://murageh.co.ke/api/revalidate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wp-webhook-secret': 'wrong-key',
        },
        body: JSON.stringify({ postType: 'post', slug: 'my-post' }),
      });
      const res2 = await handler(req2);
      expect(res2.status).toBe(401);
    });

    it('revalidates and invokes callback when secret is valid', async () => {
      const onRevalidate = vi.fn();
      const handler = createRevalidateHandler({
        secret: 'next-secret-key',
        onRevalidate,
      });

      const req = new Request('https://murageh.co.ke/api/revalidate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wp-webhook-secret': 'next-secret-key',
        },
        body: JSON.stringify({ postType: 'post', slug: 'solar-guide' }),
      });

      const res = await handler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.revalidated).toBe(true);
      expect(json.type).toBe('blog');
      expect(json.slug).toBe('solar-guide');

      expect(onRevalidate).toHaveBeenCalledWith({
        type: 'blog',
        slug: 'solar-guide',
        postType: 'post',
      });
    });
  });

  describe('Next.js Content Getters', () => {
    it('retrieves collection documents in a Next.js environment', async () => {
      const docs = await getNextDocs({ contentDir: tmpDir }, 'blog');
      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('Next.js App Router Post');
      expect(docs[0].slug).toBe('next-post');
      expect(docs[0].rawSlug).toBe('next-post');
      expect(docs[0].source).toBe('markdown');
    });

    it('returns null when document does not exist (allowing Next.js notFound())', async () => {
      const doc = await getNextDocBySlug({ contentDir: tmpDir }, 'blog', 'missing-post');
      expect(doc).toBeNull();
    });

    it('retrieves document by raw slug with getRawDocBySlug', async () => {
      const doc = await getRawDocBySlug({ contentDir: tmpDir }, 'blog', 'next-post');
      expect(doc).not.toBeNull();
      expect(doc?.title).toBe('Next.js App Router Post');
      expect(doc?.rawSlug).toBe('next-post');
    });

    it('throws error when onWordPressError is "throw" and WP is unreachable', async () => {
      await expect(
        getNextDocs(
          {
            contentDir: tmpDir,
            wordpress: {
              graphqlUrl: 'http://127.0.0.1:54321/graphql-unreachable',
              maxRetries: 1,
              timeoutMs: 300,
            },
            onWordPressError: 'throw',
          },
          'blog',
        ),
      ).rejects.toThrow();
    });
  });
});