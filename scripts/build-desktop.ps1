# Build the VAI desktop app (production) — run from anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
# Or right-click → Run with PowerShell.
#
# What it does:
#   1. pnpm install            (sync deps with the lockfile)
#   2. typecheck + unit tests  (fails fast if something is broken)
#   3. vite production build of the desktop shell
#   4. tauri build             (native installer/exe) if the Tauri CLI + Rust are present;
#      otherwise leaves you with the web build and prints how to run it.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "== VAI desktop build ==" -ForegroundColor Cyan

Write-Host "`n[1/4] Installing dependencies..." -ForegroundColor Yellow
pnpm install

Write-Host "`n[2/4] Typecheck + voice/STT unit tests..." -ForegroundColor Yellow
pnpm -r --filter "@vai/desktop" --filter "@vai/runtime" --filter "@vai/core" --filter "@vai/api-types" exec tsc --noEmit
pnpm vitest run packages/runtime/src/stt apps/desktop/src/lib/voice

Write-Host "`n[3/4] Building desktop shell (vite)..." -ForegroundColor Yellow
pnpm --filter "@vai/desktop" build

Write-Host "`n[4/4] Native bundle (tauri)..." -ForegroundColor Yellow
$tauri = $false
try {
  pnpm --filter "@vai/desktop" exec tauri --version | Out-Null
  $tauri = $true
} catch {
  Write-Host "Tauri CLI not available — skipping native bundle." -ForegroundColor DarkYellow
}

if ($tauri) {
  pnpm --filter "@vai/desktop" exec tauri build
  Write-Host "`nDone. Installer is under apps\desktop\src-tauri\target\release\bundle\" -ForegroundColor Green
} else {
  Write-Host "`nDone. Web build is in apps\desktop\dist\ — run 'pnpm dev' for the live desktop shell." -ForegroundColor Green
}
