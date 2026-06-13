/**
 * Canonical dependency versions for sandbox templates & stack scaffolds.
 * Keep in sync with scripts/gen-lockfiles.mjs when regenerating lockfiles.
 */
export const TV = {
  react: '^19.2.4',
  reactDom: '^19.2.4',
  next: '^16.2.2',
  vite: '^8.0.4',
  typescript: '^6.0.2',
  framerMotion: '^12.34.0',
  lucideReact: '^1.7.0',
  clsx: '^2.1.1',
  tailwindMerge: '^3.5.0',
  tailwindcss: '^4.2.2',
  tailwindcssVite: '^4.2.2',
  tailwindcssPostcss: '^4.2.2',
  pluginReact: '^6.0.1',
  pluginVue: '^6.0.1',
  pluginSvelte: '^6.0.0',
  typesReact: '^19.2.14',
  typesReactDom: '^19.2.3',
  typesNode: '^25.5.2',
  zod: '^4.3.0',
  vitest: '^4.0.0',
  postcss: '^8.5.0',
  vue: '^3.5.13',
  svelte: '^5.19.0',
  solidJs: '^1.9.0',
  astro: '^5.7.0',
  express: '^4.21.2',
  fastify: '^5.2.0',
  tsx: '^4.19.0',
} as const;

/** Human-readable labels for gallery / descriptions */
export const TV_LABELS = {
  reactVite: `React 19 · Vite 8 · Tailwind v4 · TypeScript 6 · lucide-react · dark theme`,
  nextjs: `Next.js 16 · App Router · Tailwind v4 · TypeScript · lucide-react · dark theme`,
} as const;
