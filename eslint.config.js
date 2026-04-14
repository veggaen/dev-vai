import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/target/**',
      '**/.wxt/**',
      '**/.output/**',
      'Temporary_files/**',
      'scripts/**',
      'eval/**',
      'tests/**',
      '**/*.cjs',
      '**/out/**',
      'apps/vcus/**',
      'apps/extension/**',
      'apps/vscode-extension/**',
    ],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  {
    // Relaxed rules for test files and internal eval/analysis/AI-core code
    files: [
      '**/__tests__/**',
      '**/src/eval/**',
      '**/src/sessions/**',
      'packages/core/src/**',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-useless-assignment': 'warn',
      'no-empty': 'warn',
      'no-control-regex': 'warn',
    },
  },
);
