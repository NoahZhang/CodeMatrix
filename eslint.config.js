import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import * as tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  // Ignore build output
  {
    ignores: ['dist/**', 'dist-remote/**', 'release/**', 'node_modules/**'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript strict rules (non-type-checked to avoid perf cost in CI)
  ...tseslint.configs.strict,

  // React hooks rules for TSX files
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },

  // Custom strict rules
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Prevent `any` — use `unknown` instead
      '@typescript-eslint/no-explicit-any': 'error',

      // Require explicit return types on exported functions
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // No unused variables (underscore prefix allowed for intentional skips)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Consistency
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],

      // No console.log (allow warn/error for legitimate error reporting)
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Prevent non-null assertions (prefer explicit checks)
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // Store files use immer's `produce()` which provides a mutable draft where
  // `delete` on dynamic keys is the intended API for removing store entries.
  {
    files: ['src/store/**/*.ts'],
    rules: {
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },

  // CJS files (electron/preload.cjs): allow require(), CommonJS globals
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  eslintConfigPrettier,
];
