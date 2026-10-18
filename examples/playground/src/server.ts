/**
 * src/server.ts
 *
 * Fastify v5 Server entry point for @crispice/universal-content SEO Playground.
 * Author: MURAGEH (murageh.co.ke).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import universalContentPlugin from '@crispice/universal-content/fastify';
import { MockDatabase } from './mock-db.js';
import sitemapRoute from './routes/sitemap.route.js';
import { seoRoute } from './routes/seo.route.js';
import { renderPlaygroundHtml } from './ui.js';

// Fastify Prisma decorator type augmentation
// FastifyInstance augmented in mock-db.ts

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServer() {
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
  });

  const rootDomain = process.env.ROOT_DOMAIN ?? 'murageh.co.ke';
  const contentDir = path.resolve(__dirname, '../content');

  // 1. Host application database decorator
  const mockDb = new MockDatabase();
  fastify.decorate('db', mockDb);
  fastify.decorate('authPrisma', mockDb);

  // 2. Register @crispice/universal-content with L1 LRU + optional L2 Redis
  // Notice enableSitemap is false: the host app controls /sitemap.xml!
  await fastify.register(universalContentPlugin, {
    contentDir,
    baseUrl: `https://${rootDomain}`,
    cache: true,
    cacheSize: 500,
    enableSitemap: false, // Preserves host app sitemap controller
    redis: process.env.REDIS_URL, // Auto-connects if REDIS_URL is provided, gracefully falls back if not
  });

  // 3. Register the host app's sitemap route (which pulls universalContent.getSitemapXmlChunk)
  await fastify.register(sitemapRoute, { rootDomain });

  // 4. Register dynamic SEO & Schema.org routes
  await fastify.register(seoRoute, { rootDomain });

  // Handle browser favicon cleanly
  fastify.get('/favicon.ico', async (_req, reply) => {
    return reply.code(204).send();
  });

  // 5. Visual Playground UI on GET /
  fastify.get('/', async (_req, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderPlaygroundHtml(rootDomain));
  });

  return fastify;
}

// Start server if executed directly
if (process.env.NODE_ENV !== 'test') {
  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  createServer()
    .then((server) => {
      server.listen({ port, host }, (err, address) => {
        if (err) {
          server.log.error(err);
          process.exit(1);
        }
        console.log(`\n🚀 Universal SEO Playground running at: ${address}`);
        console.log(`📍 Interactive Dashboard: ${address}/`);
        console.log(`📄 Combined Sitemap:     ${address}/sitemap.xml`);
        console.log(`🛍️  Product SEO Endpoint:  ${address}/api/seo/products/wireless-noise-canceling-headphones`);
        console.log(`📝 Blog SEO Endpoint:     ${address}/api/seo/blog/announcing-universal-content\n`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
