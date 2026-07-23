import type { z } from 'zod';

/** Fail closed when server output drifts from the shared process-boundary contract. */
export function assertResponseContract<T>(schema: z.ZodType<T>, value: unknown, boundary: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Response contract violation at ${boundary}: ${details}`);
}
