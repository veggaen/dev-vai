# SSH-launched environments

## Decision

SSH launch is a sequence of named probes: executable, shell, home, architecture,
runtime candidates, writable state directory, port availability, launcher
version, and health. Node/runtime discovery checks PATH plus common nvm, fnm,
asdf, volta, Homebrew, system, and Windows locations without assuming bash.

Every failed probe returns the exact check, stdout/stderr/exit code, and a
copyable diagnostic command appropriate to the remote shell. Vai writes a
versioned idempotent launcher that uses an atomic lock and health file. A healthy
matching server is reused; stale/dead mismatches are restarted without killing
unrelated processes.

## Acceptance

Fixture transports cover PowerShell/cmd, sh/zsh, missing runtime, spaces/unicode,
stale locks, wrong version, occupied port, dropped SSH, and repeated launch.
