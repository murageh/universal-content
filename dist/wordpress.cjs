'use strict';

var crypto = require('crypto');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var crypto__default = /*#__PURE__*/_interopDefault(crypto);

// src/wordpress.ts
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

exports.buildSuffixedSlug = buildSuffixedSlug;
exports.getWPAllDocs = getWPAllDocs;
exports.getWPDocBySlug = getWPDocBySlug;
exports.sourceHash = sourceHash;
//# sourceMappingURL=wordpress.cjs.map
//# sourceMappingURL=wordpress.cjs.map