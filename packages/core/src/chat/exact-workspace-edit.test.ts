import { describe, expect, it } from 'vitest';
import {
  parseExactTextReplacement,
  renderExactReplaceAction,
  resolveExactWorkspaceEdit,
  resolveMissingClerkEnvWorkspaceEdit,
  resolveMissingConvexEnvWorkspaceEdit,
  resolveMmmHeroWorkspaceEdit,
} from './exact-workspace-edit.js';
import type { WorkspaceFilePort } from '../models/builder/council-codegen/index.js';

describe('exact workspace text edits', () => {
  it('parses a conservative quoted replacement request', () => {
    expect(parseExactTextReplacement(
      'Change the "Participate in a decentralized ecosystem" text to "Join the decentralized future".',
    )).toEqual({
      query: 'Participate in a decentralized ecosystem',
      replacement: 'Join the decentralized future',
    });
  });

  it('does not treat an ambiguous single quote as an executable replacement', () => {
    expect(parseExactTextReplacement('change the "hero text"')).toBeNull();
  });

  it('resolves only a unique case-sensitive workspace match', async () => {
    const workspace: WorkspaceFilePort = {
      describe: () => ({ name: 'mpm-frontend', external: true }),
      listFiles: async () => ['app/page.tsx'],
      readFile: async () => null,
      searchFiles: async () => ({
        files: [{
          path: 'app/page.tsx',
          matches: [{ line: 2696, column: 49, matchText: 'Participate in a decentralized ecosystem', preview: '<p>Participate...</p>' }],
        }],
        totalMatches: 1,
        filesScanned: 20,
        truncated: false,
      }),
    };

    const edit = await resolveExactWorkspaceEdit({
      workspace,
      projectId: 'project-1',
      prompt: 'Change "Participate in a decentralized ecosystem" to "Join the decentralized future".',
    });
    expect(edit?.path).toBe('app/page.tsx');
    expect(decodeURIComponent(renderExactReplaceAction(edit!).slice('{{replace:'.length, -2))).toContain(
      '"expectedReplacements":1',
    );
  });

  it('refuses a replacement with more than one match', async () => {
    const workspace: WorkspaceFilePort = {
      describe: () => ({ name: 'app', external: true }),
      listFiles: async () => [],
      readFile: async () => null,
      searchFiles: async () => ({
        files: [{ path: 'a.ts', matches: [] }, { path: 'b.ts', matches: [] }],
        totalMatches: 2,
        filesScanned: 2,
        truncated: false,
      }),
    };
    await expect(resolveExactWorkspaceEdit({
      workspace,
      projectId: 'project-1',
      prompt: 'Replace "old" with "new".',
    })).resolves.toBeNull();
  });

  it('resolves an MMM hero redesign as one bounded section replacement', async () => {
    const currentHero = `        <motion.section className="text-center mb-12">
          <FaEthereum />
          <h1>MrManMan (MMM) Token</h1>
          <p>Join the decentralized future</p>
        </motion.section>`;
    const page = [
      'export default function Page() {',
      '  return (',
      '    <main>',
      currentHero,
      '      <div id="participate">Participate form stays here</div>',
      '    </main>',
      '  );',
      '}',
    ].join('\n');
    const workspace: WorkspaceFilePort = {
      describe: () => ({ name: 'mpm-frontend', external: true }),
      listFiles: async () => ['app/page.tsx', 'app/layout.tsx'],
      readFile: async (projectId, path) => (path === 'app/page.tsx' ? page : null),
    };

    const edit = await resolveMmmHeroWorkspaceEdit({
      workspace,
      projectId: 'project-1',
      prompt: 'In app/page.tsx redesign the hero section for MMM token with better CTA and Sepolia trust stats.',
    });

    expect(edit?.path).toBe('app/page.tsx');
    expect(edit?.query).toBe(currentHero);
    expect(edit?.summary).toContain('MMM hero');
    expect(edit?.replacement).toContain('Participate in MMM');
    expect(edit?.replacement).toContain('Sepolia token launch');
    expect(edit?.replacement).toContain('Launch facts');
    expect(edit?.replacement).not.toContain('Launch console');
    expect(edit?.replacement).toContain('CONTRACT_ADDRESSES[activeNetwork]');
    expect(decodeURIComponent(renderExactReplaceAction(edit!).slice('{{replace:'.length, -2))).toContain(
      '"expectedReplacements":1',
    );
  });

  it('resolves a missing Convex env crash as a setup-required fallback patch', async () => {
    const convexFile = `"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/tanstack-react-start";
import { ReactNode } from "react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export { convex };
`;
    const workspace: WorkspaceFilePort = {
      describe: () => ({ name: 'dev-lawn', external: true }),
      listFiles: async () => ['src/lib/convex.tsx', 'src/main.tsx'],
      readFile: async (projectId, path) => (path === 'src/lib/convex.tsx' ? convexFile : null),
    };

    const edit = await resolveMissingConvexEnvWorkspaceEdit({
      workspace,
      projectId: 'project-1',
      prompt: 'The preview failed with Missing VITE_CONVEX_URL. Add a setup-required fallback and do not invent secrets.',
    });

    expect(edit?.path).toBe('src/lib/convex.tsx');
    expect(edit?.query).toBe(convexFile);
    expect(edit?.summary).toContain('setup-required');
    expect(edit?.replacement).toContain('function MissingConvexConfig');
    expect(edit?.replacement).toContain('Vai will not invent deployment URLs or secrets');
    expect(edit?.replacement).toContain('if (!convexUrl)');
    expect(edit?.replacement).not.toContain('throw new Error("Missing VITE_CONVEX_URL")');
    expect(decodeURIComponent(renderExactReplaceAction(edit!).slice('{{replace:'.length, -2))).toContain(
      '"expectedReplacements":1',
    );
  });

  it('resolves a missing Clerk env crash as one setup-required app config screen', async () => {
    const rootFile = `import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/tanstack-react-start";
import type { ReactNode } from "react";

import { ConvexClientProvider } from "@/lib/convex";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/ThemeToggle";
import { NotFound } from "@/components/ui/NotFound";
import appCss from "../app.css?url";

export const Route = createRootRoute({
  head: () => ({ meta: [], links: [] }),
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <RootDocument>{children}</RootDocument>
    </ClerkProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexClientProvider>
          <ThemeProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </ThemeProvider>
        </ConvexClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
`;
    const workspace: WorkspaceFilePort = {
      describe: () => ({ name: 'dev-lawn', external: true }),
      listFiles: async () => ['app/routes/__root.tsx', 'src/lib/convex.tsx'],
      readFile: async (projectId, path) => (path === 'app/routes/__root.tsx' ? rootFile : null),
    };

    const edit = await resolveMissingClerkEnvWorkspaceEdit({
      workspace,
      projectId: 'project-1',
      prompt: 'The preview failed with Missing VITE_CLERK_PUBLISHABLE_KEY. Add a setup-required fallback and do not invent secrets.',
    });

    expect(edit?.path).toBe('app/routes/__root.tsx');
    expect(edit?.query).toBe(rootFile);
    expect(edit?.summary).toContain('Clerk/Convex');
    expect(edit?.replacement).toContain('function MissingProjectConfig');
    expect(edit?.replacement).toContain('VITE_CLERK_PUBLISHABLE_KEY');
    expect(edit?.replacement).toContain('VITE_CONVEX_URL');
    expect(edit?.replacement).toContain('skipAppProviders');
    expect(edit?.replacement).not.toContain('throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY")');
    expect(decodeURIComponent(renderExactReplaceAction(edit!).slice('{{replace:'.length, -2))).toContain(
      '"expectedReplacements":1',
    );
  });
});
