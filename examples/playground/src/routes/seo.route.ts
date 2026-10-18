/**
 * src/routes/seo.route.ts
 *
 * Dynamic SEO & Metadata API demonstrating how host apps generate
 * rich Schema.org JSON-LD and OpenGraph cards for both dynamic database items
 * (e.g. Products/Catalog) and universal markdown/WordPress content.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDocJsonLd, getDocMetaTags } from '@crispice/universal-content/seo';
import { sitemapMetrics, invalidateCombinedSitemap } from './sitemap.route.js';
import type { MockDatabase } from '../mock-db.js';

export const seoRoute: FastifyPluginAsync<{ rootDomain?: string }> = async (fastify, opts) => {
  const rootDomain = opts.rootDomain ?? process.env.ROOT_DOMAIN ?? 'murageh.co.ke';
  const dbClient = (fastify.db ?? fastify.authPrisma) as MockDatabase | undefined;

  // 1. Dynamic SEO for Product & Catalog entities (Host application database)
  fastify.get<{ Params: { slug: string } }>(
    '/api/seo/products/:slug',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = req.params;
      const product = await dbClient?.product.findUnique({ where: { slug } });

      if (!product) {
        return reply.code(404).send({ error: `Product not found: ${slug}` });
      }

      const canonicalUrl = `https://${rootDomain}/products/${product.slug}`;

      // Schema.org Product structured data for Google Rich Results
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description,
        image: product.featuredImage,
        category: product.category,
        offers: {
          '@type': 'Offer',
          price: product.price,
          priceCurrency: product.currency,
          availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: canonicalUrl,
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: product.rating,
          reviewCount: product.reviewCount,
        },
      };

      const metaTags = {
        title: `${product.name} | Official Store`,
        description: product.description,
        canonicalUrl,
        openGraph: {
          'og:title': product.name,
          'og:description': product.description,
          'og:url': canonicalUrl,
          'og:image': product.featuredImage,
          'og:type': 'product',
        },
        twitter: {
          'twitter:card': 'summary_large_image',
          'twitter:title': product.name,
          'twitter:description': product.description,
          'twitter:image': product.featuredImage,
        },
      };

      return reply.send({
        product,
        canonicalUrl,
        jsonLd,
        metaTags,
      });
    }
  );



  // 2. Dynamic SEO for Markdown/WordPress articles via universalContent
  fastify.get<{ Params: { slug: string } }>(
    '/api/seo/blog/:slug',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = req.params;
      const doc = await fastify.universalContent?.getDocBySlug('blog', slug);

      if (!doc) {
        return reply.code(404).send({ error: `Blog post not found: ${slug}` });
      }

      const baseUrl = `https://${rootDomain}`;
      const jsonLd = getDocJsonLd(doc, {
        baseUrl,
        siteName: 'MURAGEH Engineering & Architecture',
      });

      const metaTags = getDocMetaTags(doc, {
        baseUrl,
        siteName: 'MURAGEH',
      });

      return reply.send({
        doc: {
          slug: doc.slug,
          title: doc.title,
          date: doc.date,
          description: doc.description,
          category: doc['category'],
          tags: doc['tags'],
        },
        jsonLd,
        metaTags,
      });
    }
  );

  // 3. SEO & Sitemap Performance Metrics Endpoint
  fastify.get('/api/seo/metrics', async (_req, reply) => {
    const memory = process.memoryUsage();
    return reply.send({
      metrics: sitemapMetrics,
      cacheEfficiency: sitemapMetrics.totalRequests > 0
        ? `${(((sitemapMetrics.cacheHits + sitemapMetrics.etagHits304) / sitemapMetrics.totalRequests) * 100).toFixed(1)}%`
        : '100%',
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: (memory.rss / (1024 * 1024)).toFixed(2),
        heapUsedMb: (memory.heapUsed / (1024 * 1024)).toFixed(2),
      },
    });
  });

  // 4. Invalidation Trigger Endpoint
  fastify.post('/api/seo/invalidate', async (_req, reply) => {
    invalidateCombinedSitemap();
    await fastify.universalContent?.invalidateSitemapCache();
    return reply.send({
      success: true,
      message: 'Sitemap and SEO caches successfully purged. Next request will be a cold MISS.',
      timestamp: new Date().toISOString(),
    });
  });
};
