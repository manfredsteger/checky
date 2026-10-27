#!/bin/sh
# Startet ein virtuelles Display (Xvfb) für headful/Anti-Detection und
# führt danach den eigentlichen Worker als Hauptprozess aus (exec -> saubere
# Logs + Signalweitergabe). Bei HEADLESS=true wird Xvfb übersprungen.
set -e

if [ "$HEADLESS" != "true" ]; then
  export DISPLAY="${DISPLAY:-:99}"
  # Nach `docker restart` bleibt /tmp erhalten: verwaiste Lock-Datei/Socket
  # des vorherigen Xvfb würden den Neustart still verhindern.
  n="${DISPLAY#:}"
  rm -f "/tmp/.X${n}-lock" "/tmp/.X11-unix/X${n}"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac -nolisten tcp >/dev/null 2>&1 &
  # warten, bis das Display bereit ist (Socket existiert)
  i=0
  while [ ! -S "/tmp/.X11-unix/X${n}" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  if [ -S "/tmp/.X11-unix/X${n}" ]; then
    echo "[entrypoint] Xvfb läuft auf DISPLAY=$DISPLAY"
  else
    echo "[entrypoint] FEHLER: Xvfb auf DISPLAY=$DISPLAY nicht gestartet" >&2
    exit 1
  fi
fi

exec "$@"
