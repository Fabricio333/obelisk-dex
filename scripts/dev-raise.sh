#!/usr/bin/env bash
# Dev raise: `next dev` + Cloudflare tunnel.
#
# Idempotent: reuses an existing dev server / cloudflared if already running.
# Re-running is safe.
#
#   ./scripts/dev-raise.sh
#
# Env overrides:
#   TUNNEL_NAME        default: obelisk-dev
#   TUNNEL_HOSTNAME    default: dex-test.obelisk.ar
#   PORT               default: 3000
#   PORT_FALLBACK_MAX  default: 10
#   ORIGIN_URL         default: http://127.0.0.1:$PORT
#   SKIP_TUNNEL=1      only start dev server, no cloudflared
#   FORCE_KILL=1       kill anything on $PORT instead of falling back

set -u

if [ -f "$(dirname "$0")/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$(dirname "$0")/../.env"
  set +a
fi

TUNNEL_NAME="${TUNNEL_NAME:-obelisk-dev}"
TUNNEL_HOST="${TUNNEL_HOSTNAME:-dex-test.obelisk.ar}"
ORIGIN_CERT="${CLOUDFLARED_ORIGIN_CERT:-$HOME/.cloudflared/cert.pem}"
PORT="${PORT:-3000}"
PORT_FALLBACK_MAX="${PORT_FALLBACK_MAX:-10}"
ORIGIN_URL_OVERRIDE="${ORIGIN_URL:-}"
ORIGIN_URL="${ORIGIN_URL_OVERRIDE:-http://127.0.0.1:${PORT}}"
SKIP_TUNNEL="${SKIP_TUNNEL:-0}"
FORCE_KILL="${FORCE_KILL:-0}"
# Turbopack on Next 16.2.2 panics with "Next.js package not found" and the
# browser falls back to a full reload loop. Default to webpack until the
# Turbopack regression is fixed upstream. Flip with USE_TURBOPACK=1.
USE_TURBOPACK="${USE_TURBOPACK:-0}"
# Wipe .next before starting (cheap insurance against corrupted cache).
CLEAN_NEXT_CACHE="${CLEAN_NEXT_CACHE:-1}"

cd "$(dirname "$0")/.."

red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
green() { printf "\033[0;32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[0;34m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n"     "$*"; }
step()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }

# ── Pre-flight ───────────────────────────────────────────────────
step "Pre-flight"
command -v node >/dev/null || { red "node not installed."; exit 1; }
command -v npm  >/dev/null || { red "npm not installed."; exit 1; }
if [ "$SKIP_TUNNEL" != "1" ]; then
  command -v cloudflared >/dev/null || { red "cloudflared not installed. brew install cloudflared"; exit 1; }
  [ -f "$ORIGIN_CERT" ] || { red "Origin cert missing: $ORIGIN_CERT"; red "Run: cloudflared tunnel login (or set CLOUDFLARED_ORIGIN_CERT)"; exit 1; }
  dim "Origin cert: $ORIGIN_CERT"
fi
green "OK."

# ── Tunnel lookup ────────────────────────────────────────────────
TUNNEL_UUID=""
CRED_FILE=""
if [ "$SKIP_TUNNEL" != "1" ]; then
  step "Tunnel lookup"
  TUNNEL_UUID=$(cloudflared --origincert "$ORIGIN_CERT" tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
  if [ -z "$TUNNEL_UUID" ]; then
    red "Tunnel '$TUNNEL_NAME' not found."
    echo "Create it with:"
    echo "  cloudflared tunnel create $TUNNEL_NAME"
    echo "  cloudflared tunnel route dns --overwrite-dns $TUNNEL_NAME $TUNNEL_HOST"
    exit 1
  fi
  CRED_FILE="$HOME/.cloudflared/${TUNNEL_UUID}.json"
  [ -f "$CRED_FILE" ] || { red "Missing credentials file: $CRED_FILE"; exit 1; }
  dim "UUID: $TUNNEL_UUID  →  $TUNNEL_HOST"
fi

# ── Port check ───────────────────────────────────────────────────
step "Dev server on port $PORT"
DEV_ALREADY_RUNNING=0

is_next_dev() {
  case "$1" in
    *"next dev"*|*"next-server"*|*"node "*"next"*) return 0 ;;
    *) return 1 ;;
  esac
}

pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)

if [ -n "$pids" ]; then
  cmd=$(ps -p "$(echo "$pids" | head -1)" -o command= 2>/dev/null || true)
  if is_next_dev "$cmd"; then
    green "Dev server already on $PORT — reusing (pid $(echo "$pids" | head -1))."
    DEV_ALREADY_RUNNING=1
  else
    blue "Port $PORT held by: $cmd"
    if [ "$FORCE_KILL" = "1" ]; then
      blue "FORCE_KILL=1 — killing."
      kill $pids 2>/dev/null || true; sleep 1
      still=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
      [ -n "$still" ] && { kill -9 $still 2>/dev/null || true; sleep 1; }
    else
      blue "Probing fallback ports $((PORT+1))..$((PORT+PORT_FALLBACK_MAX))"
      found=""
      for off in $(seq 1 "$PORT_FALLBACK_MAX"); do
        cand=$((PORT + off))
        cpids=$(lsof -tiTCP:"$cand" -sTCP:LISTEN 2>/dev/null || true)
        if [ -z "$cpids" ]; then
          found="$cand"; PORT="$cand"; green "Using free port $cand."; break
        fi
        ccmd=$(ps -p "$(echo "$cpids" | head -1)" -o command= 2>/dev/null || true)
        if is_next_dev "$ccmd"; then
          PORT="$cand"; DEV_ALREADY_RUNNING=1; found="$cand"
          green "Next dev already on $cand — reusing."
          break
        fi
      done
      [ -z "$found" ] && { red "No free port. Set FORCE_KILL=1."; exit 1; }
    fi
  fi
