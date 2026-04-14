/**
 * Typed errors for boundaries and stores — prefer `instanceof` over string matching.
 * Keep hierarchy small; extend when a recovery path truly differs.
 */

export type VaiErrorCode = 'validation' | 'network' | 'auth' | 'build' | 'unknown';

export class VaiError extends Error {
  readonly code: VaiErrorCode;

  constructor(message: string, code: VaiErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VaiError';
    this.code = code;
  }
}

export class VaiValidationError extends VaiError {
  constructor(
    message: string,
    readonly issues?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, 'validation', options);
    this.name = 'VaiValidationError';
  }
}
