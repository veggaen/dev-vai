import { describe, expect, it } from 'vitest';
import { extractBrowserRuntimeErrors } from './sandbox-runtime-validation.js';

describe('extractBrowserRuntimeErrors', () => {
  it('keeps real iframe runtime failures and drops browser noise', () => {
    const logs = [
      'ℹ [browser] [vite] connected.',
      'ℹ [browser] Download the React DevTools for a better development experience: https://react.dev/link/react-devtools',
      '✗ [browser] [Uncaught] Cannot read properties of undefined (reading \'map\') at http://localhost:5178/src/App.jsx:12',
      '✗ [browser] The above error occurred in the <App> component:',
      '⚠ [browser] Consider adding an error boundary to your tree to customize error handling behavior.',
    ];

    expect(extractBrowserRuntimeErrors(logs)).toEqual([
      '✗ [browser] [Uncaught] Cannot read properties of undefined (reading \'map\') at http://localhost:5178/src/App.jsx:12',
      '✗ [browser] The above error occurred in the <App> component:',
    ]);
  });
});