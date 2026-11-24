#!/usr/bin/env bash
# One-time (and safe to re-run) setup on the droplet. Run as your normal
# login user (e.g. peter); it uses sudo only where it must.
#
#   scp -r deploy peter@midlothianfriends.freeddns.org:~/mfm-deploy
#   ssh peter@midlothianfriends.freeddns.org 'bash ~/mfm-deploy/server-setup.sh'
#
# Re-run it whenever deploy/hooks/pre-receive or rollback.sh changes.

set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BASE=/srv/mfm
WEB_ROOT=/var/www/midlothianfriends
WP_CONTENT=$WEB_ROOT/wp-content
DOC_CACHE=/var/cache/mfm-docs
ME=$(id -un)

say() { printf '\n== %s\n' "$*"; }

say "Folders under $BASE (owned by $ME)"
sudo mkdir -p "$BASE/releases" "$BASE/bin"
sudo chown -R "$ME": "$BASE"

say "Bare repository $BASE/repo.git"
if [ ! -d "$BASE/repo.git" ]; then
    git init --bare --initial-branch=main "$BASE/repo.git"
fi
git --git-dir="$BASE/repo.git" config receive.denyDeletes true
git --git-dir="$BASE/repo.git" config receive.denyNonFastForwards false

say "Hook, link and rollback scripts"
install -m 755 "$HERE/hooks/pre-receive" "$BASE/repo.git/hooks/pre-receive"
install -m 755 "$HERE/rollback.sh" "$BASE/bin/rollback.sh"
install -m 755 "$HERE/link.sh" "$BASE/bin/link.sh"
if [ ! -f "$BASE/deploy.conf" ]; then
    install -m 644 "$HERE/deploy.conf.example" "$BASE/deploy.conf"
    echo "Created $BASE/deploy.conf from the example. Review it."
else
    echo "$BASE/deploy.conf already exists; left as is."
fi

say "Let $ME create links in the web root, wp-content/themes and wp-content/plugins"
command -v setfacl >/dev/null || sudo apt-get install -y acl
sudo setfacl -m "u:$ME:rwx" "$WEB_ROOT" "$WP_CONTENT/themes" "$WP_CONTENT/plugins"

say "Document cache $DOC_CACHE (www-data only, outside the web root)"
sudo mkdir -p "$DOC_CACHE"
sudo chown www-data:www-data "$DOC_CACHE"
sudo chmod 750 "$DOC_CACHE"

say "Checks"
for cmd in git php composer libreoffice; do
    if command -v "$cmd" >/dev/null; then echo "ok       $cmd"; else echo "MISSING  $cmd"; fi
done
if apache2ctl -M 2>/dev/null | grep -q xsendfile; then
    echo "ok       mod_xsendfile"
else
    echo "absent   mod_xsendfile (optional; PHP streaming will be used)"
fi
# Which process runs PHP for the site? mod_php inside Apache, or PHP-FPM
# (a separate service that an Apache reload does not touch).
if apache2ctl -M 2>/dev/null | grep -qE 'php[0-9_]*_module'; then
    php_service=apache2
else
    php_service=$(systemctl list-units --type=service --state=running --no-legend --plain 'php*-fpm.service' 2>/dev/null \
        | awk '{print $1}' | sed 's/\.service$//' | sort -V | tail -1)
fi
if [ -z "$php_service" ]; then
    echo "WARNING  could not tell how PHP runs; check RELOAD_CMD in $BASE/deploy.conf by hand"
    php_service=apache2
fi
reload="sudo /usr/bin/systemctl reload $php_service"
echo "PHP runs under: $php_service"
if grep -q '^RELOAD_CMD=' "$BASE/deploy.conf" && ! grep -qF "RELOAD_CMD=\"$reload\"" "$BASE/deploy.conf"; then
    sed -i "s#^RELOAD_CMD=.*#RELOAD_CMD=\"$reload\"#" "$BASE/deploy.conf"
    echo "Updated RELOAD_CMD in $BASE/deploy.conf to: $reload"
fi

say "Remaining manual step"
cat <<EOF
Allow the reload without a password:

  echo '$ME ALL=(root) NOPASSWD: /usr/bin/systemctl reload $php_service' | sudo tee /etc/sudoers.d/mfm-deploy
  sudo chmod 440 /etc/sudoers.d/mfm-deploy && sudo visudo -c

Then, on your WSL machine:

  git remote add droplet $ME@midlothianfriends.freeddns.org:$BASE/repo.git
  git push droplet main
EOF
