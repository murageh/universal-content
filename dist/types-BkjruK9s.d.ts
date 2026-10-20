import { Redis, RedisOptions } from 'ioredis';

/**
 * src/types.ts
 *
 * Shared type definitions for vite-plugin-md-content.
 * Canonical types consumed by the Vite plugin, the Fastify adapter,
 * and applications using this package in the MURAGEH ecosystem (murageh.co.ke).
 */

/** The content "collections" this package understands out of the box. */
type ContentType = 'blog' | 'news' | 'projects';
/**
 * A document parsed from a local Markdown file.
 * All frontmatter keys are surfaced via the index signature.
 */
interface MarkdownDoc {
    /** File-system slug (filename without .md). */
    slug: string;
    title: string;
    date: string;
    category: string;
    author?: string | undefined;
    excerpt?: string | undefined;
    contentHtml: string;
    featuredImage?: string | undefined;
    image?: string | undefined;
    readingTime?: string | undefined;
    systemSize?: string | undefined;
    location?: string | undefined;
    featured?: boolean | undefined;
    eventRef?: string | undefined;
    /** Schema.org structured data extracted from trailing markdown blocks or frontmatter. */
    customJsonLd?: Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    [key: string]: unknown;
}
/**
 * Unified document shape that can originate from either Markdown or WordPress.
 * A superset of MarkdownDoc.
 */
interface UnifiedDoc extends MarkdownDoc {
    /** The original slug from the source (never collision-suffixed). */
    rawSlug: string;
    /** Which data source produced this document. */
    source: 'markdown' | 'wordpress';
    /** Always present (empty string when not provided). */
    excerpt: string;
}
/**
 * Options accepted by the Vite plugin (mdContentPlugin).
 */
type UniversalContentPluginOptions = MdContentPluginOptions;
interface MdContentPluginOptions {
    /**
     * Absolute path to the directory that contains your content collections.
     * Inside this directory, the plugin expects subdirectories named after
     * ContentType values: `blog/`, `news/`, `projects/`.
     *
     * @default `<vite root>/content`
     */
    contentDir?: string;
    /**
     * Content types (collections) to index.
     * @default ['blog', 'news', 'projects']
     */
    collections?: ContentType[];
    /**
     * Locale string used by formatDate().
     * @default 'en-KE'
     */
    dateLocale?: string;
    /**
     * When true, the plugin also exposes virtual modules for individual
     * documents: `virtual:md-content/blog/my-post-slug`.
     * @default true
     */
    virtualDocModules?: boolean;
}
interface WordPressOptions {
    /** WPGraphQL endpoint URL (e.g. https://cms.murageh.co.ke/graphql). */
    graphqlUrl: string;
    /** Shared secret sent as X-WP-API-Secret header. */
    apiSecret?: string;
    /**
     * Maps ContentType to the WPGraphQL connection field names.
     * Extend this when you add custom post types.
     */
    typeMap?: Partial<Record<ContentType, {
        listField: string;
        singleField: string;
    }>>;
    /**
     * Timeout in milliseconds for GraphQL requests.
     * @default 8000
     */
    timeoutMs?: number;
    /**
     * Number of retries with exponential backoff on network failure.
     * @default 3
     */
    maxRetries?: number;
}
/**
 * Accepts an instantiated ioredis client instance, connection options, or a connection URL.
 */
type RedisClientOrOptions = Redis | RedisOptions | string;

export type { ContentType as C, MdContentPluginOptions as M, RedisClientOrOptions as R, UnifiedDoc as U, WordPressOptions as W, MarkdownDoc as a, UniversalContentPluginOptions as b };
