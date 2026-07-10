import type { WorkspaceFilePort } from '../models/builder/council-codegen/index.js';

export interface ExactTextReplacement {
  readonly query: string;
  readonly replacement: string;
}

export interface ResolvedExactWorkspaceEdit extends ExactTextReplacement {
  readonly path: string;
  readonly summary?: string;
  readonly details?: readonly string[];
}

const EDIT_VERB = /\b(?:change|replace|rename|update|swap)\b/i;
const QUOTED_TEXT = /"([^"\r\n]{1,500})"|'([^'\r\n]{1,500})'|`([^`\r\n]{1,500})`|“([^”\r\n]{1,500})”|‘([^’\r\n]{1,500})’/g;

/**
 * Conservative parser for the one edit that does not need a model to rewrite a
 * complete source file: replace one exact quoted literal with another.
 */
export function parseExactTextReplacement(prompt: string): ExactTextReplacement | null {
  if (!EDIT_VERB.test(prompt)) return null;
  const matches = [...prompt.matchAll(QUOTED_TEXT)];
  if (matches.length !== 2) return null;

  const first = matches[0];
  const second = matches[1];
  const between = prompt.slice((first.index ?? 0) + first[0].length, second.index ?? prompt.length);
  if (!/\b(?:to|with|into)\b|(?:->|→)/i.test(between)) return null;

  const query = first.slice(1).find((value) => typeof value === 'string')?.trim() ?? '';
  const replacement = second.slice(1).find((value) => typeof value === 'string')?.trim() ?? '';
  if (!query || !replacement || query === replacement) return null;
  return { query, replacement };
}

/**
 * Locate the exact literal in the designated workspace. The action is only
 * eligible when there is exactly one case-sensitive match in exactly one file.
 */
export async function resolveExactWorkspaceEdit(input: {
  readonly workspace: WorkspaceFilePort;
  readonly projectId: string;
  readonly prompt: string;
}): Promise<ResolvedExactWorkspaceEdit | null> {
  const replacement = parseExactTextReplacement(input.prompt);
  if (!replacement || !input.workspace.searchFiles) return null;

  const result = await input.workspace.searchFiles(input.projectId, {
    query: replacement.query,
    caseSensitive: true,
    regex: false,
    maxResults: 2,
  });
  if (result.totalMatches !== 1 || result.files.length !== 1) return null;
  const path = result.files[0]?.path?.replace(/\\/g, '/');
  if (!path) return null;
  return {
    ...replacement,
    path,
    summary: `Complete — updated ${path}.`,
    details: [
      `Replaced one exact text match.`,
      `Guarded the write so it only applies when the original text is still present exactly once.`,
    ],
  };
}

