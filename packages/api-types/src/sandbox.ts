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
    baseVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

/** POST /api/sandbox/open-folder — open an existing local folder as an external project */
export const sandboxOpenFolderBodySchema = z
  .object({
    path: z.string().min(2).max(500),
  })
  .strict();

/** POST /api/sandbox/:id/run-command — run a package.json script (build/lint/test…) */
export const sandboxRunCommandBodySchema = z
  .object({
    script: z.string().min(1).max(64),
  })
  .strict();

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(120);

/** POST /api/sandbox/:id/env-local — write user-provided env values to .env.local */
export const sandboxEnvLocalBodySchema = z
  .object({
    values: z.record(envNameSchema, z.string().max(20_000)),
    restart: z.boolean().optional(),
  })
  .strict();

const searchOptionsShape = {
  query: z.string().min(1).max(500),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regex: z.boolean().optional(),
  maxResults: z.number().int().positive().max(2000).optional(),
};

/** POST /api/sandbox/:id/search — VS Code-style project text search */
export const sandboxSearchBodySchema = z.object(searchOptionsShape).strict();

/** POST /api/sandbox/:id/replace — search & replace across project files */
export const sandboxReplaceBodySchema = z
  .object({
    ...searchOptionsShape,
    query: z.string().min(1).max(100_000),
    replacement: z.string().max(100_000),
    paths: z.array(z.string()).max(500).optional(),
    /** Atomic guard for chat-driven micro-edits: mismatch means no files are written. */
    expectedReplacements: z.number().int().positive().max(2000).optional(),
  })
  .strict();

/** POST /api/sandbox/:id/switch-lane — move the app between dev | preview | production */
export const sandboxSwitchLaneBodySchema = z
  .object({
    lane: z.enum(['dev', 'preview', 'production']),
  })
  .strict();
