import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { contentPlugin } from '../fastify.js';

describe('Fastify Content Adapter (MURAGEH)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-fastify-test-'));
    fs.mkdirSync(path.join(tmpDir, 'blog'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'blog', 'first-post.md'),
      `---
title: "First MURAGEH Post"
date: "2026-10-18"
category: "Solar"
metaDescription: "A post excerpt"
---

# Hello MURAGEH
Welcome to the blog.`,
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves collection list with L1 LRU cache', async () => {
    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
      cache: true,
      cacheSize: 10,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/content/blog',
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].title).toBe('First MURAGEH Post');
    expect(data[0].slug).toBe('first-post');

    // Second hit tests LRU cache
    const cachedRes = await app.inject({
      method: 'GET',
      url: '/api/content/blog',
    });
    expect(cachedRes.statusCode).toBe(200);
    expect(cachedRes.json()[0].title).toBe('First MURAGEH Post');
  });

  it('serves single document by slug', async () => {
    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/content/blog/first-post',
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.slug).toBe('first-post');
    expect(data.contentHtml).toContain('Hello MURAGEH');
  });

  it('returns 404 for non-existent document', async () => {
    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/content/blog/missing-post',
    });

    expect(res.statusCode).toBe(404);
  });

  it('integrates with L2 Redis mock and persists across cache miss', async () => {
    const store = new Map<string, string>();
    const mockRedis = {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, val: string) => {
        store.set(key, val);
        return 'OK';
      },
      del: async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) count++;
        }
        return count;
      },
      scan: async (_cursor: string) => ['0', [] as string[]],
    };

    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
      // @ts-expect-error - testing with duck-typed Redis mock
      redis: mockRedis,
      redisTtl: 600,
    });

    // First request populates Redis
    const res1 = await app.inject({ method: 'GET', url: '/api/content/blog' });
    expect(res1.statusCode).toBe(200);
    expect(store.has('md-content:list:blog')).toBe(true);

    // Verify Redis has the JSON
    const stored = JSON.parse(store.get('md-content:list:blog')!);
    expect(stored[0].title).toBe('First MURAGEH Post');
  });

  it('authenticates webhook and invalidates cache', async () => {
    const store = new Map<string, string>();
    const mockRedis = {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, val: string) => {
        store.set(key, val);
        return 'OK';
      },
      del: async (...keys: string[]) => {
        for (const k of keys) store.delete(k);
        return keys.length;
      },
      scan: async () => ['0', []],
    };

    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
      // @ts-expect-error - testing with duck-typed Redis mock
      redis: mockRedis,
      enableWebhook: true,
      webhookSecret: 'murageh-secret-123',
      webhookWarmup: false, // disable async warmup in test
    });

    // Seed Redis cache
    store.set('md-content:list:blog', JSON.stringify([{ title: 'Old Data' }]));

    // 1. Webhook with wrong secret -> 401
    const resBad = await app.inject({
      method: 'POST',
      url: '/api/content/webhook',
      headers: { 'x-wp-webhook-secret': 'wrong' },
      payload: { postType: 'post' },
    });
    expect(resBad.statusCode).toBe(401);

    // 2. Webhook with correct secret -> 200 and invalidates Redis
    const resGood = await app.inject({
      method: 'POST',
      url: '/api/content/webhook',
      headers: { 'x-wp-webhook-secret': 'murageh-secret-123' },
      payload: { postType: 'post', slug: 'first-post' },
    });
    expect(resGood.statusCode).toBe(200);
    expect(resGood.json().invalidated).toBe(true);
    expect(store.has('md-content:list:blog')).toBe(false);
  });

  it('gracefully degrades to local Markdown when Redis errors', async () => {
    const brokenRedis = {
      get: async () => {
        throw new Error('Redis connection lost');
      },
      set: async () => {
        throw new Error('Redis connection lost');
      },
      del: async () => {
        throw new Error('Redis connection lost');
      },
      scan: async () => {
        throw new Error('Redis connection lost');
      },
    };

    const app = Fastify();
    await app.register(contentPlugin, {
      contentDir: tmpDir,
      // @ts-expect-error - testing resilient failure with erroring mock
      redis: brokenRedis,
    });

    // Should not crash Fastify or return 500; gracefully falls back to filesystem
    const res = await app.inject({ method: 'GET', url: '/api/content/blog' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].title).toBe('First MURAGEH Post');
  });
});