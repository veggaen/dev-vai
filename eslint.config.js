import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

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
      '.venv/**',
      '.codex-run/**',
      '_visible_audit/**',
      '_*.mjs',
      'Temporary_files/**',
      'artifacts/**',
      'reports/**',
      'MDS/**',
      'ztemp_mds/**',
      'screenshots/**',
      'test-screenshots/**',
      'tmp-vai-audit-test/**',
      'scripts/**',
      'eval/**',
      'tests/**',
      '**/*.cjs',
      '**/out/**',
      // Throwaway experiment / debug / one-off scripts — not shipped code.
      '**/bench/**',
      '.debug-*.mts',
      'temp-*.mjs',
      'temp-*.mts',
      'apps/vcus/**',
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
    // React hooks correctness for the React surfaces (desktop, extension popup/options).
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