fi

ORIGIN_URL="${ORIGIN_URL_OVERRIDE:-http://127.0.0.1:${PORT}}"
export PORT

# ── Launch ───────────────────────────────────────────────────────
DEV_PID=""
TUNNEL_PID=""
TUNNEL_REUSED=0

CLEANED_UP=0
cleanup() {
  [ "$CLEANED_UP" = "1" ] && return
  CLEANED_UP=1
  echo
  blue "Shutting down…"
  if [ "$TUNNEL_REUSED" = "0" ] && [ -n "$TUNNEL_PID" ]; then
    kill -TERM "$TUNNEL_PID" 2>/dev/null
    # cloudflared spawns child quic workers — kill the whole tree
    pkill -TERM -P "$TUNNEL_PID" 2>/dev/null
  fi
  if [ "$DEV_ALREADY_RUNNING" = "0" ] && [ -n "$DEV_PID" ]; then
    kill -TERM "$DEV_PID" 2>/dev/null
    pkill -TERM -P "$DEV_PID" 2>/dev/null
  fi
  # Give them up to 2s to exit cleanly, then SIGKILL anything still alive.
  for _ in 1 2 3 4; do
    alive=0
    [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null && alive=1
    [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null && alive=1
    [ "$alive" = "0" ] && break
    sleep 0.5
  done
  [ -n "$TUNNEL_PID" ] && kill -KILL "$TUNNEL_PID" 2>/dev/null
  [ -n "$DEV_PID" ] && kill -KILL "$DEV_PID" 2>/dev/null
  # Catch any orphaned grandchildren (next-server, cloudflared workers).
  pkill -KILL -P $$ 2>/dev/null
  return 0
}
on_signal() { cleanup; exit 130; }
trap on_signal INT TERM
trap cleanup EXIT

if [ "$DEV_ALREADY_RUNNING" = "0" ]; then
  if [ "$CLEAN_NEXT_CACHE" = "1" ] && [ -d .next ]; then
    dim "Wiping .next cache (set CLEAN_NEXT_CACHE=0 to skip)…"
    rm -rf .next
  fi
  DEV_FLAGS="-p $PORT"
  if [ "$USE_TURBOPACK" != "1" ]; then
    DEV_FLAGS="$DEV_FLAGS --webpack"
    blue "Starting next dev on :$PORT (webpack — set USE_TURBOPACK=1 to opt in to Turbopack) (logs → ./dev.log)…"
  else
    blue "Starting next dev on :$PORT (turbopack) (logs → ./dev.log)…"
  fi
  # shellcheck disable=SC2086
  PORT="$PORT" npx next dev $DEV_FLAGS > dev.log 2>&1 &
  DEV_PID=$!
  for i in $(seq 1 60); do
    lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1 && { green "Dev server up."; break; }
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      red "next dev died. Last 20 log lines:"; tail -20 dev.log; exit 1
    fi
    sleep 1
  done
  lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1 || { red "Dev server didn't start within 60s. See dev.log"; exit 1; }
fi

if [ "$SKIP_TUNNEL" = "1" ]; then
  step "Ready"
  green "Dev: http://127.0.0.1:$PORT  (SKIP_TUNNEL=1)"
  [ "$DEV_ALREADY_RUNNING" = "0" ] && { blue "Tailing — Ctrl-C to stop."; while kill -0 "$DEV_PID" 2>/dev/null; do sleep 5; done; }
  exit 0
fi

step "Cloudflare tunnel"
if pgrep -f "cloudflared .* ${TUNNEL_UUID}" >/dev/null 2>&1 \
   || pgrep -f "cloudflared .* ${TUNNEL_NAME}\b" >/dev/null 2>&1; then
  green "Tunnel '$TUNNEL_NAME' already running — reusing."
  TUNNEL_REUSED=1
else
  blue "Starting cloudflared '$TUNNEL_NAME' → $ORIGIN_URL (logs → ./tunnel.log)"
  cloudflared --origincert "$ORIGIN_CERT" tunnel \
    --config /dev/null \
    --cred-file "$CRED_FILE" \
    run \
    --url "$ORIGIN_URL" \
    --no-tls-verify \
    "$TUNNEL_UUID" > tunnel.log 2>&1 &
  TUNNEL_PID=$!
  sleep 2
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    red "cloudflared died. Last 20 log lines:"; tail -20 tunnel.log; exit 1
  fi
fi

# Wait for cloudflared to register all 4 edge connections (means tunnel
# is actually carrying traffic, not just a process that's alive).
step "Tunnel handshake"
ready=0
for i in $(seq 1 30); do
  if grep -q "Registered tunnel connection" tunnel.log 2>/dev/null; then
    n=$(grep -c "Registered tunnel connection" tunnel.log 2>/dev/null || echo 0)
    [ "$n" -ge 1 ] && { green "cloudflared registered $n edge connection(s)."; ready=1; break; }
  fi
  if grep -qiE "error|failed|unauthorized|ingress" tunnel.log 2>/dev/null \
     && ! grep -q "Registered tunnel connection" tunnel.log 2>/dev/null; then
    red "cloudflared reported errors. Last 30 log lines:"; tail -30 tunnel.log
    exit 1
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  red "cloudflared didn't register an edge connection within 30s."
  red "Last 30 log lines:"; tail -30 tunnel.log
  exit 1
fi

# Verify the public hostname actually serves our origin (catches the
# "tunnel up but DNS / ingress route points elsewhere" case).
step "Public reachability"

probe_public() {
  # Resolve via a public resolver to bypass local/ISP negative-cache
  # for newly-created CNAMEs. curl's -w always prints %{http_code}
  # (000 on failure); don't append a fallback or we get "000000".
  local ip
  ip=$(dig +short +time=2 +tries=1 "$TUNNEL_HOST" @1.1.1.1 | grep -m1 -E '^[0-9.]+$')
  if [ -n "$ip" ]; then
    curl -sk -o /dev/null -w "%{http_code}" --max-time 5 \
      --resolve "${TUNNEL_HOST}:443:${ip}" "https://$TUNNEL_HOST"
  else
    curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://$TUNNEL_HOST"
  fi
}

wait_public() {
  local attempts="$1" code=""
  for _ in $(seq 1 "$attempts"); do
    code=$(probe_public)
    case "$code" in
      2*|3*|401|403) echo "$code"; return 0 ;;
      530|521|522|523|525) dim "edge $code (origin not reachable yet) — retrying…" ;;
      000) dim "no response — retrying…" ;;
      *)   dim "got $code — retrying…" ;;
    esac
    sleep 2
  done
  echo "$code"
  return 1
}

