// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importAlias from '@limegrass/eslint-plugin-import-alias';

export default tseslint.config(
  {
    ignores: [
      'jest.config.cjs',
      'eslint.config.mjs',
      'dist/**',
      'node_modules/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  // Import-alias guard: deep relative paths (3+ `../`) must use a tsconfig
  // alias. Non-type-aware block on purpose — the rule only does path math.
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'data-source.ts'],
    plugins: {
      '@limegrass/import-alias': importAlias,
    },
    rules: {
      '@limegrass/import-alias/import-alias': [
        'error',
        {
          aliasConfigPath: 'tsconfig.json',
          // Allow `./`, `../` and `../../` (siblings); 3+ levels must be aliases.
          relativeImportOverrides: [
            { path: 'src', depth: 2 },
            { path: 'test', depth: 2 },
            { path: 'scripts', depth: 2 },
          ],
        },
      ],
    },
  },
);
