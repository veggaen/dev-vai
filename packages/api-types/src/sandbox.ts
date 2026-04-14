import { z } from 'zod';

const fileWriteSchema = z
  .object({
    path: z.string(),
    content: z.string(),
  })
  .strict();

/** POST /api/sandbox/deploy */
export const sandboxDeployBodySchema = z
  .object({
    stackId: z.string().min(1),
    tier: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();

/** POST /api/sandbox/from-template */
export const sandboxFromTemplateBodySchema = z
  .object({
    templateId: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();

/** POST /api/sandbox */
export const sandboxCreateBodySchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

/** POST /api/sandbox/:id/files */
export const sandboxWriteFilesBodySchema = z
  .object({
    files: z.array(fileWriteSchema),
  })
  .strict();
