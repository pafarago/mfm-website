# Midlothian Friends Meeting website

WordPress theme and plugins for <https://midlothianfriends.freeddns.org>.
The folders mirror the server's `wp-content`, so a path here is the same path there.

```
wp-content/
  themes/mfm-theme/      phone-first theme (replaces mfm-classic)
  plugins/mfm-docs/      Drive document trees (replaces embed-all-shortcode)
deploy/
  hooks/pre-receive      build, check and switch a release on push
  rollback.sh            switch back to an earlier release
  server-setup.sh        one-time droplet setup (safe to re-run)
  deploy.conf.example    settings, copied to /srv/mfm/deploy.conf
```

Only folders in this repo are managed. Everything else in `wp-content`
(uploads, other plugins, the old theme) is never touched.

## How deploying works

```
WSL:  git push droplet main
        │
droplet /srv/mfm/repo.git  ── pre-receive hook
        1. checks out the commit into /srv/mfm/releases/<time>-<commit>/
        2. composer install --no-dev   (only where composer.json exists)
        3. php -l on every PHP file we ship
           └─ any failure: push rejected, live site unchanged
        4. /srv/mfm/current → new release   (one atomic rename)
        5. wp-content/themes/<name>, wp-content/plugins/<name>
           are links into /srv/mfm/current/wp-content/…
        6. reloads PHP so cached paths refresh
        7. keeps the newest 5 releases
```

A theme folder is linked once it has a `style.css`; a plugin folder once it
has a top-level `.php` file. A real (non-link) folder with the same name in
`wp-content` is never replaced, so the old site keeps running until cutover.

`vendor/` is never committed; the hook builds it on the server. Do commit
`composer.lock`, so the server installs exactly the versions you tested.

## First-time setup

On the droplet (once; re-run after changing anything in `deploy/`):

```bash
scp -r deploy peter@midlothianfriends.freeddns.org:~/mfm-deploy
ssh peter@midlothianfriends.freeddns.org 'bash ~/mfm-deploy/server-setup.sh'
```

Then follow the "Remaining manual step" it prints (a sudoers line so the
hook can reload PHP, and checking `RELOAD_CMD` in `/srv/mfm/deploy.conf`).

On WSL:

```bash
git remote add origin  git@github.com:pafarago/mfm-website.git
git remote add droplet peter@midlothianfriends.freeddns.org:/srv/mfm/repo.git
git push -u origin main
git push droplet main
```

To push to both with one command, make the droplet the first push URL so
a rejected deploy stops before GitHub is updated:

```bash
git remote set-url --add --push origin peter@midlothianfriends.freeddns.org:/srv/mfm/repo.git
git remote set-url --add --push origin git@github.com:pafarago/mfm-website.git
git push origin main
```

## Everyday use

| Task | Command |
|---|---|
| Deploy | `git push droplet main` |
| Store work without deploying | push any other branch |
| See releases | `ssh … /srv/mfm/bin/rollback.sh --list` |
| Roll back one release | `ssh … /srv/mfm/bin/rollback.sh` |
| Roll back to a named release | `ssh … /srv/mfm/bin/rollback.sh 20261121-153000-abc1234` |
| Deploy log | `ssh … tail -50 /srv/mfm/deploy.log` |

Rolling back changes only what is live, not git. Fix forward with a new
commit, or `git revert`, and push.

## Server paths

| Path | What |
|---|---|
| `/srv/mfm/repo.git` | bare repo you push to |
| `/srv/mfm/releases/` | one folder per deploy |
| `/srv/mfm/current` | link to the live release |
| `/srv/mfm/deploy.conf` | settings |
| `/srv/mfm/deploy.log` | deploy and rollback history |
| `/var/cache/mfm-docs` | document cache used by mfm-docs (www-data only) |

## Cutover from mfm-classic / embed-all-shortcode

1. Push; check the log shows `linked themes/mfm-theme` and `linked plugins/mfm-docs`.
2. Activate **mfm-docs** and check documents as an admin.
3. Preview **mfm-theme** (Appearance → Themes → Live Preview), then activate.
4. Deactivate **embed-all-shortcode**.
5. Change the Handbook and Public Documents menu links to their `/docs/…` addresses
   (old `/embed?id=…` links keep working through a redirect).
6. After a week, delete `wp-content/themes/mfm-classic` and
   `wp-content/plugins/embed-all-shortcode` from the server.
