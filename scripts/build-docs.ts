import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPlaygroundHtml } from '../examples/playground/src/ui.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DOMAIN = 'playground.murageh.co.ke';
const DOCS_DIR = path.resolve(__dirname, '../docs');

export function buildStaticDocs() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  // 1. Generate index.html from live playground UI
  const html = renderPlaygroundHtml(ROOT_DOMAIN);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), html, 'utf-8');

  // 2. Generate CNAME for GitHub Pages custom domain routing
  fs.writeFileSync(path.join(DOCS_DIR, 'CNAME'), `${ROOT_DOMAIN}\n`, 'utf-8');

  // 3. Generate .nojekyll so GitHub Pages does not run Jekyll
  fs.writeFileSync(path.join(DOCS_DIR, '.nojekyll'), '', 'utf-8');

  // 4. Generate static sitemap.xml
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://${ROOT_DOMAIN}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/features</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/pricing</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/catalog</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/docs</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/contact</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/products/wireless-noise-canceling-headphones</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&amp;q=80</image:loc>
      <image:title>AcousticPro Wireless Noise-Canceling Headphones</image:title>
    </image:image>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/products/ergonomic-mechanical-keyboard</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&amp;q=80</image:loc>
      <image:title>ErgoMech Split Mechanical Keyboard</image:title>
    </image:image>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/products/ultrawide-curved-gaming-monitor</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&amp;q=80</image:loc>
      <image:title>PanoraView 34-inch Curved UltraWide Monitor</image:title>
    </image:image>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/products/developer-standing-desk</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?w=800&amp;q=80</image:loc>
      <image:title>ElevatePro Solid Walnut Electric Standing Desk</image:title>
    </image:image>
  </url>
  <url>
    <loc>https://${ROOT_DOMAIN}/blog/announcing-universal-content</loc>
    <lastmod>2026-10-18</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://${ROOT_DOMAIN}/assets/universal-content-banner.png</image:loc>
      <image:title>Announcing @crispice/universal-content: Multi-Tier Content Engine</image:title>
    </image:image>
  </url>
</urlset>`;
  fs.writeFileSync(path.join(DOCS_DIR, 'sitemap.xml'), sitemapXml, 'utf-8');

  console.log(`[build-docs] Successfully generated static docs in ${DOCS_DIR}`);
}

buildStaticDocs();
