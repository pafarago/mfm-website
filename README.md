# Midlothian Friends Meeting website

WordPress theme and plugins for <https://midlothianfriends.freeddns.org>.
The folders mirror the server's `wp-content`, so a path here is the same path there.

```
wp-content/
  themes/mfm-theme/      phone-first theme (replaces mfm-classic)
  plugins/mfm-docs/      Drive document lists and cached PDF/Word copies (replaces embed-all-shortcode)
  plugins/mfm-mail/      sends WordPress mail through the Gmail API, From records@
site/                    standalone pages and files served from the web root
                         (site/update/ → /update/, site/logo.png → /logo.png)
deploy/
  hooks/pre-receive      build, check and switch a release on push
  link.sh                link themes, plugins and site/ into place
  rollback.sh            switch back to an earlier release
  server-setup.sh        one-time droplet setup (safe to re-run)
  deploy.conf.example    settings, copied to /srv/mfm/deploy.conf
```

Only folders in this repo are managed. Everything else in `wp-content`
(uploads, other plugins, the old theme) and in the web root (WordPress
itself, `.htaccess`, `.well-known`) is never touched.

## How deploying works

```
WSL:  git push droplet main
        │
droplet /srv/mfm/repo.git  ── pre-receive hook
        1. checks out the commit into /srv/mfm/releases/<time>-<commit>/
        2. composer install --no-dev   (only where composer.json exists)
        3. php -l on every PHP file we ship; no site/ name may shadow
           WordPress (wp-*, dotfiles, index.php, xmlrpc.php …)
           └─ any failure: push rejected, live site unchanged
        4. /srv/mfm/current → new release   (one atomic rename)
        5. link.sh: wp-content/themes/<name>, wp-content/plugins/<name>
           and <web root>/<name> for each entry in site/ are links
           into /srv/mfm/current/…
        6. reloads PHP so cached paths refresh
        7. keeps the newest 5 releases
```

A theme folder is linked once it has a `style.css`; a plugin folder once it
has a top-level `.php` file; anything at the top of `site/` always. A real
(non-link) file or folder with the same name is never replaced, so the old
copy keeps running until you move it aside, and links for things no longer
in the live release are removed. `rollback.sh` runs `link.sh` too, and you
can run `/srv/mfm/bin/link.sh` by hand at any time.

Files in a release are read-only to WordPress (owned by your login). A
standalone page must not write files next to itself; keep any data it
writes outside `site/`.

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
| Relink after moving an old folder aside | `ssh … /srv/mfm/bin/link.sh` |
| Test site email | `cd /var/www/midlothianfriends && sudo -u www-data wp mfm-mail test you@gmail.com` (on the droplet) |

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

## Email (mfm-mail)

WordPress has no local mail server, and DigitalOcean blocks the mail ports
(25, 465, 587) on droplets, so MFM Mail sends over HTTPS instead. WordPress
builds each message as usual; MFM Mail hands the finished message to the
Gmail API, signed in with the mfm-docs service account acting as
admin@midlothianfriends.org. Every message goes out From
`records@midlothianfriends.org`; a different From set by a form or plugin
becomes the Reply-To. Gmail adds the DKIM signature, so SPF, DKIM and DMARC
pass.

What it depends on (set up 24 Nov 2026):

| Where | Setting |
|---|---|
| Droplet | key file `/var/opt/GoogleAPI/google-service-account.json`, `root:www-data`, mode 640 |
| Cloud Console, project mfm-website-472810 | Gmail API enabled |
| Admin console → Security → API controls → Domain Wide Delegation | the service account's client ID, scope `https://www.googleapis.com/auth/gmail.send` only |
| Gmail as admin@ → Settings → Accounts → Send mail as | records@midlothianfriends.org |

`wp mfm-mail test you@gmail.com --debug` sends a test and shows each step
and Google's answers. Failures are logged with the prefix `mfm-mail:` in the
PHP error log. `MFM_MAIL_FROM`, `MFM_MAIL_FROM_NAME`, `MFM_MAIL_ACT_AS` and
`MFM_MAIL_KEY_FILE` can be overridden in `wp-config.php`.

## Documents (mfm-docs)

Settings → MFM Docs lists the Drive folders shown under `/docs/…`, the
service account address each folder must be shared with, sync status and a
**Refresh documents now** button. `wp mfm-docs status` and `wp mfm-docs sync`
do the same from the shell.

Syncing runs from WordPress cron every 5 minutes. WordPress cron only fires
when someone visits, so add a real cron entry on the droplet (`crontab -e`):

```
*/5 * * * * curl -fsS -o /dev/null https://midlothianfriends.freeddns.org/wp-cron.php
```

Cached copies live in `/var/cache/mfm-docs` (www-data only, outside the web
root). Deleting them is always safe; they are rebuilt when needed.

How the lists read Drive:

- **Titles** are the file names, tidied. Leading sort numbers (`1.0 `,
  `2.1 `, `4) `, `0 `) order the list but are not shown, so
  `0 Handbook Overview & Content` lists first as "Handbook Overview & Content".
  A leading year (`2019 Minutes`) is kept.
- **One row per document.** Files with the same name apart from the extension
  share a row. A Google Doc wins over a PDF or Word file of the same name (its
  PDF is exported again after every edit); otherwise a PDF wins over Word.
  Clicking the title or the PDF button opens the PDF.
- **"Updated <date>"** shows only for changes on or after
  `MFM_DOCS_UPDATED_SINCE` (default `2025-10-01`, overridable in
  `wp-config.php`); older documents show "From archives".
- **Order** is A–Z by name unless a folder's Drive **Description** holds a
  line `sort: date-desc` (newest first) or `sort: date-asc` (oldest first).
  Sub-folders inherit it until one has its own line; `sort: name` switches
  back to A–Z. Dates come from the name (`2025-10-02`, `10-2-2025`,
  `10/2/2025`, `October 2, 2025`, `2 Oct 2025`, `Oct 2025`, or a year);
  items without one come last, A–Z. Changes show after the next sync.

## Cutover from mfm-classic / embed-all-shortcode

1. Push; check the log shows `linked themes/mfm-theme` and `linked plugins/mfm-docs`.
2. Activate **MFM Docs**. In Settings → MFM Docs check every status line is ✔,
   click **Refresh documents now**, and open each folder's **View** link.
3. Add the cron line above.
4. Preview **MFM Theme** (Appearance → Themes → Live Preview), assign the menu
   to **Main menu**, then **Activate & Publish**.
5. Deactivate **Embed All Shortcode**. Old `/embed?id=…` links now redirect
   to `/docs/…`, and `[embed-all]` / `[mfm_doc]` in pages keep working.
6. In Appearance → Menus, change the Handbook and Public Documents links to
   `/docs/handbook/` and `/docs/public-documents/`.
7. After a week: delete `wp-content/themes/mfm-classic`,
   `wp-content/plugins/embed-all-shortcode`, `wp-content/uploads/embedall-cache`
   and the `.htaccess` rule that protected that cache.
