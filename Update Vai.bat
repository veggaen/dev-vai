@echo off
REM Double-click to rebuild + restart the VAI desktop app.
REM Runs the repo's own updater: closes the running app, builds the Tauri
REM bundle, syncs veggaai.exe to Documents\veggaAi, and relaunches it.
title Update Vai
cd /d "%~dp0"

echo ============================================
echo   Updating VAI desktop app...
echo   (this takes a few minutes the first time)
echo ============================================
echo.

call pnpm app:update
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
  echo ------------------------------------------------------------
  echo  Build FAILED with exit code %EXITCODE%.
  echo  Most common cause: the Rust/Tauri toolchain is missing.
  echo  Install Rust from https://rustup.rs then run this again.
  echo  For a quick dev run without a full build, use: pnpm dev
  echo ------------------------------------------------------------
) else (
  echo Done. The updated Vai app has been launched.
)
echo.
pause
