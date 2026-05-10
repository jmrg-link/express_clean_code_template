import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.dto.ts'],
    },
  },
  resolve: {
    alias: [
      { find: '#domain/shared/errors', replacement: path.resolve(__dirname, 'src/domain/shared/errors/index.ts') },
      { find: /^#config\/(.*)$/, replacement: path.resolve(__dirname, 'src/config') + '/$1' },
      { find: /^#domain\/(.*)$/, replacement: path.resolve(__dirname, 'src/domain') + '/$1' },
      { find: /^#application\/(.*)$/, replacement: path.resolve(__dirname, 'src/application') + '/$1' },
      { find: /^#infrastructure\/(.*)$/, replacement: path.resolve(__dirname, 'src/infrastructure') + '/$1' },
      { find: /^#presentation\/(.*)$/, replacement: path.resolve(__dirname, 'src/presentation') + '/$1' },
    ],
  },
});
