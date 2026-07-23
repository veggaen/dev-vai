import { describe, expect, it, vi } from 'vitest';
import { buildPosixLauncher, buildWindowsLauncher, posixNodeProbeCommand, SshLauncher, windowsNodeProbeCommand } from './ssh-launcher.js';

describe('SSH launcher', () => {
  it('has platform-specific probes and loopback-only launchers', () => {
    expect(posixNodeProbeCommand()).toContain('.volta/bin/node');
    expect(windowsNodeProbeCommand()).toContain('ProgramFiles');
    expect(buildPosixLauncher('/srv/vai', 3006, '/usr/bin/node')).toContain('VAI_HOST=127.0.0.1');
    expect(buildWindowsLauncher('C:\\vai', 3006, 'C:\\node.exe')).toContain("$env:VAI_HOST='127.0.0.1'");
  });

  it('returns the exact failed check and copyable command', async () => {
    const run = vi.fn(async (_target: string, command: string) => {
      if (command === 'uname -s') return { stdout: 'Linux\n', stderr: '' };
      throw new Error('node missing');
    });
    const result = await new SshLauncher(run).launch({ target: 'user@host', remoteRoot: '/srv/vai', localPort: 3306, remotePort: 3006 });
    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({ id: 'node', ok: false });
    expect(result.checks.at(-1)?.diagnosticCommand).toContain('ssh user@host');
  });
});
