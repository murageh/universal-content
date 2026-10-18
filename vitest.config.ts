import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@crispice/universal-content/fastify': path.resolve(__dirname, './src/fastify.ts'),
      '@crispice/universal-content/seo': path.resolve(__dirname, './src/seo.ts'),
      '@crispice/universal-content/next': path.resolve(__dirname, './src/next.ts'),
      '@crispice/universal-content/wordpress': path.resolve(__dirname, './src/wordpress.ts'),
      '@crispice/universal-content': path.resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
  },
});