if code=$(wait_public 20); then
  green "https://$TUNNEL_HOST responding ($code)."
else
  blue "Public hostname not responding (last code: $code) — attempting DNS route fix…"
  if cloudflared --origincert "$ORIGIN_CERT" tunnel route dns --overwrite-dns "$TUNNEL_UUID" "$TUNNEL_HOST" >>tunnel.log 2>&1; then
    green "Re-routed $TUNNEL_HOST → $TUNNEL_NAME. Re-checking…"
    if code=$(wait_public 20); then
      green "https://$TUNNEL_HOST responding ($code)."
    else
      red "Still no response after DNS route (last code: $code)."
    fi
  else
    red "DNS route command failed — see tunnel.log."
  fi

  case "$code" in
    2*|3*|401|403) ;;
    *)
      red "https://$TUNNEL_HOST not serving content (last code: $code)."
      red "Likely causes:"
      red "  • Another cloudflared instance owns this hostname"
      red "    check: pgrep -af cloudflared"
      red "  • Origin scheme mismatch (try ORIGIN_URL=https://127.0.0.1:$PORT)"
      red "  • DNS propagation lag (wait a minute and re-run)"
      red "Tunnel log tail:"; tail -20 tunnel.log
      exit 1
      ;;
  esac
fi

step "Ready"
green "Local:  http://127.0.0.1:$PORT"
green "Public: https://$TUNNEL_HOST"
dim   "Logs:   ./dev.log  ./tunnel.log"
echo

PANIC_WARNED=0
while :; do
  if [ "$TUNNEL_REUSED" = "0" ] && [ -n "$TUNNEL_PID" ] && ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    red "Tunnel exited."; break
  fi
  if [ "$TUNNEL_REUSED" = "1" ] && ! pgrep -f "cloudflared .* $TUNNEL_UUID" >/dev/null 2>&1; then
    red "Tunnel exited."; break
  fi
  if [ "$DEV_ALREADY_RUNNING" = "0" ] && [ -n "$DEV_PID" ] && ! kill -0 "$DEV_PID" 2>/dev/null; then
    red "Dev server exited."; break
  fi
  # Surface bundler panics once — they cause the browser to full-reload
  # in a loop. The user has to take action (wipe cache / switch bundler).
  if [ "$PANIC_WARNED" = "0" ] && grep -qE "FATAL|Turbopack error|panic log has been written" dev.log 2>/dev/null; then
    red "⚠ Bundler panic detected in dev.log — browser will reload-loop."
    if [ "$USE_TURBOPACK" = "1" ]; then
      red "  Re-run without USE_TURBOPACK=1 to fall back to webpack."
    else
      red "  Try: rm -rf .next node_modules/.cache && npm run dev:raise"
    fi
    PANIC_WARNED=1
  fi
  sleep 2
done
