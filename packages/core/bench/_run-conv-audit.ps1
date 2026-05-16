# Conv-audit runner — calls the audit wrapper for each bench v2..v26 with a
# small N so the full sweep finishes in a reasonable time. Each invocation
# appends to one shared JSONL.
$ErrorActionPreference = 'Continue'
$Out = Join-Path (Resolve-Path '../..') '_conv_audit_v1.jsonl'
$Errs = Join-Path (Resolve-Path '../..') '_conv_audit_v1.errors.log'
if (Test-Path $Out)  { Remove-Item $Out }
if (Test-Path $Errs) { Remove-Item $Errs }
$N = if ($env:CONV_AUDIT_N) { [int]$env:CONV_AUDIT_N } else { 30 }
Write-Host "==> conv-audit v1 N=$N per bench, out=$Out"
for ($v = 2; $v -le 26; $v++) {
  $bench = "intent-format-meaning-v$v"
  $mod   = "./bench/$bench.mts"
  Write-Host ">> $bench (n=$N)"
  $env:CONV_AUDIT_PATH   = $Out
  $env:CONV_AUDIT_BENCH  = $bench
  $env:CONV_AUDIT_MODULE = $mod
  # Bench writes its own pass/fail to stdout; we only care about the captured JSONL.
  & pnpm exec tsx ./bench/_audit-wrapper.mts -- --n=$N --seed=42 *> "$Errs.$v.log"
  if ($LASTEXITCODE -ne 0) {
    Add-Content $Errs "$bench exited $LASTEXITCODE"
  }
}
$size = (Get-Item $Out).Length
$lines = (Get-Content $Out | Measure-Object -Line).Lines
Write-Host "==> done. captured lines=$lines, size=$size bytes at $Out"
