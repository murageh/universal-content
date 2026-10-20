'use strict';

var fs = require('fs');
var path = require('path');
var matter = require('gray-matter');
var remark = require('remark');
var remarkGfm = require('remark-gfm');
var remarkHtml = require('remark-html');
var crypto = require('crypto');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefault(fs);
var path__default = /*#__PURE__*/_interopDefault(path);
var matter__default = /*#__PURE__*/_interopDefault(matter);
var remarkGfm__default = /*#__PURE__*/_interopDefault(remarkGfm);
var remarkHtml__default = /*#__PURE__*/_interopDefault(remarkHtml);
var crypto__default = /*#__PURE__*/_interopDefault(crypto);

// src/markdown.ts
function collectionDir(contentDir, type) {
  return path__default.default.join(contentDir, type);
}
async function processMarkdown(content) {
  const result = await remark.remark().use(remarkGfm__default.default).use(remarkHtml__default.default, { sanitize: false }).process(content);
  return result.toString();
}
function extractSchemaJsonLd(rawContent) {
  const trimmed = rawContent.trimEnd();
  const trailingJsonBlockRegex = /```(?:json|ld\+json)?\s*\n([\s\S]*?)\n```$/;
  const match = trailingJsonBlockRegex.exec(trimmed);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (candidate.includes("schema.org")) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null) {
          const cleanContent = trimmed.slice(0, match.index).trimEnd();
          return { cleanContent, customJsonLd: parsed };
        }
      } catch {
      }
    }
  }
  return { cleanContent: rawContent };
}
async function parseMarkdownFile(filePath, slug) {
  const fileContents = fs__default.default.readFileSync(filePath, "utf8");
  const { data, content } = matter__default.default(fileContents);
  const { cleanContent, customJsonLd } = extractSchemaJsonLd(content);
  const contentHtml = await processMarkdown(cleanContent);
  const derivedSlug = slug ?? path__default.default.basename(filePath, ".md");
  const frontmatterJsonLd = data["customJsonLd"] ?? data["jsonLd"];
  const doc = {
    slug: derivedSlug,
    contentHtml,
    title: typeof data["title"] === "string" ? data["title"] : "",
    date: typeof data["date"] === "string" ? data["date"] : "",
    category: typeof data["category"] === "string" ? data["category"] : "",
    excerpt: typeof data["metaDescription"] === "string" ? data["metaDescription"] : cleanContent.slice(0, 160),
    ...customJsonLd || frontmatterJsonLd ? { customJsonLd: customJsonLd ?? frontmatterJsonLd } : {},
    ...data
  };
  return doc;
}
async function getAllDocs(contentDir, type) {
  const dir = collectionDir(contentDir, type);
  if (!fs__default.default.existsSync(dir)) return [];
  const fileNames = fs__default.default.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const docPromises = fileNames.map(async (fileName) => {
    const slug = fileName.replace(/\.md$/, "");
    try {
      return await parseMarkdownFile(path__default.default.join(dir, fileName), slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[markdown] Failed to parse file "${fileName}" in "${type}" collection (${msg}). Skipping.`);
      return null;
    }
  });
  const parsed = await Promise.all(docPromises);
  const docs = parsed.filter((d) => d !== null);
  return docs.sort((a, b) => a.date < b.date ? 1 : -1);
}
async function getDocBySlug(contentDir, type, slug) {
  const fullPath = path__default.default.join(collectionDir(contentDir, type), `${slug}.md`);
  if (!fs__default.default.existsSync(fullPath)) return null;
  try {
    return await parseMarkdownFile(fullPath, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[markdown] Error reading "${fullPath}" (${msg}).`);
    return null;
  }
}
function formatDate(dateStr, locale = "en-KE") {
  return new Date(dateStr).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}
var DEFAULT_TYPE_MAP = {
  blog: { listField: "posts", singleField: "postBy" },
  news: { listField: "newsItems", singleField: "newsItemBy" },
  projects: { listField: "projectItems", singleField: "projectItemBy" }
};
function sourceHash(source, rawSlug) {
  return crypto__default.default.createHash("sha256").update(`${source}:${rawSlug}`).digest("hex").slice(0, 3);
}
function buildSuffixedSlug(source, rawSlug) {
  return `${rawSlug}-${sourceHash(source, rawSlug)}`;
}
var POST_CORE_FIELDS = (
  /* graphql */
  `
  slug
  title
  date
  excerpt
  content
  categories { nodes { name } }
  featuredImage { node { sourceUrl altText } }
`
);
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function wpQuery(options, query, variables = {}) {
  const headers = { "Content-Type": "application/json" };
  if (options.apiSecret) {
    headers["X-WP-API-Secret"] = options.apiSecret;
  }
  const isNextJs = typeof globalThis.__NEXT_DATA__ !== "undefined" || process.env["NEXT_RUNTIME"] != null;
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 8e3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const fetchOptions = {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
        ...isNextJs ? { next: { tags: ["wordpress"] } } : {}
      };
      let response;
      try {
        response = await fetch(options.graphqlUrl, fetchOptions);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt < maxRetries) {
          await wait(attempt * 300);
          continue;
        }
        throw new Error(
          `[wordpress] GraphQL request failed: ${response.status} ${response.statusText}`
        );
      }
      const json = await response.json();
      if (json.errors?.length) {
        throw new Error(
          `[wordpress] GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`
        );
      }
      return json.data;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await wait(attempt * 300);
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[wordpress] WPGraphQL unreachable after ${maxRetries} attempts (${msg})`);
}
function mapNode(node) {
  const rawSlug = node.slug;
  return {
    slug: rawSlug,
    rawSlug,
    source: "wordpress",
    title: node.title,
    date: node.date,
    category: node.categories.nodes[0]?.name ?? "General",
    excerpt: (node.excerpt ?? "").replace(/<[^>]+>/g, "").replace(/\[&hellip;\]/g, "...").trim(),
    contentHtml: node.content,
    ...node.featuredImage?.node.sourceUrl !== void 0 ? { featuredImage: node.featuredImage.node.sourceUrl } : {}
  };
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
async function getWPAllDocs(options, type) {
  const map = { ...DEFAULT_TYPE_MAP, ...options.typeMap }[type];
  const query = (
    /* graphql */
    `
    query GetAll${capitalize(type)} {
      ${map.listField}(first: 100, where: { status: PUBLISH }) {
        nodes { ${POST_CORE_FIELDS} }
      }
    }
  `
  );
  const data = await wpQuery(options, query);
  return (data[map.listField]?.nodes ?? []).map(mapNode);
}
async function getWPDocBySlug(options, type, rawSlug) {
  const map = { ...DEFAULT_TYPE_MAP, ...options.typeMap }[type];
  const query = (
    /* graphql */
    `
    query GetSingle${capitalize(type)}($slug: String!) {
      ${map.singleField}(slug: $slug) { ${POST_CORE_FIELDS} }
    }
  `
  );
  const data = await wpQuery(options, query, { slug: rawSlug });
  const node = data[map.singleField];
  return node ? mapNode(node) : null;
}

// src/content.ts
function markdownToUnified(doc) {
  return {
    ...doc,
    rawSlug: doc.slug,
    source: "markdown",
    excerpt: doc.excerpt ?? ""
  };
}
function findCollisions(a, b) {
  const aSet = new Set(a.map((d) => d.rawSlug));
  const collisions = /* @__PURE__ */ new Set();
  for (const doc of b) {
    if (aSet.has(doc.rawSlug)) collisions.add(doc.rawSlug);
  }
  return collisions;
}
function resolveCollisions(docs, collisions) {
  return docs.map((doc) => {
    if (!collisions.has(doc.rawSlug)) return doc;
    return { ...doc, slug: buildSuffixedSlug(doc.source, doc.rawSlug) };
  });
}
async function getAllDocs2(opts, type) {
  const mdPromise = getAllDocs(opts.contentDir, type).then(
    (docs) => docs.map(markdownToUnified)
  );
  const wpPromise = opts.wordpress ? getWPAllDocs(opts.wordpress, type).catch((err) => {
    if (opts.onWordPressError === "throw") {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[content] WordPress fetch failed for "${type}" (${msg}). Falling back to local Markdown.`);
    return [];
  }) : Promise.resolve([]);
  const [wpDocs, mdDocs] = await Promise.all([wpPromise, mdPromise]);
  const collisions = findCollisions(wpDocs, mdDocs);
  return [
    ...resolveCollisions(wpDocs, collisions),
    ...resolveCollisions(mdDocs, collisions)
  ].sort((a, b) => a.date < b.date ? 1 : -1);
}
async function getDocBySlug2(opts, type, publicSlug) {
  const candidates = getCandidateRawSlugs(publicSlug);
  for (const rawSlug of candidates) {
    if (opts.wordpress) {
      try {
        const wpDoc = await getWPDocBySlug(opts.wordpress, type, rawSlug);
        if (wpDoc) {
          if (slugMatchesSource("wordpress", rawSlug, publicSlug) || rawSlug === publicSlug) {
            return { ...wpDoc, slug: publicSlug };
          }
        }
      } catch (err) {
        if (opts.onWordPressError === "throw") {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[content] WordPress single-doc fetch failed for "${rawSlug}" (${msg}). Trying local Markdown.`);
      }
    }
    const mdDoc = await getDocBySlug(opts.contentDir, type, rawSlug);
    if (mdDoc) {
      const unified = markdownToUnified(mdDoc);
      if (slugMatchesSource("markdown", rawSlug, publicSlug) || rawSlug === publicSlug) {
        return { ...unified, slug: publicSlug };
      }
    }
  }
  return null;
}
function getCandidateRawSlugs(publicSlug) {
  const parts = publicSlug.split("-");
  const candidates = [publicSlug];
  if (parts.length > 1) {
    const lastSegment = parts[parts.length - 1];
    if (/^[0-9a-f]{3}$/.test(lastSegment ?? "")) {
      candidates.push(parts.slice(0, -1).join("-"));
    }
  }
  return candidates;
}
function slugMatchesSource(source, rawSlug, publicSlug) {
  return buildSuffixedSlug(source, rawSlug) === publicSlug;
}
function escapeXml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function unescapeXml(escaped) {
  return escaped.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
async function getSitemapEntries(opts, options = {}) {
  const cacheKey = options.cacheKey ?? `seo:sitemap-entries:${options.baseUrl ?? "default"}`;
  if (options.cache) {
    try {
      const cached = await options.cache.get(cacheKey);
      if (typeof cached === "string" && cached.length > 0) {
        return JSON.parse(cached);
      }
    } catch {
    }
  }
  const collections = options.collections ?? ["blog", "news", "projects"];
  const base = options.baseUrl ? options.baseUrl.replace(/\/+$/, "") : "";
  const defaultPriorities = {
    blog: 0.8,
    news: 0.7,
    projects: 0.7,
    ...options.defaultPriority
  };
  const defaultFreqs = {
    blog: "weekly",
    news: "daily",
    projects: "monthly",
    ...options.defaultChangefreq
  };
  const allEntries = [];
  for (const type of collections) {
    const docs = await getAllDocs2(opts, type);
    const prefix = options.pathPrefixMap?.[type] ?? type;
    for (const doc of docs) {
      const loc = base ? `${base}/${prefix}/${doc.slug}` : `/${prefix}/${doc.slug}`;
      let lastmod = void 0;
      const rawDate = doc["lastmod"] ?? doc["updatedAt"] ?? doc["modified"] ?? doc.date;
      if (typeof rawDate === "string" && rawDate.length >= 10) {
        lastmod = rawDate.slice(0, 10);
      }
      let priority = defaultPriorities[type];
      if (typeof doc["priority"] === "number") {
        priority = doc["priority"];
      }
      let changefreq = defaultFreqs[type];
      if (typeof doc["changefreq"] === "string") {
        changefreq = doc["changefreq"];
      }
      const images = [];
      const rawImgUrl = doc.featuredImage ?? (typeof doc["image"] === "string" ? doc["image"] : void 0);
      if (rawImgUrl) {
        const resolvedUrl = !/^https?:\/\//i.test(rawImgUrl) && base ? `${base}${rawImgUrl.startsWith("/") ? "" : "/"}${rawImgUrl}` : rawImgUrl;
        const imgTitle = typeof doc["imageTitle"] === "string" ? doc["imageTitle"] : void 0;
        images.push({
          url: resolvedUrl,
          ...imgTitle !== void 0 ? { title: imgTitle } : {}
        });
      }
      allEntries.push({
        loc,
        ...lastmod !== void 0 ? { lastmod } : {},
        ...changefreq !== void 0 ? { changefreq } : {},
        ...priority !== void 0 ? { priority } : {},
        ...images.length > 0 ? { images } : {},
        type,
        slug: doc.slug
      });
    }
  }
  if (options.cache) {
    try {
      const ttl = options.cacheTtl ?? 3600;
      await options.cache.set(cacheKey, JSON.stringify(allEntries), ttl);
    } catch {
    }
  }
  return allEntries;
}
function generateSitemapXml(entries) {
  const hasImages = entries.some((e) => e.images && e.images.length > 0);
  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ""}>`
  ];
  for (const entry of entries) {
    xmlLines.push("  <url>");
    xmlLines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) {
      xmlLines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      xmlLines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    }
    if (entry.priority !== void 0) {
      xmlLines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    if (entry.images && entry.images.length > 0) {
      for (const img of entry.images) {
        xmlLines.push("    <image:image>");
        xmlLines.push(`      <image:loc>${escapeXml(img.url)}</image:loc>`);
        if (img.title) {
          xmlLines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
        }
        xmlLines.push("    </image:image>");
      }
    }
    xmlLines.push("  </url>");
  }
  xmlLines.push("</urlset>");
  return xmlLines.join("\n");
}
function parseSitemapXml(xml) {
  const entries = [];
  const urlRegex = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const locMatch = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(block);
    if (!locMatch || !locMatch[1]) continue;
    const loc = unescapeXml(locMatch[1].trim());
    const lastmodMatch = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block);
    const lastmod = lastmodMatch && lastmodMatch[1] ? unescapeXml(lastmodMatch[1].trim()) : void 0;
    const changefreqMatch = /<changefreq\b[^>]*>([\s\S]*?)<\/changefreq>/i.exec(block);
    const changefreq = changefreqMatch && changefreqMatch[1] ? unescapeXml(changefreqMatch[1].trim()) : void 0;
    const priorityMatch = /<priority\b[^>]*>([\s\S]*?)<\/priority>/i.exec(block);
    const priority = priorityMatch && priorityMatch[1] ? parseFloat(priorityMatch[1].trim()) : void 0;
    const images = [];
    const imgRegex = /<image:image\b[^>]*>([\s\S]*?)<\/image:image>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(block)) !== null) {
      const imgBlock = imgMatch[1] ?? "";
      const imgLocMatch = /<image:loc\b[^>]*>([\s\S]*?)<\/image:loc>/i.exec(imgBlock);
      if (imgLocMatch && imgLocMatch[1]) {
        const titleMatch = /<image:title\b[^>]*>([\s\S]*?)<\/image:title>/i.exec(imgBlock);
        images.push({
          url: unescapeXml(imgLocMatch[1].trim()),
          ...titleMatch && titleMatch[1] ? { title: unescapeXml(titleMatch[1].trim()) } : {}
        });
      }
    }
    entries.push({
      loc,
      ...lastmod !== void 0 ? { lastmod } : {},
      ...changefreq !== void 0 ? { changefreq } : {},
      ...priority !== void 0 && !isNaN(priority) ? { priority } : {},
      ...images.length > 0 ? { images } : {}
    });
  }
  return entries;
}
function mergeSitemaps(existingXmlOrEntries, newEntries) {
  const existing = typeof existingXmlOrEntries === "string" ? parseSitemapXml(existingXmlOrEntries) : existingXmlOrEntries;
  const map = /* @__PURE__ */ new Map();
  for (const entry of existing) {
    map.set(entry.loc, entry);
  }
  for (const entry of newEntries) {
    const current = map.get(entry.loc);
    map.set(entry.loc, { ...current, ...entry });
  }
  return generateSitemapXml(Array.from(map.values()));
}
function mergeJsonLd(base, additional) {
  const items = [];
  function addItem(item) {
    if ("@graph" in item && Array.isArray(item["@graph"])) {
      for (const subItem of item["@graph"]) {
        if (typeof subItem === "object" && subItem !== null) {
          addItem(subItem);
        }
      }
      return;
    }
    const { "@context": _ctx, ...rest } = item;
    items.push(rest);
  }
  const baseItems = Array.isArray(base) ? base : [base];
  for (const b of baseItems) {
    if (typeof b === "object" && b !== null) {
      addItem(b);
    }
  }
  const additionalItems = Array.isArray(additional) ? additional : [additional];
  for (const a of additionalItems) {
    if (typeof a === "object" && a !== null) {
      addItem(a);
    }
  }
  return {
    "@context": "https://schema.org",
    "@graph": items
  };
}
function getDocJsonLd(doc, options) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = `${base}/${doc.category.toLowerCase() === "news" ? "news" : "blog"}/${doc.slug}`;
  const type = options.articleType ?? (doc.category.toLowerCase() === "news" ? "NewsArticle" : "BlogPosting");
  const rawImage = doc.featuredImage ?? (typeof doc["image"] === "string" ? doc["image"] : void 0);
  const resolvedImage = rawImage ? !/^https?:\/\//i.test(rawImage) && base ? `${base}${rawImage.startsWith("/") ? "" : "/"}${rawImage}` : rawImage : void 0;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": type,
    headline: doc.title,
    mainEntityOfPage: url,
    ...doc.excerpt ? { description: doc.excerpt } : {},
    ...doc.date ? { datePublished: doc.date } : {},
    ...resolvedImage ? { image: resolvedImage } : {},
    ...doc.category ? { articleSection: doc.category } : {},
    author: {
      "@type": "Organization",
      name: options.authorName ?? options.siteName ?? "MURAGEH"
    }
  };
  if (options.siteName) {
    jsonLd.publisher = {
      "@type": "Organization",
      name: options.siteName,
      ...options.publisherLogo !== void 0 ? {
        logo: {
          "@type": "ImageObject",
          url: options.publisherLogo
        }
      } : {}
    };
  }
  const additional = options.additionalJsonLd ?? doc.customJsonLd;
  if (additional) {
    return mergeJsonLd(jsonLd, additional);
  }
  return jsonLd;
}
function getDocMetaTags(doc, options) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const canonicalUrl = `${base}/${doc.category.toLowerCase() === "news" ? "news" : "blog"}/${doc.slug}`;
  const rawImage = doc.featuredImage ?? options.defaultImage;
  const image = rawImage ? !/^https?:\/\//i.test(rawImage) && base ? `${base}${rawImage.startsWith("/") ? "" : "/"}${rawImage}` : rawImage : void 0;
  return {
    title: doc.title,
    description: doc.excerpt,
    canonicalUrl,
    openGraph: {
      "og:title": doc.title,
      "og:description": doc.excerpt,
      "og:url": canonicalUrl,
      "og:type": "article",
      ...options.siteName !== void 0 ? { "og:site_name": options.siteName } : {},
      ...image !== void 0 ? { "og:image": image } : {}
    },
    twitter: {
      "twitter:card": image ? "summary_large_image" : "summary",
      "twitter:title": doc.title,
      "twitter:description": doc.excerpt,
      ...image !== void 0 ? { "twitter:image": image } : {}
    }
  };
}

