import { z } from 'zod';

/** POST /api/search — bounded query length (matches prior handler) */
export const searchQueryBodySchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, 'Query is required')
      .max(1000, 'Query too long (max 1000 characters)'),
  })
  .strict();

/** POST /api/search/plan — no max length (preview only) */
export const searchPlanBodySchema = z
  .object({
    query: z.string().trim().min(1, 'Query is required'),
  })
  .strict();
