import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.{test,spec}.ts',
      'packages/*/src/**/*.{test,spec}.ts',
    ],
    exclude: [...configDefaults.exclude, 'apps/**'],
  },
});
