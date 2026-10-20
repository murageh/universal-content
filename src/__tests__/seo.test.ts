import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getSitemapEntries,
  getSitemapXmlChunk,
  generateSitemapXml,
  mergeSitemapUrlsets,
  parseSitemapXml,
  mergeSitemaps,
  generateEtag,
  getDocJsonLd,
  getDocMetaTags,
  mergeJsonLd,
  type SitemapEntry,
} from '../seo.js';
import { contentPlugin } from '../fastify.js';
import { createSitemapRouteHandler } from '../next.js';

describe('SEO & Sitemap Engine (@crispice/universal-content)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-seo-test-'));
    fs.mkdirSync(path.join(tmpDir, 'blog'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'blog', 'solar-savings.md'),
      `---
title: "Solar Savings in Kenya & East Africa"
date: "2026-10-18"
category: "Solar"
metaDescription: "Learn how solar saves money."
featuredImage: "https://murageh.co.ke/images/solar.jpg"
changefreq: "weekly"
priority: 0.8
---

# Solar Savings
Detailed breakdown of ROI.`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(tmpDir, 'projects', 'nairobi-mall.md'),
      `---
title: "Nairobi Mall Installation"
date: "2026-09-15"
category: "Commercial"
metaDescription: "Commercial project showcase."
---

# Nairobi Mall
500kW grid-tied system.`,
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getSitemapEntries and getSitemapXmlChunk', () => {
    it('extracts entries from content collections with canonical URLs and metadata', async () => {
      const entries = await getSitemapEntries(
        { contentDir: tmpDir },
        { baseUrl: 'https://murageh.co.ke' },
      );

      expect(entries.length).toBe(2);

      const blogEntry = entries.find((e) => e.slug === 'solar-savings');
      expect(blogEntry).toBeDefined();
      expect(blogEntry?.loc).toBe('https://murageh.co.ke/blog/solar-savings');
      expect(blogEntry?.lastmod).toBe('2026-10-18');
      expect(blogEntry?.changefreq).toBe('weekly');
      expect(blogEntry?.priority).toBe(0.8);
      expect(blogEntry?.images?.[0]?.url).toBe('https://murageh.co.ke/images/solar.jpg');

      const projectEntry = entries.find((e) => e.slug === 'nairobi-mall');
      expect(projectEntry).toBeDefined();
      expect(projectEntry?.loc).toBe('https://murageh.co.ke/projects/nairobi-mall');
      expect(projectEntry?.lastmod).toBe('2026-09-15');
      expect(projectEntry?.priority).toBe(0.7);
    });

    it('generates pre-formatted XML chunks ready to be appended without outer urlset', async () => {
      const chunk = await getSitemapXmlChunk(
        { contentDir: tmpDir },
        { baseUrl: 'https://murageh.co.ke' },
      );

      expect(chunk).not.toContain('<urlset');
      expect(chunk).not.toContain('<?xml');
      expect(chunk).toContain('<url>');
      expect(chunk).toContain('<loc>https://murageh.co.ke/blog/solar-savings</loc>');
      expect(chunk).toContain('</url>');
    });

    it('supports custom caching for XML chunks', async () => {
      const store = new Map<string, string>();
      const customCache = {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => {
          store.set(k, v);
        },
      };

      const chunk1 = await getSitemapXmlChunk(
        { contentDir: tmpDir },
        { baseUrl: 'https://murageh.co.ke', cache: customCache },
      );

      expect(store.has('seo:sitemap-chunk:https://murageh.co.ke')).toBe(true);
      expect(store.has('seo:sitemap-entries:https://murageh.co.ke')).toBe(true);

      // Hit cache
      const chunk2 = await getSitemapXmlChunk(
        { contentDir: tmpDir },
        { baseUrl: 'https://murageh.co.ke', cache: customCache },
      );

      expect(chunk1).toBe(chunk2);
    });
  });

  describe('mergeSitemapUrlsets (Host App Integration Pattern)', () => {
    it('seamlessly injects content URL chunks into existing host app sitemap XML', () => {
      // Host app existing XML builder (exact pattern provided by user)
      const rootDomain = 'sbu.co.ke';
      const platformUrls = [
        `https://${rootDomain}/`,
        `https://${rootDomain}/join`,
        `https://${rootDomain}/explore`,
      ];
      const shopUrls = [`https://nairobi-barbers.${rootDomain}`];
      const locs = [...platformUrls, ...shopUrls].map((u) => `  <url><loc>${u}</loc></url>`).join('\n');

      const hostBaseXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        locs,
        '</urlset>',
      ].join('\n');

      const contentChunk = `  <url>\n    <loc>https://${rootDomain}/blog/solar-tips</loc>\n  </url>`;

      const merged = mergeSitemapUrlsets(hostBaseXml, contentChunk);

      expect(merged).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(merged).toContain('<loc>https://sbu.co.ke/</loc>');
      expect(merged).toContain('<loc>https://nairobi-barbers.sbu.co.ke</loc>');
      expect(merged).toContain('<loc>https://sbu.co.ke/blog/solar-tips</loc>');
      expect(merged.endsWith('</urlset>')).toBe(true);

      // Parse back via XML processor
      const parsed = parseSitemapXml(merged);
      expect(parsed.length).toBe(5);
    });
  });

  describe('Fastify fastify.universalContent Decorator Integration', () => {
    it('decorates fastify with universalContent for non-intrusive host app integration', async () => {
      const app = Fastify();

      // Register plugin WITHOUT enableSitemap (so it does not take over /sitemap.xml)
      await app.register(contentPlugin, {
        contentDir: tmpDir,
        baseUrl: 'https://sbu.co.ke',
      });

      // Host app registers its OWN sitemap route using fastify.universalContent
      app.get('/sitemap.xml', async (_req, reply) => {
        // Query shops
        const shops = [{ slug: 'alpha-shop' }];
        const shopUrls = shops.map((s) => `https://${s.slug}.sbu.co.ke`);
        const locs = shopUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');

        const baseXml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          locs,
          '</urlset>',
        ].join('\n');

        // Retrieve pre-cached XML chunk from universalContent decorator
        const contentChunk = await app.universalContent.getSitemapXmlChunk();
        const mergedXml = mergeSitemapUrlsets(baseXml, contentChunk);

        return reply.type('application/xml').send(mergedXml);
      });

      const res = await app.inject({
        method: 'GET',
        url: '/sitemap.xml',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');

      const xml = res.body;
      expect(xml).toContain('<loc>https://alpha-shop.sbu.co.ke</loc>');
      expect(xml).toContain('<loc>https://sbu.co.ke/blog/solar-savings</loc>');
      expect(xml).toContain('<loc>https://sbu.co.ke/projects/nairobi-mall</loc>');
    });
  });

  describe('ETag and Caching Helpers', () => {
    it('generates consistent ETags for sitemap payloads', () => {
      const xml1 = '<urlset><url><loc>https://a.com</loc></url></urlset>';
      const xml2 = '<urlset><url><loc>https://a.com</loc></url></urlset>';
      const xml3 = '<urlset><url><loc>https://b.com</loc></url></urlset>';

      expect(generateEtag(xml1)).toBe(generateEtag(xml2));
      expect(generateEtag(xml1)).not.toBe(generateEtag(xml3));
    });
  });

  describe('Next.js Sitemap Route Handler', () => {
    it('serves sitemap XML via Web API Request/Response for Next.js App Router', async () => {
      const handler = createSitemapRouteHandler(
        { contentDir: tmpDir },
        {
          baseUrl: 'https://murageh.co.ke',
          customEntries: async () => [
            {
              loc: 'https://murageh.co.ke/services',
              priority: 0.9,
              type: 'custom',
              slug: 'services',
            },
          ],
        },
      );

      const req = new Request('https://murageh.co.ke/sitemap.xml');
      const res = await handler(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/xml');

      const xml = await res.text();
      expect(xml).toContain('<loc>https://murageh.co.ke/services</loc>');
      expect(xml).toContain('<loc>https://murageh.co.ke/blog/solar-savings</loc>');
    });
  });

  describe('Structured Data & Meta Tags for SEO', () => {
    it('generates valid Schema.org Article / BlogPosting JSON-LD', async () => {
      const jsonLd = getDocJsonLd(
        {
          slug: 'solar-savings',
          rawSlug: 'solar-savings',
          source: 'markdown',
          title: 'Solar Savings in Kenya',
          date: '2026-10-18',
          category: 'Solar',
          excerpt: 'Learn how solar saves money.',
          contentHtml: '<p>Content</p>',
          featuredImage: 'https://murageh.co.ke/images/solar.jpg',
        },
        {
          baseUrl: 'https://murageh.co.ke',
          siteName: 'MURAGEH Energy',
        },
      );

      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(jsonLd['@type']).toBe('BlogPosting');
      expect(jsonLd.headline).toBe('Solar Savings in Kenya');
      expect(jsonLd.datePublished).toBe('2026-10-18');
      expect(jsonLd.image).toBe('https://murageh.co.ke/images/solar.jpg');
      expect(jsonLd.mainEntityOfPage).toBe('https://murageh.co.ke/blog/solar-savings');
    });

    it('generates complete OpenGraph and Twitter meta tags', () => {
      const meta = getDocMetaTags(
        {
          slug: 'solar-savings',
          rawSlug: 'solar-savings',
          source: 'markdown',
          title: 'Solar Savings in Kenya',
          date: '2026-10-18',
          category: 'Solar',
          excerpt: 'Learn how solar saves money.',
          contentHtml: '<p>Content</p>',
          featuredImage: 'https://murageh.co.ke/images/solar.jpg',
        },
        {
          baseUrl: 'https://murageh.co.ke',
          siteName: 'MURAGEH Energy',
        },
      );

      expect(meta.title).toBe('Solar Savings in Kenya');
      expect(meta.canonicalUrl).toBe('https://murageh.co.ke/blog/solar-savings');
      expect(meta.openGraph['og:title']).toBe('Solar Savings in Kenya');
      expect(meta.openGraph['og:image']).toBe('https://murageh.co.ke/images/solar.jpg');
      expect(meta.twitter['twitter:card']).toBe('summary_large_image');
    });

    it('merges customJsonLd from doc into Schema.org @graph container', () => {
      const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'How do I book?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Book via WhatsApp or M-Pesa.',
            },
          },
        ],
      };

      const result = getDocJsonLd(
        {
          slug: 'solar-savings',
          rawSlug: 'solar-savings',
          source: 'markdown',
          title: 'Solar Savings in Kenya',
          date: '2026-10-18',
          category: 'Solar',
          excerpt: 'Learn how solar saves money.',
          contentHtml: '<p>Content</p>',
          featuredImage: 'https://murageh.co.ke/images/solar.jpg',
          customJsonLd: faqSchema,
        },
        {
          baseUrl: 'https://murageh.co.ke',
          siteName: 'MURAGEH Energy',
        },
      );

      expect(result['@context']).toBe('https://schema.org');
      expect('@graph' in result).toBe(true);
      const graph = (result as { '@graph': Array<Record<string, unknown>> })['@graph'];
      expect(graph).toHaveLength(2);
      expect(graph[0]?.['@type']).toBe('BlogPosting');
      expect(graph[1]?.['@type']).toBe('FAQPage');
      expect(graph[1]?.['@context']).toBeUndefined(); // Deduplicated context inside graph node
    });

    it('merges options.additionalJsonLd itemsets into Schema.org @graph container', () => {
      const itemListSchema = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Shop One',
          },
        ],
      };

      const result = getDocJsonLd(
        {
          slug: 'solar-savings',
          rawSlug: 'solar-savings',
          source: 'markdown',
          title: 'Solar Savings in Kenya',
          date: '2026-10-18',
          category: 'Solar',
          excerpt: 'Learn how solar saves money.',
          contentHtml: '<p>Content</p>',
        },
        {
          baseUrl: 'https://murageh.co.ke',
          siteName: 'MURAGEH Energy',
          additionalJsonLd: itemListSchema,
        },
      );

      expect(result['@context']).toBe('https://schema.org');
      expect('@graph' in result).toBe(true);
      const graph = (result as { '@graph': Array<Record<string, unknown>> })['@graph'];
      expect(graph).toHaveLength(2);
      expect(graph[0]?.['@type']).toBe('BlogPosting');
      expect(graph[1]?.['@type']).toBe('ItemList');
    });

    it('merges arbitrary JSON-LD structures via mergeJsonLd utility', () => {
      const base = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Styled By Us',
      };
      const extra = [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Styled By Us Kenya',
        },
        {
          '@type': 'LocalBusiness',
          name: 'Splittonne Barbershop',
        },
      ];

      const merged = mergeJsonLd(base, extra);
      expect(merged['@context']).toBe('https://schema.org');
      expect('@graph' in merged).toBe(true);
      const graph = (merged as { '@graph': Array<Record<string, unknown>> })['@graph'];
      expect(graph).toHaveLength(3);
      expect(graph.map((item) => item['@type'])).toEqual(['WebSite', 'Organization', 'LocalBusiness']);
    });
  });
});