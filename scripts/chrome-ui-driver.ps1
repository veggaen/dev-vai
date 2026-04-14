param(
  [switch]$List,
  [string]$Title,
  [string]$OpenUrl,
  [switch]$NewTab,
  [int]$MoveX,
  [int]$MoveY,
  [int]$RelativeMoveX,
  [int]$RelativeMoveY,
  [int]$ClickX,
  [int]$ClickY,
  [int]$RelativeClickX,
  [int]$RelativeClickY,
  [ValidateSet('left','right','middle')]
  [string]$Button = 'left',
  [string]$TypeText,
  [string]$Keys,
  [string]$ExecuteJs,
  [string]$ExecuteJsConsole,
  [int]$StepDelayMs = 18,
  [int]$SettleDelayMs = 250,
  [string]$ScreenshotPath,
  [switch]$PressEnter,
  [switch]$AddressBar
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class Win32Native {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null

$SW_RESTORE = 9
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP = 0x0040

function Get-ChromeWindows {
  Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object Id, MainWindowTitle, MainWindowHandle
}

function Resolve-ChromeWindow {
  param([string]$MatchTitle)

  $windows = Get-ChromeWindows
  if (-not $windows) {
    throw 'No visible Chrome windows were found.'
  }

  if ([string]::IsNullOrWhiteSpace($MatchTitle)) {
    return $windows | Select-Object -First 1
  }

  $match = $windows | Where-Object { $_.MainWindowTitle -like "*$MatchTitle*" } | Select-Object -First 1
  if (-not $match) {
    $titles = ($windows | ForEach-Object { $_.MainWindowTitle }) -join '; '
    throw "No Chrome window matched '$MatchTitle'. Visible titles: $titles"
  }

  return $match
}

function Focus-ChromeWindow {
  param([object]$Window)

  [Win32Native]::ShowWindowAsync([IntPtr]$Window.MainWindowHandle, $SW_RESTORE) | Out-Null
  Start-Sleep -Milliseconds 120
  [Win32Native]::SetForegroundWindow([IntPtr]$Window.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds $SettleDelayMs
}

function Get-WindowRect {
  param([object]$Window)

  $rect = New-Object Win32Native+RECT
  [Win32Native]::GetWindowRect([IntPtr]$Window.MainWindowHandle, [ref]$rect) | Out-Null
  return $rect
}

function Move-MouseSmooth {
  param([int]$TargetX, [int]$TargetY)

  $current = [System.Windows.Forms.Cursor]::Position
  $distance = [Math]::Max([Math]::Abs($TargetX - $current.X), [Math]::Abs($TargetY - $current.Y))
  $steps = [Math]::Max([int]($distance / 20), 12)

  for ($i = 1; $i -le $steps; $i++) {
    $x = [int]($current.X + (($TargetX - $current.X) * $i / $steps))
    $y = [int]($current.Y + (($TargetY - $current.Y) * $i / $steps))
    [Win32Native]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds $StepDelayMs
  }

  Start-Sleep -Milliseconds $SettleDelayMs
}

function Invoke-MouseClick {
  param([ValidateSet('left','right','middle')][string]$MouseButton)

  switch ($MouseButton) {
    'left' {
      [Win32Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [Win32Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    'right' {
      [Win32Native]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [Win32Native]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    'middle' {
      [Win32Native]::mouse_event($MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [Win32Native]::mouse_event($MOUSEEVENTF_MIDDLEUP, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  Start-Sleep -Milliseconds $SettleDelayMs
}

function Escape-SendKeysText {
  param([string]$Text)

  $escaped = $Text
  $escaped = $escaped.Replace('{', '{{}').Replace('}', '{}}')
  $escaped = $escaped.Replace('+', '{+}').Replace('^', '{^}').Replace('%', '{%}')
  $escaped = $escaped.Replace('~', '{~}').Replace('(', '{(}').Replace(')', '{)}')
  $escaped = $escaped.Replace('[', '{[}').Replace(']', '{]}')
  return $escaped
}

function Send-TextSlow {
  param([string]$Text)

  foreach ($char in $Text.ToCharArray()) {
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText -Text $char))
    Start-Sleep -Milliseconds ([Math]::Max($StepDelayMs, 28))
  }
}

function Invoke-PageScript {
  param([string]$Script)

  if ([string]::IsNullOrWhiteSpace($Script)) {
    return
  }

  $bookmarklet = "javascript:(()=>{$Script})()"
  Set-Clipboard -Value $bookmarklet
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait('^l')
  Start-Sleep -Milliseconds $SettleDelayMs
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds $SettleDelayMs
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds ([Math]::Max($SettleDelayMs, 400))
}

function Invoke-ConsoleScript {
  param([string]$Script)

  if ([string]::IsNullOrWhiteSpace($Script)) {
    return
  }

  [System.Windows.Forms.SendKeys]::SendWait('^+j')
  Start-Sleep -Milliseconds ([Math]::Max($SettleDelayMs, 900))
  Send-TextSlow -Text $Script
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds ([Math]::Max($SettleDelayMs, 500))
  [System.Windows.Forms.SendKeys]::SendWait('^+j')
  Start-Sleep -Milliseconds ([Math]::Max($SettleDelayMs, 400))
}

function Save-WindowScreenshot {
  param(
    [object]$Rect,
    [string]$Path
  )

  $width = [Math]::Max(1, $Rect.Right - $Rect.Left)
  $height = [Math]::Max(1, $Rect.Bottom - $Rect.Top)
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($Rect.Left, $Rect.Top, 0, 0, $bitmap.Size)
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

if ($List) {
  Get-ChromeWindows | Format-Table -AutoSize
  exit 0
}

$window = Resolve-ChromeWindow -MatchTitle $Title
Focus-ChromeWindow -Window $window

if ($AddressBar) {
  [System.Windows.Forms.SendKeys]::SendWait('^l')
  Start-Sleep -Milliseconds $SettleDelayMs
}

if ($NewTab) {
  [System.Windows.Forms.SendKeys]::SendWait('^t')
  Start-Sleep -Milliseconds 300
}

if ($OpenUrl) {
  [System.Windows.Forms.SendKeys]::SendWait('^l')
  Start-Sleep -Milliseconds $SettleDelayMs
  Send-TextSlow -Text $OpenUrl
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 500
}

if ($TypeText) {
  Send-TextSlow -Text $TypeText
}

if ($Keys) {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $SettleDelayMs
}

if ($ExecuteJs) {
  Invoke-PageScript -Script $ExecuteJs
}

if ($ExecuteJsConsole) {
  Invoke-ConsoleScript -Script $ExecuteJsConsole
}

if ($PressEnter) {
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds $SettleDelayMs
}

$rect = Get-WindowRect -Window $window

if ($PSBoundParameters.ContainsKey('MoveX') -and $PSBoundParameters.ContainsKey('MoveY')) {
  Move-MouseSmooth -TargetX $MoveX -TargetY $MoveY
}

if ($PSBoundParameters.ContainsKey('RelativeMoveX') -and $PSBoundParameters.ContainsKey('RelativeMoveY')) {
  Move-MouseSmooth -TargetX ($rect.Left + $RelativeMoveX) -TargetY ($rect.Top + $RelativeMoveY)
}

if ($PSBoundParameters.ContainsKey('ClickX') -and $PSBoundParameters.ContainsKey('ClickY')) {
  Move-MouseSmooth -TargetX $ClickX -TargetY $ClickY
  Invoke-MouseClick -MouseButton $Button
}

if ($PSBoundParameters.ContainsKey('RelativeClickX') -and $PSBoundParameters.ContainsKey('RelativeClickY')) {
  Move-MouseSmooth -TargetX ($rect.Left + $RelativeClickX) -TargetY ($rect.Top + $RelativeClickY)
  Invoke-MouseClick -MouseButton $Button
}

[pscustomobject]@{
  WindowTitle = $window.MainWindowTitle
  ProcessId = $window.Id
  Left = $rect.Left
  Top = $rect.Top
  Right = $rect.Right
  Bottom = $rect.Bottom
}

if ($ScreenshotPath) {
  Save-WindowScreenshot -Rect $rect -Path $ScreenshotPath
  Write-Output "ScreenshotSaved=$ScreenshotPath"
}