# After Cursor IDE Browser MCP calls, pull the automation Chrome window on-screen.
# Cursor often spawns it at (-2400, -2400) — visible in the taskbar but not clickable.
param()

$ErrorActionPreference = 'SilentlyContinue'

try {
  if ([Console]::In.Peek() -ge 0) {
    [void][Console]::In.ReadToEnd()
  }
} catch {}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VaiBrowserReveal {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$targetX = [Math]::Max(40, [int]($screen.Left + ($screen.Width - 1280) / 2))
$targetY = [Math]::Max(40, [int]($screen.Top + ($screen.Height - 860) / 2))
$targetW = [Math]::Min(1280, $screen.Width - 80)
$targetH = [Math]::Min(860, $screen.Height - 80)

$revealed = $false
Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
  ForEach-Object {
    $handle = $_.MainWindowHandle
    $title = $_.MainWindowTitle
    $rect = New-Object VaiBrowserReveal+RECT
    [void][VaiBrowserReveal]::GetWindowRect($handle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $offScreen = ($rect.Left -lt -200 -or $rect.Top -lt -200 -or $rect.Left -gt ($screen.Right + 200) -or $rect.Top -gt ($screen.Bottom + 200))
    $automation = ($title -match 'about:blank|Cursor|Simple Browser|build a simple' -or $offScreen)
    if (-not $automation) { return }

    $w = if ($width -gt 400) { $width } else { $targetW }
    $h = if ($height -gt 300) { $height } else { $targetH }
    [void][VaiBrowserReveal]::SetWindowPos($handle, [IntPtr]::Zero, $targetX, $targetY, $w, $h, 0x0040)
    if ([VaiBrowserReveal]::IsIconic($handle)) {
      [void][VaiBrowserReveal]::ShowWindow($handle, 9)
    }
    [void][VaiBrowserReveal]::ShowWindow($handle, 5)
    [void][VaiBrowserReveal]::SetForegroundWindow($handle)
    $script:revealed = $true
  }

if ($revealed) {
  Write-Output '{"revealed":true}'
} else {
  Write-Output '{"revealed":false}'
}

exit 0
