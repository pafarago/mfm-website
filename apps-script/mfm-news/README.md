# MFM News

Approve once: a message emailed to **mfm-news@midlothianfriends.org** by a
manager or owner of the Quaker Town Crier group is sent to the group and
posted in the website's News category, after its sender clicks Approve.
The comment at the top of `Code.js` describes it in full.

Messages that should not go on the website (directory@ and so on) are sent
straight to their group as before; the script never sees them.

## Setup (once)

1. **Admin console:** add `mfm-news@` and `mfm-news-reply@` as aliases of
   admin@ (Directory → Users → admin → Add alternate emails).
2. **admin@'s Gmail:** Settings → Accounts → Send mail as → Add another
   address: name "Midlothian Friends Meeting News", address
   `mfm-news@midlothianfriends.org`, "Treat as an alias" ticked.
3. **WordPress:** user `qtc-publisher` (Author) with an application password.
4. **Apps Script**, signed in as admin@: one project with `Code.js` (as
   Code.gs), `Confirm.html` (File → New → HTML, name it `Confirm`) and
   `appsscript.json` (Project Settings → Show "appsscript.json").
5. **Deploy → New deployment → Web app**: Execute as *Me*, Who has access
   *Anyone*. Copy the /exec URL.
6. **Script properties:** `WEBAPP_URL` (step 5), `WP_URL`
   (`https://midlothianfriends.org`), `WP_USER`, `WP_APP_PASSWORD`. For a
   trial run also set `GROUP` to a test group and `WEBSITE` to `draft` or
   `off`.
7. Run `testSetup` (approve the permissions) and read the log, then run
   `installTriggers`.

After changing the code: Deploy → Manage deployments → edit → Version: New
version, so the Approve/Deny pages use it. The /exec URL stays the same.

## How it behaves

- Checked every 10 minutes; one review email per message, to its sender:
  "Approval required for <subject>".
- Replies (In-Reply-To, or a subject starting "Re:"), automatic mail and mail
  from anyone who is not a manager or owner of `GROUP` are ignored.
- Approve and Deny links open a confirmation page ("Confirm News Email") that
  needs one more click, so mail scanners that open links can't decide
  anything. The first decision counts; the page says so on later visits.
- Approved messages go to `GROUP` from "Midlothian Friends Meeting News"
  <mfm-news@>, Reply-To mfm-news-reply@ and the author. The website post is
  titled with the subject; pictures and attachments go to the Media Library.
- Mondays around 8 AM, admin@ gets a list (with Approve/Deny links) of
  messages waiting more than 48 hours. No list when nothing is waiting.
- If something fails, admin@ gets one email about it.
