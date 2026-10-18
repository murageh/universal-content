import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index:     'src/index.ts',
    fastify:   'src/fastify.ts',
    wordpress: 'src/wordpress.ts',
    next:      'src/next.ts',
    seo:       'src/seo.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  // Do NOT bundle peer/optional deps so consumers can use their own versions.
  external: ['vite', 'fastify', 'ioredis'],
  splitting: false,
  treeshake: true,
});