// src/next.ts
function mapWpType(raw) {
  const norm = raw.toLowerCase().replace(/[-_]/g, "");
  if (norm === "post" || norm === "posts" || norm === "blog") return "blog";
  if (norm.includes("news")) return "news";
  if (norm.includes("project")) return "projects";
  return "blog";
}
function createRevalidateHandler(options = {}) {
  return async (req) => {
    if (options.secret) {
      const headerSecret = req.headers.get("x-wp-webhook-secret") ?? req.headers.get("x-fastify-wp-secret");
      const url = new URL(req.url);
      const querySecret = url.searchParams.get("secret");
      if (headerSecret !== options.secret && querySecret !== options.secret) {
        return Response.json(
          { error: "Unauthorized: invalid or missing webhook secret" },
          { status: 401 }
        );
      }
    }
    let body = {};
    try {
      body = await req.json();
    } catch {
    }
    const postType = String(body["postType"] ?? body["post_type"] ?? "blog");
    const slug = body["slug"] != null ? String(body["slug"]) : body["post_name"] != null ? String(body["post_name"]) : void 0;
    const type = mapWpType(postType);
    if (options.onRevalidate) {
      await options.onRevalidate({
        type,
        postType,
        ...slug !== void 0 ? { slug } : {}
      });
    }
    return Response.json({
      revalidated: true,
      type,
      ...slug !== void 0 ? { slug } : {},
      tag: options.revalidateTag ?? "wordpress"
    });
  };
}
function createSitemapRouteHandler(opts, options = {}) {
  return async (_req) => {
    const contentEntries = await getSitemapEntries(opts, options);
    let custom = [];
    if (options.customEntries) {
      custom = await options.customEntries();
    }
    const all = [...custom, ...contentEntries];
    const xml = generateSitemapXml(all);
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400"
      }
    });
  };
}
async function getNextDocs(opts, type) {
  return getAllDocs2(opts, type);
}
async function getNextDocBySlug(opts, type, slug) {
  return getDocBySlug2(opts, type, slug);
}
async function getRawDocBySlug(opts, type, rawSlug) {
  const docs = await getAllDocs2(opts, type);
  return docs.find((d) => d.rawSlug === rawSlug) ?? null;
}

exports.createRevalidateHandler = createRevalidateHandler;
exports.createSitemapRouteHandler = createSitemapRouteHandler;
exports.formatDate = formatDate;
exports.generateSitemapXml = generateSitemapXml;
exports.getAllDocs = getAllDocs2;
exports.getDocBySlug = getDocBySlug2;
exports.getDocJsonLd = getDocJsonLd;
exports.getDocMetaTags = getDocMetaTags;
exports.getNextDocBySlug = getNextDocBySlug;
exports.getNextDocs = getNextDocs;
exports.getRawDocBySlug = getRawDocBySlug;
exports.getSitemapEntries = getSitemapEntries;
exports.getWPAllDocs = getWPAllDocs;
exports.getWPDocBySlug = getWPDocBySlug;
exports.mergeSitemaps = mergeSitemaps;
exports.parseSitemapXml = parseSitemapXml;
//# sourceMappingURL=next.cjs.map
//# sourceMappingURL=next.cjs.map