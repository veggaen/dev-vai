#!/bin/sh
END=$(( $(date +%s) + 2000 ))
DB="scripts/improve-loop/.corpus-auto.sqlite"
LOG="${AUTOLOOP_LOG:-/c/tmp/autoloop.log}"
mkdir -p "$(dirname "$LOG")" # ensure the log dir exists before redirecting into it (CodeRabbit #25)
while [ "$(date +%s)" -lt "$END" ]; do
  curl -s -m 20 http://localhost:11434/api/generate -d '{"model":"qwen3:8b","prompt":"hi","keep_alive":"30m","options":{"num_predict":2}}' >/dev/null 2>&1
  # SEEDS-ONLY: grade the known prompts immediately (no slow qwen generation gate) so the
  # dashboard fills fast and the council actually runs. Resumable; fixes queued only.
  node scripts/improve-loop/run.mjs --seeds-only --vram-gb 5 --cooldown 3000 \
    --db "$DB" --base-url http://localhost:3006 >> "$LOG" 2>&1
  echo "--- seeds cycle done @ $(date -u +%H:%M:%S) ---" >> "$LOG"
  sleep 5
done
