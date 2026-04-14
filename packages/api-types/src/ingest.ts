import { z } from 'zod';

/** Single-field URL bodies for /api/ingest/* */
export const ingestUrlBodySchema = z
  .object({
    url: z.string().min(1),
  })
  .strict();

export const ingestGitHubDeepBodySchema = z
  .object({
    url: z.string().min(1),
    maxFiles: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Chrome extension capture — not `.strict()` so older/newer extension builds
 * can add optional fields without breaking validation.
 */
export const captureExtensionBodySchema = z.object({
  type: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  content: z.string(),
  language: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/discover */
export const discoverBodySchema = z
  .object({
    url: z.string().min(1),
    maxPages: z.number().int().positive().optional(),
  })
  .strict();
