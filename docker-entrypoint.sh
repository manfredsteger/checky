#!/bin/sh
# Startet ein virtuelles Display (Xvfb) für headful/Anti-Detection und
# führt danach den eigentlichen Worker als Hauptprozess aus (exec -> saubere
# Logs + Signalweitergabe). Bei HEADLESS=true wird Xvfb übersprungen.
set -e

if [ "$HEADLESS" != "true" ]; then
  export DISPLAY="${DISPLAY:-:99}"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac -nolisten tcp >/dev/null 2>&1 &
  # kurz warten, bis das Display bereit ist
  sleep 1.5
  echo "[entrypoint] Xvfb läuft auf DISPLAY=$DISPLAY"
fi

exec "$@"
