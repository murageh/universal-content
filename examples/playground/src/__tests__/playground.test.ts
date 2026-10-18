import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';

describe('Universal Content Playground End-to-End Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the interactive playground visual dashboard on GET /', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Universal Content Engine');
    expect(res.payload).toContain('@crispice/universal-content');
  });

  it('serves merged sitemap combining Platform, Dynamic Catalog, and Markdown content on GET /sitemap.xml', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.headers['etag']).toBeDefined();

    const xml = res.payload;

    // Platform URLs
    expect(xml).toContain('<loc>https://murageh.co.ke/</loc>');
    expect(xml).toContain('<loc>https://murageh.co.ke/features</loc>');
    expect(xml).toContain('<loc>https://murageh.co.ke/catalog</loc>');

    // Dynamic Database Catalog Products
    expect(xml).toContain('<loc>https://murageh.co.ke/products/wireless-noise-canceling-headphones</loc>');
    expect(xml).toContain('<loc>https://murageh.co.ke/products/ergonomic-mechanical-keyboard</loc>');

    // @crispice/universal-content Markdown posts
    expect(xml).toContain('<loc>https://murageh.co.ke/blog/announcing-universal-content</loc>');
    expect(xml).toContain('<loc>https://murageh.co.ke/blog/high-speed-sitemaps-and-redis</loc>');

    // Standards-compliant XML wrapper
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml.endsWith('</urlset>')).toBe(true);
  });

  it('handles HTTP 304 Not Modified when client If-None-Match matches ETag', async () => {
    // 1. Initial request to obtain ETag
    const res1 = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
    });
    const etag = res1.headers['etag'];
    expect(etag).toBeDefined();

    // 2. Conditional request with matching If-None-Match
    const res2 = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: {
        'if-none-match': etag as string,
      },
    });

    expect(res2.statusCode).toBe(304);
    expect(res2.payload).toBe(''); // Zero egress bandwidth!
  });

  it('generates rich Product Schema.org JSON-LD and OpenGraph for catalog items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/seo/products/wireless-noise-canceling-headphones',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.product.name).toBe('AcousticPro Wireless Noise-Canceling Headphones');
    expect(body.jsonLd['@type']).toBe('Product');
    expect(body.jsonLd.offers.price).toBe(299);
    expect(body.metaTags.openGraph['og:title']).toContain('AcousticPro');
    expect(body.metaTags.canonicalUrl).toBe('https://murageh.co.ke/products/wireless-noise-canceling-headphones');
  });

  it('generates BlogPosting Schema.org JSON-LD for markdown posts via universalContent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/seo/blog/announcing-universal-content',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.doc.title).toContain('Announcing @crispice/universal-content');
    expect(body.jsonLd['@type']).toBe('BlogPosting');
    expect(body.jsonLd.headline).toContain('Announcing @crispice/universal-content');
    expect(body.metaTags.twitter['twitter:card']).toBe('summary_large_image');
  });

  it('provides real-time metrics and supports cache invalidation', async () => {
    // Invalidate cache
    const invRes = await app.inject({
      method: 'POST',
      url: '/api/seo/invalidate',
    });
    expect(invRes.statusCode).toBe(200);
    const invBody = JSON.parse(invRes.payload);
    expect(invBody.success).toBe(true);

    // First fetch after invalidation must be a cache MISS
    const missRes = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
    });
    expect(missRes.statusCode).toBe(200);
    expect(missRes.headers['x-cache-status']).toBe('MISS');

    // Next fetch must be a cache HIT
    const hitRes = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
    });
    expect(hitRes.statusCode).toBe(200);
    expect(hitRes.headers['x-cache-status']).toBe('HIT');

    // Metrics endpoint verifies URL count and cache stats
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/seo/metrics',
    });
    expect(metricsRes.statusCode).toBe(200);
    const metricsBody = JSON.parse(metricsRes.payload);
    expect(metricsBody.metrics.totalUrlCount).toBeGreaterThan(5);
  });
});
