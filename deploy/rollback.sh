#!/usr/bin/env bash
# Switch the live site to an earlier release.
#
#   rollback.sh            go back to the release before the live one
#   rollback.sh --list     show releases (* = live)
#   rollback.sh <name>     switch to that release folder name
#
# Git is not changed. The next push deploys normally.

set -euo pipefail

CONF=${MFM_DEPLOY_CONF:-/srv/mfm/deploy.conf}
# shellcheck source=/dev/null
. "$CONF"
: "${BASE:=/srv/mfm}"
: "${RELOAD_CMD:=}"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
LOG="$BASE/deploy.log"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }

live=$(readlink -f "$CURRENT" 2>/dev/null || true)
mapfile -t all < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort)
[ "${#all[@]}" -gt 0 ] || { echo "No releases in $RELEASES" >&2; exit 1; }

if [ "${1:-}" = "--list" ]; then
    for r in "${all[@]}"; do
        [ "$r" = "$live" ] && echo "* $(basename "$r")" || echo "  $(basename "$r")"
    done
    exit 0
fi

if [ $# -ge 1 ]; then
    to="$RELEASES/$1"
else
    to=""
    for (( i = 1; i < ${#all[@]}; i++ )); do
        [ "${all[$i]}" = "$live" ] && to=${all[$((i - 1))]}
    done
    [ -n "$to" ] || { echo "No earlier release to roll back to. Use --list." >&2; exit 1; }
fi
[ -d "$to" ] || { echo "No such release: $to" >&2; exit 1; }
[ "$to" != "$live" ] || { echo "$(basename "$to") is already live." >&2; exit 0; }

exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo "A deploy is running; try again shortly." >&2; exit 1; }

ln -sfn "$to" "$CURRENT.new"
mv -Tf "$CURRENT.new" "$CURRENT"
log "ROLLBACK: live is now $(basename "$to") (was $(basename "$live"))"

if [ -n "$RELOAD_CMD" ]; then
    eval "$RELOAD_CMD" || log "WARNING: reload command failed"
fi
