import type { ExtractedFile } from './file-extractor.js';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function hasBrowserPreviewEntrypoint(paths: string[]): boolean {
  return paths.some((filePath) => (
    filePath === 'index.html'
    || /^src\/main\.(?:tsx|jsx|ts|js|svelte)$/.test(filePath)
    || /^src\/app\.(?:tsx|jsx|ts|js|svelte)$/.test(filePath)
    || /^src\/app\/page\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || /^src\/app\/layout\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || /^src\/pages\/index\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || /^pages\/index\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || /^app\/page\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || /^app\/layout\.(?:tsx|jsx|ts|js)$/.test(filePath)
    || filePath === 'src/app.tsx'
    || filePath === 'src/app.jsx'
    || filePath === 'src/main.tsx'
    || filePath === 'src/main.jsx'
  ));
}

export function isNonPreviewableCodeFileSet(files: ExtractedFile[]): boolean {
  const paths = files.map((file) => normalizePath(file.path));
  const pathSet = new Set(paths);
  const packageJson = files.find((file) => normalizePath(file.path) === 'package.json')?.content ?? '';
  const hasThemeJson = paths.some((filePath) => /^themes\/.+\.json$/.test(filePath));
  const isVsCodeThemeExtension = hasThemeJson
    && /"contributes"\s*:\s*{[\s\S]*"themes"\s*:/i.test(packageJson);

  if (isVsCodeThemeExtension) {
    return true;
  }

  if (hasBrowserPreviewEntrypoint(paths)) {
    return false;
  }

  const hasReadme = pathSet.has('readme.md');
  const hasLibraryEntrypoint = paths.some((filePath) => (
    /^src\/index\.(?:ts|tsx|js|jsx|mts|cts)$/.test(filePath)
    || /^lib\/index\.(?:ts|tsx|js|jsx|mts|cts)$/.test(filePath)
    || /^dist\/index\.(?:d\.ts|ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)
  ));

  const isPackageBasedCodeArtifact = Boolean(packageJson)
    && (
      /"bin"\s*:/i.test(packageJson)
      || /"workspaces"\s*:/i.test(packageJson)
      || /"contributes"\s*:/i.test(packageJson)
      || /"engines"\s*:\s*{[\s\S]*"vscode"/i.test(packageJson)
      || /"exports"\s*:/i.test(packageJson)
      || /"main"\s*:/i.test(packageJson)
      || /"module"\s*:/i.test(packageJson)
      || /"types"\s*:/i.test(packageJson)
      || hasLibraryEntrypoint
      || hasReadme
      || paths.some((filePath) => filePath.startsWith('packages/'))
    );

  if (isPackageBasedCodeArtifact) {
    return true;
  }

  return paths.some((filePath) => (
    filePath === 'cargo.toml'
    || filePath.endsWith('.rs')
    || filePath === 'requirements.txt'
    || filePath === 'pyproject.toml'
    || filePath.endsWith('.py')
    || filePath.endsWith('.go')
    || filePath.endsWith('.csproj')
    || filePath.endsWith('.cs')
  ));
}
