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
WP_CONTENT=/var/www/midlothianfriends/wp-content
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

say "Hook and rollback script"
install -m 755 "$HERE/hooks/pre-receive" "$BASE/repo.git/hooks/pre-receive"
install -m 755 "$HERE/rollback.sh" "$BASE/bin/rollback.sh"
if [ ! -f "$BASE/deploy.conf" ]; then
    install -m 644 "$HERE/deploy.conf.example" "$BASE/deploy.conf"
    echo "Created $BASE/deploy.conf from the example. Review it."
else
    echo "$BASE/deploy.conf already exists; left as is."
fi

say "Let $ME create links in wp-content/themes and wp-content/plugins"
sudo setfacl -m "u:$ME:rwx" "$WP_CONTENT/themes" "$WP_CONTENT/plugins"

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
if systemctl list-units --type=service --state=running 2>/dev/null | grep -q 'php.*-fpm'; then
    fpm=$(systemctl list-units --type=service --state=running | grep -o 'php[0-9.]*-fpm' | head -1)
    echo "PHP runs under $fpm: set RELOAD_CMD=\"sudo /usr/bin/systemctl reload $fpm\" in $BASE/deploy.conf"
else
    echo "PHP runs inside Apache: RELOAD_CMD=\"sudo /usr/bin/systemctl reload apache2\" is right"
fi

say "Remaining manual step"
cat <<EOF
Allow the reload without a password (adjust the service name to match RELOAD_CMD):

  echo '$ME ALL=(root) NOPASSWD: /usr/bin/systemctl reload apache2' | sudo tee /etc/sudoers.d/mfm-deploy
  sudo chmod 440 /etc/sudoers.d/mfm-deploy && sudo visudo -c

Then, on your WSL machine:

  git remote add droplet $ME@midlothianfriends.freeddns.org:$BASE/repo.git
  git push droplet main
EOF
