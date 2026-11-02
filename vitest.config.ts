import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/core',
      'packages/db',
      'apps/adapter',
      'apps/dashboard',
    ],
  },
});
