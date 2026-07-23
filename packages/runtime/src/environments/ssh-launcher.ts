import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sshLaunchResultSchema, type SshLaunchResult } from '@vai/contracts/adoption';
import { TIMEOUTS_MS } from '@vai/constants';

const execFileAsync = promisify(execFile);
export interface SshRunner { (target: string, command: string): Promise<{ stdout: string; stderr: string }>; }

function quotePosix(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function quotePowerShell(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

export function posixNodeProbeCommand(): string {
  return `sh -lc ${quotePosix('for n in "$(command -v node 2>/dev/null)" /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.volta/bin/node" "$HOME/.local/bin/node"; do if [ -n "$n" ] && [ -x "$n" ]; then printf "%s\\n" "$n"; "$n" --version; exit 0; fi; done; exit 127')}`;
}

export function windowsNodeProbeCommand(): string {
  const script = "$c=@((Get-Command node -ErrorAction SilentlyContinue).Source,\"$env:ProgramFiles\\nodejs\\node.exe\",\"$env:LOCALAPPDATA\\Programs\\nodejs\\node.exe\",\"$env:USERPROFILE\\.volta\\bin\\node.exe\")|?{$_ -and (Test-Path $_)}|Select-Object -First 1;if(!$c){exit 127};$c;& $c --version";
  return `powershell -NoProfile -NonInteractive -Command ${quotePowerShell(script)}`;
}

export function buildPosixLauncher(remoteRoot: string, port: number, nodePath: string): string {
  return `#!/bin/sh
set -eu
STATE="$HOME/.vai/runtime"
PID_FILE="$STATE/pid"
mkdir -p "$STATE"
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "runtime process $PID is already alive; refusing an unsafe kill"
    exit 23
  fi
  rm -f "$PID_FILE"
fi
cd ${quotePosix(remoteRoot)}
VAI_HOST=127.0.0.1 VAI_PORT=${port} nohup ${quotePosix(nodePath)} packages/runtime/dist/server.js >"$STATE/runtime.log" 2>&1 &
PID=$!
printf '%s' "$PID" > "$PID_FILE"
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  tail -n 40 "$STATE/runtime.log" >&2 || true
  exit 24
fi
echo "started:$PID"
`;
}

export function buildWindowsLauncher(remoteRoot: string, port: number, nodePath: string): string {
  return `$ErrorActionPreference='Stop'
$state=Join-Path $env:LOCALAPPDATA 'Vai\\runtime'; New-Item -ItemType Directory -Force $state|Out-Null
$pidFile=Join-Path $state 'pid'; if(Test-Path $pidFile){$old=[int](Get-Content $pidFile);if(Get-Process -Id $old -ErrorAction SilentlyContinue){throw "runtime process $old is already alive; refusing an unsafe kill"};Remove-Item $pidFile -Force}
$log=Join-Path $state 'runtime.log';$env:VAI_HOST='127.0.0.1';$env:VAI_PORT='${port}'
$p=Start-Process -FilePath ${quotePowerShell(nodePath)} -ArgumentList 'packages/runtime/dist/server.js' -WorkingDirectory ${quotePowerShell(remoteRoot)} -RedirectStandardOutput $log -RedirectStandardError ($log+'.err') -WindowStyle Hidden -PassThru
Set-Content -NoNewline $pidFile $p.Id;Start-Sleep -Seconds 1;if($p.HasExited){Get-Content ($log+'.err') -Tail 40;exit 24};Write-Output ('started:'+$p.Id)
`;
}

function parseNodeProbe(output: string): { path?: string; major?: number } {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const versionIndex = lines.findIndex((line) => /^v\d+/.test(line.trim()));
  if (versionIndex < 0) return {};
  return { path: lines[Math.max(0, versionIndex - 1)]?.trim(), major: Number.parseInt(lines[versionIndex].slice(1), 10) };
}

export class SshLauncher {
  constructor(private readonly run: SshRunner = async (target, command) => {
    const result = await execFileAsync('ssh', [target, command], { windowsHide: true, timeout: TIMEOUTS_MS.toolExecution, maxBuffer: 2_000_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  }) {}

  async launch(input: { target: string; remoteRoot: string; localPort: number; remotePort: number }): Promise<SshLaunchResult> {
    const checks: SshLaunchResult['checks'] = [];
    let platform: SshLaunchResult['platform'] = 'unknown';
    try {
      const result = await this.run(input.target, 'uname -s');
      platform = /linux|darwin|bsd/i.test(result.stdout) ? 'posix' : 'unknown';
    } catch {
      try { await this.run(input.target, 'cmd /c ver'); platform = 'windows'; }
      catch (error) {
        checks.push({ id: 'connect', ok: false, detail: 'SSH connection or remote shell detection failed.', diagnosticCommand: `ssh ${input.target} "uname -s"`, output: error instanceof Error ? error.message : String(error) });
        return sshLaunchResultSchema.parse({ ok: false, platform, checks, nextAction: 'Run the diagnostic command and verify SSH authentication.' });
      }
    }
    checks.push({ id: 'connect', ok: true, detail: `Remote platform detected: ${platform}.`, diagnosticCommand: `ssh ${input.target} "${platform === 'windows' ? 'cmd /c ver' : 'uname -s'}"` });

    const probe = platform === 'windows' ? windowsNodeProbeCommand() : posixNodeProbeCommand();
    let nodePath: string | undefined;
    try {
      const result = await this.run(input.target, probe);
      const parsed = parseNodeProbe(result.stdout);
      if (!parsed.path || !parsed.major || parsed.major < 22) throw new Error(`Node 22+ required; observed ${result.stdout.trim() || 'no Node executable'}`);
      nodePath = parsed.path;
      checks.push({ id: 'node', ok: true, detail: `Node ${parsed.major} at ${nodePath}.`, diagnosticCommand: `ssh ${input.target} ${JSON.stringify(probe)}`, output: result.stdout.trim() });
    } catch (error) {
      checks.push({ id: 'node', ok: false, detail: 'A compatible Node runtime was not found.', diagnosticCommand: `ssh ${input.target} ${JSON.stringify(probe)}`, output: error instanceof Error ? error.message : String(error) });
      return sshLaunchResultSchema.parse({ ok: false, platform, checks, nextAction: 'Run the Node diagnostic, install Node 22+, then retry.' });
    }

    const launcherPath = platform === 'windows' ? '$env:LOCALAPPDATA\\Vai\\launch-runtime.ps1' : '$HOME/.vai/launch-runtime.sh';
    const script = platform === 'windows'
      ? buildWindowsLauncher(input.remoteRoot, input.remotePort, nodePath)
      : buildPosixLauncher(input.remoteRoot, input.remotePort, nodePath);
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const installCommand = platform === 'windows'
      ? `powershell -NoProfile -NonInteractive -Command ${quotePowerShell(`$p=Join-Path $env:LOCALAPPDATA 'Vai\\launch-runtime.ps1';New-Item -ItemType Directory -Force (Split-Path $p)|Out-Null;[IO.File]::WriteAllBytes($p,[Convert]::FromBase64String('${encoded}'));& $p`)}`
      : `sh -lc ${quotePosix(`mkdir -p "$HOME/.vai"; printf '%s' '${encoded}' | base64 -d > "$HOME/.vai/launch-runtime.sh" 2>/dev/null || printf '%s' '${encoded}' | base64 -D > "$HOME/.vai/launch-runtime.sh"; chmod 700 "$HOME/.vai/launch-runtime.sh"; "$HOME/.vai/launch-runtime.sh"`)}`;
    try {
      const result = await this.run(input.target, installCommand);
      checks.push({ id: 'launcher', ok: true, detail: 'Idempotent launcher installed and runtime started or safely reused.', diagnosticCommand: `ssh ${input.target} ${JSON.stringify(installCommand)}`, output: result.stdout.trim() });
    } catch (error) {
      checks.push({ id: 'launcher', ok: false, detail: 'Launcher installation or startup failed.', diagnosticCommand: `ssh ${input.target} ${JSON.stringify(installCommand)}`, output: error instanceof Error ? error.message : String(error) });
      return sshLaunchResultSchema.parse({ ok: false, platform, checks, nodePath, launcherPath, nextAction: 'Run the launcher diagnostic and inspect the reported remote runtime log.' });
    }
    const tunnelCommand = `ssh -N -L ${input.localPort}:127.0.0.1:${input.remotePort} ${input.target}`;
    return sshLaunchResultSchema.parse({ ok: true, platform, checks, nodePath, launcherPath, tunnelCommand, nextAction: `Start the loopback-only tunnel: ${tunnelCommand}` });
  }
}
