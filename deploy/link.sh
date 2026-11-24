#!/usr/bin/env bash
# Point WordPress and the web root at the live release (/srv/mfm/current).
#
# Run by the deploy hook after each switch and by rollback.sh. Safe to run by
# hand at any time (e.g. after moving an old real folder out of the way):
#
#   /srv/mfm/bin/link.sh
#
# What gets linked:
#   wp-content/themes/<name>    each theme in the repo with a style.css
#   wp-content/plugins/<name>   each plugin in the repo with a top-level .php file
#   <web root>/<name>           each top-level entry in the repo's site/ folder
#
# Links point through "current", so they never need changing on deploy.
# A real (non-link) file or folder of the same name is never replaced.
# Our own links whose target is no longer in the live release are removed.

set -euo pipefail
shopt -s nullglob

CONF=${MFM_DEPLOY_CONF:-/srv/mfm/deploy.conf}
# shellcheck source=/dev/null
. "$CONF"
: "${BASE:=/srv/mfm}"
: "${WP_CONTENT:?set WP_CONTENT in deploy.conf}"
: "${WEB_ROOT:=${WP_CONTENT%/wp-content}}"

CURRENT="$BASE/current"
LOG="$BASE/deploy.log"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; }

# Names in site/ that must never be linked into the web root: WordPress's
# own files, dotfiles (.htaccess, .well-known for certbot) and the like.
# The deploy hook rejects a push that contains one; this is a second guard.
reserved() {
    case $1 in
        wp-*|.*|index.php|xmlrpc.php|license.txt|readme.html) return 0 ;;
    esac
    return 1
}

ensure_link() {
    local src=$1 dest=$2 label=$3
    if [ -L "$dest" ]; then
        [ "$(readlink "$dest")" = "$src" ] || { ln -sfn "$src" "$dest"; log "relinked $label"; }
    elif [ -e "$dest" ]; then
        log "WARNING: $dest is a real file or folder; left alone"
    elif ln -s "$src" "$dest"; then
        log "linked $label"
    else
        log "WARNING: could not link $label (permissions?)"
    fi
}

for d in "$CURRENT"/wp-content/themes/*/; do
    name=$(basename "$d")
    [ -f "$d/style.css" ] && ensure_link "$CURRENT/wp-content/themes/$name" "$WP_CONTENT/themes/$name" "themes/$name"
done
for d in "$CURRENT"/wp-content/plugins/*/; do
    name=$(basename "$d")
    compgen -G "$d*.php" >/dev/null && ensure_link "$CURRENT/wp-content/plugins/$name" "$WP_CONTENT/plugins/$name" "plugins/$name"
done
for p in "$CURRENT"/site/*; do
    name=$(basename "$p")
    if reserved "$name"; then
        log "WARNING: site/$name is a reserved name; not linked"
        continue
    fi
    ensure_link "$CURRENT/site/$name" "$WEB_ROOT/$name" "/$name"
done

# Remove our own links that now point at nothing (removed from the repo, or
# not in the release that was rolled back to).
for link in "$WP_CONTENT"/themes/* "$WP_CONTENT"/plugins/* "$WEB_ROOT"/*; do
    [ -L "$link" ] || continue
    case $(readlink "$link") in
        "$CURRENT"/*)
            if [ ! -e "$link" ]; then
                rm -f -- "$link"
                log "unlinked ${link#"$WEB_ROOT"} (not in the live release)"
            fi
            ;;
    esac
done
