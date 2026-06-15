# Keeps Cursor's automation Chrome on your primary monitor.
# Run once per session:  powershell -File scripts/cursor-browser-keeper.ps1
Write-Host "Watching for off-screen Cursor browser windows (Ctrl+C to stop)..."
while ($true) {
  & "$PSScriptRoot/../.cursor/hooks/reveal-cursor-browser.ps1" | Out-Null
  Start-Sleep -Seconds 2
}
