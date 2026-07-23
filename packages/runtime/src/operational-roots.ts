import { existsSync } from 'node:fs';
import path from 'node:path';
import { PERSISTED_NAMES } from '@vai/constants';

export type OperationalRuntimeKind = 'source' | 'packaged' | 'unknown';
export type OperationalRootOrigin = 'explicit' | 'runtime-module' | 'database' | 'unavailable';

export interface OperationalRoot {
  readonly path?: string;
  readonly origin: OperationalRootOrigin;
  readonly error?: string;
}

export interface VaiOperationalRoots {
  readonly runtimeKind: OperationalRuntimeKind;
  readonly source: OperationalRoot;
  readonly buildEvidence: OperationalRoot;
  readonly userData: OperationalRoot & { readonly path: string };
}

export interface ResolveOperationalRootsOptions {
  readonly runtimeFile: string;
  readonly dbPath: string;
  readonly env?: NodeJS.ProcessEnv;
}

function isVaiSourceRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, PERSISTED_NAMES.agentsGuide))
    && existsSync(path.join(candidate, 'package.json'));
}

function isBuildEvidenceRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, PERSISTED_NAMES.buildManifest));
}

export function findVaiSourceRoot(start: string): string | undefined {
  let current = path.resolve(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (isVaiSourceRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function resolveExplicitRoot(
  raw: string | undefined,
  validate: (candidate: string) => boolean,
  label: string,
): OperationalRoot | undefined {
  if (raw === undefined) return undefined;
  const candidate = path.resolve(raw);
  if (validate(candidate)) return { path: candidate, origin: 'explicit' };
  return {
    origin: 'unavailable',
    error: `Explicit ${label} is invalid or incomplete: ${candidate}`,
  };
}

export function resolveVaiOperationalRoots(
  options: ResolveOperationalRootsOptions,
): VaiOperationalRoots {
  const env = options.env ?? process.env;
  const explicitSource = resolveExplicitRoot(
    env.VAI_SOURCE_ROOT,
    isVaiSourceRoot,
    'Vai source root',
  );
  const source = explicitSource ?? (() => {
    const discovered = findVaiSourceRoot(path.dirname(path.resolve(options.runtimeFile)));
    return discovered
      ? { path: discovered, origin: 'runtime-module' as const }
      : {
          origin: 'unavailable' as const,
          error: 'No Vai source checkout is attached to this runtime.',
        };
  })();

  const explicitEvidence = resolveExplicitRoot(
    env.VAI_BUILD_EVIDENCE_ROOT,
    isBuildEvidenceRoot,
    'build evidence root',
  );
  const buildEvidence = explicitEvidence ?? (() => {
    const candidate = path.resolve(
      path.dirname(path.resolve(options.runtimeFile)),
      '..',
      PERSISTED_NAMES.buildEvidenceFolder,
    );
    return isBuildEvidenceRoot(candidate)
      ? { path: candidate, origin: 'runtime-module' as const }
      : {
          origin: 'unavailable' as const,
          error: 'No embedded build evidence is attached to this runtime.',
        };
  })();

  const userDataPath = path.dirname(path.resolve(options.dbPath));
  const runtimeKind: OperationalRuntimeKind = source.path
    ? 'source'
    : buildEvidence.path
      ? 'packaged'
      : 'unknown';

  return {
    runtimeKind,
    source,
    buildEvidence,
    userData: { path: userDataPath, origin: 'database' },
  };
}