const HERO_EDIT_VERB = /\b(?:edit|update|change|improve|polish|refine|make|redesign|restyle|upgrade|tighten)\b/i;
const HERO_TARGET = /\b(?:hero|headline|subheadline|first\s+viewport|above\s+the\s+fold|cta|launch\s+section)\b/i;
const MMM_TARGET = /\b(?:mmm|mrmanman|token|sepolia|launch)\b/i;
const MISSING_CONVEX_ENV_TARGET = /\bVITE_CONVEX_URL\b/i;
const MISSING_CONVEX_REPAIR_INTENT = /\b(?:missing\s+env|missing\s+environment|setup[-\s]?required|fallback|repair|fix|preview\s+failed|stopped|crash(?:ed)?|do\s+not\s+invent|don't\s+invent)\b/i;
const MISSING_CLERK_ENV_TARGET = /\bVITE_CLERK_PUBLISHABLE_KEY\b/i;

function pickNamedOrLikelyPage(files: readonly string[], prompt: string): string | null {
  const normalizedPrompt = prompt.toLowerCase().replace(/\\/g, '/');
  const normalized = files.map((path) => path.replace(/\\/g, '/'));
  const explicitlyNamed = normalized.find((path) => normalizedPrompt.includes(path.toLowerCase()));
  if (explicitlyNamed) return explicitlyNamed;

  const basenameNamed = normalized.find((path) => {
    const base = path.split('/').pop();
    return Boolean(base && normalizedPrompt.includes(base.toLowerCase()));
  });
  if (basenameNamed) return basenameNamed;

  return normalized.find((path) => /^(?:src\/)?app\/page\.(?:tsx|jsx|ts|js)$/i.test(path))
    ?? normalized.find((path) => /^(?:src\/)?pages\/index\.(?:tsx|jsx|ts|js)$/i.test(path))
    ?? normalized.find((path) => /^src\/App\.(?:tsx|jsx|ts|js)$/i.test(path))
    ?? null;
}

function findMotionHeroSection(content: string): string | null {
  const anchorIndex = (() => {
    const needles = ['MrManMan (MMM) Token', 'MMM Token', 'MrManMan', 'Participate in MMM'];
    for (const needle of needles) {
      const idx = content.indexOf(needle);
      if (idx >= 0) return idx;
    }
    return -1;
  })();
  if (anchorIndex < 0) return null;

  const before = content.slice(0, anchorIndex);
  const sectionStart = Math.max(
    before.lastIndexOf('<motion.section'),
    before.lastIndexOf('<motion.header'),
    before.lastIndexOf('<section'),
    before.lastIndexOf('<header'),
  );
  if (sectionStart < 0) return null;

  const openTag = content.slice(sectionStart, sectionStart + 40);
  const tagMatch = openTag.match(/^<(?:(motion)\.)?(section|header)\b/);
  if (!tagMatch) return null;
  const closeTag = tagMatch[1] ? `</motion.${tagMatch[2]}>` : `</${tagMatch[2]}>`;
  const end = content.indexOf(closeTag, anchorIndex);
  if (end < 0) return null;
  const lineStart = content.lastIndexOf('\n', sectionStart) + 1;
  return content.slice(lineStart, end + closeTag.length);
}

function buildMmmHeroReplacement(currentSection: string): string | null {
  const indent = currentSection.match(/^\s*/)?.[0] ?? '';
  if (!/MrManMan|MMM Token/i.test(currentSection)) return null;

  return `${indent}<motion.section
${indent}          initial={{ opacity: 0, y: 18 }}
${indent}          animate={{ opacity: 1, y: 0 }}
${indent}          transition={{ duration: 0.6, ease: "easeOut" }}
${indent}          className="relative mb-14 overflow-visible px-6 py-16 sm:px-10 lg:px-14"
${indent}        >
${indent}          <div className="pointer-events-none absolute inset-0 -z-10">
${indent}            <div className="absolute left-1/2 top-0 h-[28rem] w-[54rem] -translate-x-1/2 rounded-full bg-violet-500/[0.10] blur-3xl" />
${indent}            <div className="absolute inset-x-16 top-8 h-px bg-gradient-to-r from-transparent via-violet-200/25 to-transparent" />
${indent}          </div>

${indent}          <div className="relative mx-auto grid max-w-6xl gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.72fr)] lg:items-end">
${indent}            <div className="text-left">
${indent}              <p className="mb-5 text-sm font-medium tracking-[0.18em] text-violet-200/70">
${indent}                Sepolia token launch · MMM
${indent}              </p>
${indent}              <h1 className="max-w-4xl text-5xl font-black leading-[0.94] tracking-[-0.06em] text-white sm:text-7xl lg:text-8xl">
${indent}                MrManMan
${indent}                <span className="block text-fuchsia-300">(MMM) Token</span>
${indent}              </h1>
${indent}              <p className="mt-7 max-w-2xl text-2xl font-semibold leading-tight tracking-[-0.035em] text-violet-100/82 sm:text-3xl">
${indent}                an on-chain token launch you can inspect.
${indent}              </p>
${indent}              <p className="mt-5 max-w-2xl text-base leading-8 text-violet-100/68 sm:text-lg">
${indent}                Track each phase on Sepolia, verify the contract, and participate through transparent wallet-native settlement.
${indent}              </p>

${indent}              <div className="mt-9 flex flex-wrap items-center gap-3">
${indent}                <a
${indent}                  href="#participate"
${indent}                  className="rounded-xl bg-white px-5 py-3 text-sm font-black text-[#12001f] transition hover:-translate-y-0.5 hover:bg-violet-100"
${indent}                >
${indent}                  Participate in MMM
${indent}                </a>
${indent}                <a
${indent}                  href={getExplorerBase(activeNetwork) + "/address/" + CONTRACT_ADDRESSES[activeNetwork]}
${indent}                  target="_blank"
${indent}                  rel="noopener noreferrer"
${indent}                  className="rounded-xl border border-white/14 px-5 py-3 text-sm font-semibold text-violet-100 transition hover:border-white/30 hover:bg-white/[0.035]"
${indent}                >
${indent}                  Verify contract
${indent}                </a>
${indent}              </div>
${indent}            </div>

${indent}            <aside className="border-y border-violet-100/14 py-5">
${indent}              <div className="mb-2 flex items-center justify-between">
${indent}                <p className="text-sm font-semibold text-violet-100">Launch facts</p>
${indent}                <span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-300">
${indent}                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
${indent}                  online
${indent}                </span>
${indent}              </div>
${indent}              <dl className="divide-y divide-violet-100/10">
${indent}                {[
${indent}                  ["Network", activeNetwork === 11155111 ? "Sepolia" : activeNetwork === 1 ? "Mainnet" : "Holesky"],
${indent}                  ["Symbol", "MMM"],
${indent}                  ["Launch blocks", TOTAL_BLOCKS.toLocaleString()],
${indent}                ].map(([label, value]) => (
${indent}                  <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 py-4">
${indent}                    <dt className="text-xs font-medium uppercase tracking-[0.18em] text-violet-100/45">{label}</dt>
${indent}                    <dd className="text-base font-bold text-white">{value}</dd>
${indent}                  </div>
${indent}                ))}
${indent}                <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 py-4">
${indent}                  <dt className="text-xs font-medium uppercase tracking-[0.18em] text-violet-100/45">Contract</dt>
${indent}                  <dd className="break-all font-mono text-xs leading-6 text-violet-50/70">
${indent}                    {CONTRACT_ADDRESSES[activeNetwork]}
${indent}                  </dd>
${indent}                </div>
${indent}              </dl>
${indent}            </aside>
${indent}          </div>
${indent}        </motion.section>`;
}

/**
 * Large real files cannot be faithfully regenerated by the local council. For
 * the live MMM failure mode, resolve the named page, replace only the hero JSX
 * section, and let the desktop exact-replace guard perform the write.
 */
export async function resolveMmmHeroWorkspaceEdit(input: {
  readonly workspace: WorkspaceFilePort;
  readonly projectId: string;
  readonly prompt: string;
}): Promise<ResolvedExactWorkspaceEdit | null> {
  if (!HERO_EDIT_VERB.test(input.prompt) || !HERO_TARGET.test(input.prompt) || !MMM_TARGET.test(input.prompt)) {
    return null;
  }

  let path: string | null = null;
  try {
    path = pickNamedOrLikelyPage(await input.workspace.listFiles(input.projectId), input.prompt);
  } catch {
    return null;
  }
  if (!path) return null;

  const content = await input.workspace.readFile(input.projectId, path);
  if (!content || content.length > 600_000 || content.includes('\u0000')) return null;

  const currentSection = findMotionHeroSection(content);
  if (!currentSection) return null;

  const replacement = buildMmmHeroReplacement(currentSection);
  if (!replacement || replacement === currentSection) return null;

  return {
    path,
    query: currentSection,
    replacement,
    summary: `Complete — updated the MMM hero in ${path}.`,
    details: [
      `Replaced only the hero JSX section.`,
      `Preserved wallet/connect, contract, and participation logic outside the hero.`,
      `Guarded the write so it aborts unless the original section still matches exactly once.`,
    ],
  };
}

function buildMissingConvexEnvReplacement(currentContent: string): string | null {
  if (!currentContent.includes('ConvexReactClient')) return null;
  if (!/Missing VITE_CONVEX_URL/i.test(currentContent)) return null;
  if (!/\bthrow\s+new\s+Error\(["']Missing VITE_CONVEX_URL["']\)/.test(currentContent)) return null;

  return `"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/tanstack-react-start";
import type { CSSProperties, ReactNode } from "react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = convexUrl
  ? new ConvexReactClient(convexUrl)
  : (null as unknown as ConvexReactClient);

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "2rem",
  color: "#f8fafc",
  background:
    "radial-gradient(circle at top left, rgba(132, 92, 255, 0.28), transparent 34rem), #0f0b18",
};

const cardStyle: CSSProperties = {
  width: "min(100%, 42rem)",
  padding: "2rem",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  borderRadius: "1.5rem",
  background: "rgba(15, 11, 24, 0.78)",
  boxShadow: "0 2rem 5rem rgba(0, 0, 0, 0.32)",
};

const codeStyle: CSSProperties = {
  display: "block",
  marginTop: "1rem",
  padding: "0.9rem 1rem",
  overflowX: "auto",
  borderRadius: "0.85rem",
  color: "#d8b4fe",
  background: "rgba(0, 0, 0, 0.32)",
};

function MissingConvexConfig() {
  return (
    <main style={shellStyle}>
      <section style={cardStyle}>
        <p style={{ margin: 0, color: "#c4b5fd", fontWeight: 700 }}>
          Setup required
        </p>
        <h1 style={{ margin: "0.55rem 0 0", fontSize: "clamp(2rem, 7vw, 4rem)", lineHeight: 0.95 }}>
          Add your Convex URL to run this project.
        </h1>
        <p style={{ marginTop: "1rem", color: "rgba(248, 250, 252, 0.74)", lineHeight: 1.7 }}>
          The preview is healthy now, but this app needs <strong>VITE_CONVEX_URL</strong> before
          it can connect to Convex. Vai will not invent deployment URLs or secrets.
        </p>
        <code style={codeStyle}>VITE_CONVEX_URL=https://your-deployment.convex.cloud</code>
        <p style={{ marginTop: "1rem", color: "rgba(248, 250, 252, 0.58)", fontSize: "0.92rem" }}>
          Add it to <code>.env.local</code>, restart the dev server, and the real app will render.
        </p>
      </section>
    </main>
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convexUrl) {
    return <MissingConvexConfig />;
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export { convex };
`;
}

/**
 * Repair the common external-project failure where a Convex provider throws at
 * module load because VITE_CONVEX_URL is not present. This is intentionally
 * narrow: it only touches src/lib/convex.tsx when the old top-level throw is
 * present, and the desktop exact-replace action still guards the write.
 */
export async function resolveMissingConvexEnvWorkspaceEdit(input: {
  readonly workspace: WorkspaceFilePort;
  readonly projectId: string;
  readonly prompt: string;
}): Promise<ResolvedExactWorkspaceEdit | null> {
  if (!MISSING_CONVEX_ENV_TARGET.test(input.prompt) || !MISSING_CONVEX_REPAIR_INTENT.test(input.prompt)) {
    return null;
  }

  let files: string[];
  try {
    files = await input.workspace.listFiles(input.projectId);
  } catch {
    return null;
  }

  const path = files
    .map((file) => file.replace(/\\/g, '/'))
    .find((file) => /^src\/lib\/convex\.tsx$/i.test(file))
    ?? files
      .map((file) => file.replace(/\\/g, '/'))
      .find((file) => /(?:^|\/)convex\.tsx$/i.test(file));
  if (!path) return null;

  const currentContent = await input.workspace.readFile(input.projectId, path);
  if (!currentContent || currentContent.length > 80_000 || currentContent.includes('\u0000')) return null;

  const replacement = buildMissingConvexEnvReplacement(currentContent);
  if (!replacement || replacement === currentContent) return null;

  return {
    path,
    query: currentContent,
    replacement,
    summary: `Complete — added a setup-required Convex env fallback in ${path}.`,
    details: [
      'Removed the top-level Missing VITE_CONVEX_URL crash.',
      'Rendered a clear setup-required screen instead of inventing a Convex deployment URL.',
      'Kept the real Convex provider path unchanged when VITE_CONVEX_URL is present.',
    ],
  };
}

function buildMissingClerkEnvReplacement(currentContent: string): string | null {
  if (!currentContent.includes('ClerkProvider')) return null;
  if (!/Missing VITE_CLERK_PUBLISHABLE_KEY/i.test(currentContent)) return null;
  if (!/\bthrow\s+new\s+Error\(["']Missing VITE_CLERK_PUBLISHABLE_KEY["']\)/.test(currentContent)) return null;

  return `import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/tanstack-react-start";
import type { CSSProperties, ReactNode } from "react";

import { ConvexClientProvider } from "@/lib/convex";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/ThemeToggle";
import { NotFound } from "@/components/ui/NotFound";
import appCss from "../app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "lawn — video review for creative teams" },
      {
        name: "description",
        content:
          "Video review and collaboration for creative teams. Frame-accurate comments, unlimited seats, $5/month flat. The open source Frame.io alternative.",
      },
      { property: "og:site_name", content: "lawn" },
      { name: "twitter:site", content: "@theo" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/grass-logo.svg?v=4" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=4" },
      { rel: "shortcut icon", href: "/favicon.ico?v=4" },
      { rel: "preconnect", href: "https://stream.mux.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://image.mux.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "//stream.mux.com" },
      { rel: "dns-prefetch", href: "//image.mux.com" },
    ],
  }),
  component: RootComponent,
  errorComponent: ({ error }) => {
    return (
      <main className="container mx-auto p-4 pt-16">
        <h1>Error</h1>
        <p>{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        {import.meta.env.DEV && error instanceof Error && error.stack ? (
          <pre className="w-full overflow-x-auto p-4">
            <code>{error.stack}</code>
          </pre>
        ) : null}
      </main>
    );
  },
  notFoundComponent: () => <NotFound />,
});

const setupShellStyle: CSSProperties = {
  minHeight: "100%",
  display: "grid",
  placeItems: "center",
  padding: "2rem",
  color: "#f8fafc",
  background:
    "radial-gradient(circle at 20% 10%, rgba(91, 141, 239, 0.28), transparent 28rem), #08130f",
};

const setupCardStyle: CSSProperties = {
  width: "min(100%, 46rem)",
  padding: "2rem",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  borderRadius: "1.35rem",
  background: "rgba(8, 19, 15, 0.82)",
  boxShadow: "0 2rem 5rem rgba(0, 0, 0, 0.28)",
};

const envBlockStyle: CSSProperties = {
  display: "block",
  marginTop: "1rem",
  padding: "1rem",
  whiteSpace: "pre-wrap",
  overflowX: "auto",
  borderRadius: "0.85rem",
  color: "#bbf7d0",
  background: "rgba(0, 0, 0, 0.34)",
};

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  const missingEnvVars = [
    !publishableKey ? "VITE_CLERK_PUBLISHABLE_KEY" : null,
    !convexUrl ? "VITE_CONVEX_URL" : null,
  ].filter((value): value is string => Boolean(value));

  if (missingEnvVars.length > 0) {
    return (
      <RootDocument skipAppProviders>
        <MissingProjectConfig missingEnvVars={missingEnvVars} />
      </RootDocument>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <RootDocument>{children}</RootDocument>
    </ClerkProvider>
  );
}

function MissingProjectConfig({ missingEnvVars }: { missingEnvVars: string[] }) {
  const envExample = missingEnvVars.map((name) => \`\${name}=...\`).join("\\n");

  return (
    <main style={setupShellStyle}>
      <section style={setupCardStyle}>
        <p style={{ margin: 0, color: "#86efac", fontWeight: 800 }}>
          Setup required
        </p>
        <h1 style={{ margin: "0.65rem 0 0", fontSize: "clamp(2.1rem, 7vw, 4.25rem)", lineHeight: 0.95 }}>
          Add the public app config to run lawn.
        </h1>
        <p style={{ marginTop: "1rem", color: "rgba(248, 250, 252, 0.74)", lineHeight: 1.7 }}>
          The preview server is running, but this project needs the environment variables below.
          Vai will not invent Clerk keys, Convex deployment URLs, Stripe keys, or other secrets.
        </p>
        <code style={envBlockStyle}>{envExample}</code>
        <p style={{ marginTop: "1rem", color: "rgba(248, 250, 252, 0.58)", fontSize: "0.92rem" }}>
          Add them to <code>.env.local</code>, restart the dev server, and the real app will render.
        </p>
      </section>
    </main>
  );
}

function RootDocument({
  children,
  skipAppProviders = false,
}: {
  children: ReactNode;
  skipAppProviders?: boolean;
}) {
  const themeInitScript = \`
    (() => {
      try {
        const stored = localStorage.getItem("lawn-theme");
        if (stored === "light" || stored === "dark") {
          document.documentElement.setAttribute("data-theme", stored);
          return;
        }
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
          document.documentElement.setAttribute("data-theme", "dark");
        }
      } catch {}
    })();
  \`;

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="h-full antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {skipAppProviders ? (
          children
        ) : (
          <ConvexClientProvider>
            <ThemeProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </ThemeProvider>
          </ConvexClientProvider>
        )}
        <Scripts />
      </body>
    </html>
  );
}
`;
}

/**
 * Repair the next common lawn failure: Clerk's publishable key is missing and
 * SSR throws before the app can render. The replacement produces one setup
 * screen that lists both known public blockers (Clerk + Convex) when absent.
 */
export async function resolveMissingClerkEnvWorkspaceEdit(input: {
  readonly workspace: WorkspaceFilePort;
  readonly projectId: string;
  readonly prompt: string;
}): Promise<ResolvedExactWorkspaceEdit | null> {
  if (!MISSING_CLERK_ENV_TARGET.test(input.prompt) || !MISSING_CONVEX_REPAIR_INTENT.test(input.prompt)) {
    return null;
  }

  let files: string[];
  try {
    files = await input.workspace.listFiles(input.projectId);
  } catch {
    return null;
  }

  const path = files
    .map((file) => file.replace(/\\/g, '/'))
    .find((file) => /^app\/routes\/__root\.tsx$/i.test(file))
    ?? files
      .map((file) => file.replace(/\\/g, '/'))
      .find((file) => /(?:^|\/)__root\.tsx$/i.test(file));
  if (!path) return null;

  const currentContent = await input.workspace.readFile(input.projectId, path);
  if (!currentContent || currentContent.length > 120_000 || currentContent.includes('\u0000')) return null;

  const replacement = buildMissingClerkEnvReplacement(currentContent);
  if (!replacement || replacement === currentContent) return null;

  return {
    path,
    query: currentContent,
    replacement,
    summary: `Complete — added a setup-required Clerk/Convex env fallback in ${path}.`,
    details: [
      'Removed the top-level Missing VITE_CLERK_PUBLISHABLE_KEY crash.',
      'Rendered one setup-required screen listing missing public env values.',
      'Kept ClerkProvider, Convex, theme, tooltip, and route rendering unchanged when env is present.',
    ],
  };
}

export function renderExactReplaceAction(edit: ResolvedExactWorkspaceEdit): string {
  const payload = encodeURIComponent(JSON.stringify({
    query: edit.query,
    replacement: edit.replacement,
    paths: [edit.path],
    expectedReplacements: 1,
    summary: edit.summary,
    details: edit.details,
  }));
  return `{{replace:${payload}}}`;
}
