import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import { configs, config } from 'typescript-eslint';

export default config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/first': 'error',
      'import-x/no-named-as-default-member': 'off',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // CLAUDE.md layout rule: core never imports db, adapter, AWS or network libs.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@hisaab/db',
                '@hisaab/db/*',
                '@hisaab/adapter',
                '@hisaab/dashboard',
                '@aws-sdk/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'drizzle-kit',
                'pg',
                'axios',
                'undici',
                'node:fs',
                'node:fs/*',
                'node:http',
                'node:https',
                'node:net',
                'fs',
                'http',
                'https',
                'net',
              ],
              message:
                'packages/core must stay pure: no db, adapter, AWS, network or fs imports.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
