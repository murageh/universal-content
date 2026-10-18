/**
 * src/plugin.ts
 *
 * Vite plugin for @crispice/universal-content.
 *
 * Exposes virtual modules to your Vite app:
 *   - virtual:content/<type>         (e.g. virtual:content/blog)
 *   - virtual:content/<type>/<slug>  (e.g. virtual:content/blog/solar-tips)
 * Also supports legacy prefix `virtual:md-content/` for backwards compatibility.
 *
 * Watches content directory and triggers instant HMR on changes.
 */

import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { getAllDocs, getDocBySlug } from './content.js';
import type { MdContentPluginOptions, ContentType } from './types.js';

const VIRTUAL_PREFIXES = ['virtual:content/', 'virtual:md-content/'];
const RESOLVED_PREFIX = '\0virtual:content/';

const VALID_TYPES: ContentType[] = ['blog', 'news', 'projects'];

export type UniversalContentPluginOptions = MdContentPluginOptions;

export function universalContentPlugin(options: UniversalContentPluginOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig;

  const collections: ContentType[] = options.collections ?? VALID_TYPES;
  const enableDocModules = options.virtualDocModules ?? true;

  function getContentDir(root: string): string {
    return options.contentDir ?? path.join(root, 'content');
  }

  function getSubPath(id: string): string | null {
    for (const prefix of VIRTUAL_PREFIXES) {
      if (id.startsWith(prefix)) {
        return id.slice(prefix.length);
      }
    }
    return null;
  }

  return {
    name: '@crispice/universal-content',
    enforce: 'pre',

    configResolved(config) {
      resolvedConfig = config;
    },

    resolveId(id) {
      const subPath = getSubPath(id);
      if (!subPath) return;

      const parts = subPath.split('/');
      const type = parts[0] as ContentType;

      if (!VALID_TYPES.includes(type)) {
        return;
      }

      // Collection index: virtual:content/blog
      if (parts.length === 1) {
        return `${RESOLVED_PREFIX}${subPath}`;
      }

      // Single-doc: virtual:content/blog/my-slug
      if (enableDocModules && parts.length === 2) {
        return `${RESOLVED_PREFIX}${subPath}`;
      }
    },

    async load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return;

      const inner = id.slice(RESOLVED_PREFIX.length);
      const parts = inner.split('/');
      const type = parts[0] as ContentType;

      if (!collections.includes(type)) return;

      const contentDir = getContentDir(resolvedConfig.root);
      const opts = { contentDir };

      // Collection index
      if (parts.length === 1) {
        const docs = await getAllDocs(opts, type);
        return `export default ${JSON.stringify(docs, null, 2)};`;
      }

      // Single document
      if (enableDocModules && parts.length === 2) {
        const slug = parts[1];
        const doc = await getDocBySlug(opts, type, slug ?? '');
        return `export default ${JSON.stringify(doc, null, 2)};`;
      }
    },

    configureServer(server) {
      const contentDir = getContentDir(resolvedConfig.root);

      server.watcher.add(contentDir);

      server.watcher.on('change', (file) => {
        if (!file.startsWith(contentDir)) return;

        const rel = path.relative(contentDir, file);
        const type = rel.split(path.sep)[0] as ContentType;

        if (!VALID_TYPES.includes(type)) return;

        const indexId = `${RESOLVED_PREFIX}${type}`;
        const indexMod = server.moduleGraph.getModuleById(indexId);
        if (indexMod) {
          server.moduleGraph.invalidateModule(indexMod);
          server.hot.send({ type: 'full-reload' });
        }

        server.moduleGraph.idToModuleMap.forEach((mod, modId) => {
          if (modId.startsWith(`${RESOLVED_PREFIX}${type}/`)) {
            server.moduleGraph.invalidateModule(mod);
          }
        });
      });
    },

    async buildEnd() {
      if (resolvedConfig?.command !== 'build') return;

      const contentDir = getContentDir(resolvedConfig.root);

      for (const type of collections) {
        const docs = await getAllDocs({ contentDir }, type);
        this.emitFile({
          type:     'asset',
          fileName: `_content/${type}.json`,
          source:   JSON.stringify(docs, null, 2),
        });
      }
    },
  };
}

// Alias for backwards compatibility
export const mdContentPlugin = universalContentPlugin;