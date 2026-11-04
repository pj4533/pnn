#!/bin/bash
# Live-ops watcher for PNN: prints only log lines worth acting on, plus a health check every 30s.
# Usage: scripts/watch.sh   (PORT=4181 scripts/watch.sh for another port)
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-4180}"
LOG="${LOG_DIR:-logs}/pnn.log"
mkdir -p "$(dirname "$LOG")"; touch "$LOG"

tail -n0 -F "$LOG" 2>/dev/null | grep --line-buffered -E \
  '"level":"(warn|error)"|"msg":"(breaking|feed error|backoff|task failed|client|sim jump|first build|server start|server stop|uncaughtException|unhandledRejection)"' &
TAIL_PID=$!
trap 'kill $TAIL_PID 2>/dev/null' EXIT

while true; do
  h=$(curl -s -m 5 "localhost:$PORT/api/health") || h=""
  if [ -z "$h" ]; then
    echo "HEALTH $(date +%H:%M:%S): server DOWN on :$PORT"
  else
    printf '%s' "$h" | node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        try {
          const d = JSON.parse(s);
          const bad = Object.entries(d.feeds || {}).filter(([, f]) => !f.ok)
            .map(([k, f]) => `${k} age=${f.ageSec ?? "never"}s err=${f.lastError ?? "-"}`);
          if (bad.length) console.log(`HEALTH ${new Date().toTimeString().slice(0, 8)}: ${bad.join(" | ")}`);
          if (!d.stories) console.log("HEALTH: no stories on air");
        } catch (e) { console.log("HEALTH: unparseable", e.message); }
      });'
  fi
  sleep 30
done
