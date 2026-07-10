import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceEditContext,
  isExplicitlyExcludedWorkspacePath,
  isReadOnlyReferenceWorkspacePath,
  isSensitiveWorkspacePath,
  pickEditFilePaths,
  type WorkspaceFilePort,
} from './workspace-context.js';

const PROJECT_FILES = [
  'package.json',
  'components/Navbar.tsx',
  'components/Footer.tsx',
  'src/app/page.tsx',
  'src/app/layout.tsx',
  'src/app/globals.css',
  'pnpm-lock.yaml',
  'public/logo.png',
  'lib/utils.ts',
  '.env',
  '.env.local',
  'credentials.json',
  'certs/deployer.pem',
];

describe('pickEditFilePaths', () => {
  it('puts the file the user literally named first — full relative path', () => {
    const picked = pickEditFilePaths(PROJECT_FILES, 'In components/Navbar.tsx, change the navbar brand text "MPM" to "MPM Pro".');
    expect(picked[0]).toBe('components/Navbar.tsx');
  });

  it('elevates a basename-only mention above entry points', () => {
    const picked = pickEditFilePaths(PROJECT_FILES, 'Fix the broken import in Navbar.tsx please.');
    expect(picked[0]).toBe('components/Navbar.tsx');
  });

  it('keeps the exact MPM app/page.tsx target in Council context', () => {
    const files = [
      'app/actions/contractActions.ts',
      'app/config/index.tsx',
      'app/constants.ts',
      'app/context/index.tsx',
      'app/favicon.ico',
      'app/globals.css',
      'app/layout.tsx',
      'app/page.tsx',
      'components/AnimTrail.tsx',
      'components/ColorPicker.tsx',
    ];

    const picked = pickEditFilePaths(
      files,
      'Redesign the hero section in app/page.tsx and keep wallet/connect logic untouched.',
    );

    expect(picked[0]).toBe('app/page.tsx');
  });

  it('falls back to framework entry points for generic visual asks', () => {
    const picked = pickEditFilePaths(PROJECT_FILES, 'make the background fancier');
    expect(picked).toContain('src/app/page.tsx');
    expect(picked).toContain('src/app/globals.css');
  });

  it('never selects lockfiles or binary assets', () => {
    const picked = pickEditFilePaths(PROJECT_FILES, 'update pnpm-lock.yaml and logo.png', 10);
    expect(picked).not.toContain('pnpm-lock.yaml');
    expect(picked).not.toContain('public/logo.png');
  });

  it('never selects secrets even when the user explicitly names them', () => {
    const picked = pickEditFilePaths(PROJECT_FILES, 'Do not modify .env, .env.local, credentials.json, or certs/deployer.pem.', 20);
    expect(picked).not.toContain('.env');
    expect(picked).not.toContain('.env.local');
    expect(picked).not.toContain('credentials.json');
    expect(picked).not.toContain('certs/deployer.pem');
    expect(isSensitiveWorkspacePath('nested/.env.production')).toBe(true);
    expect(isSensitiveWorkspacePath('src/config.ts')).toBe(false);
  });

  it('does not mistake named do-not-touch files for edit targets', () => {
    const prompt = 'Add chain tooling. Do not modify src/app/page.tsx or lib/utils.ts; keep components/Footer.tsx untouched.';
    const picked = pickEditFilePaths(PROJECT_FILES, prompt, 20);
    expect(picked).not.toContain('src/app/page.tsx');
    expect(picked).not.toContain('lib/utils.ts');
    expect(picked).not.toContain('components/Footer.tsx');
    expect(isExplicitlyExcludedWorkspacePath('src/app/page.tsx', prompt)).toBe(true);
    expect(isExplicitlyExcludedWorkspacePath('package.json', prompt)).toBe(false);
  });

  it('recognizes named read-only references without excluding their context', () => {
    const prompt = 'Use MMM_Unified.sol and DEPLOYMENT_PARAMS.md as read-only references. Change package.json only.';
    expect(isReadOnlyReferenceWorkspacePath('MMM_Unified.sol', prompt)).toBe(true);
    expect(isReadOnlyReferenceWorkspacePath('DEPLOYMENT_PARAMS.md', prompt)).toBe(true);
    expect(isReadOnlyReferenceWorkspacePath('package.json', prompt)).toBe(false);
    expect(isExplicitlyExcludedWorkspacePath('MMM_Unified.sol', prompt)).toBe(false);
  });

  it('keeps read-only context but drops generic entry points when one editable file is declared', () => {
    