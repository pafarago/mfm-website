# QTC → News

Publishes each Quaker Town Crier issue sent to the quaker-town-crier@ Google
Group as a post in the website's News category. Runs hourly in
admin@midlothianfriends.org's Apps Script. See the comment at the top of
`Code.js` for what it does and which script properties it needs.

## Setup

1. **WordPress:** Users → Add New: `qtc-publisher`, role **Author**. Then
   Users → qtc-publisher → Application Passwords → name "QTC Apps Script" →
   Add. Copy the password (shown once).
2. **Apps Script**, signed in as admin@: script.google.com → New project,
   name it "QTC → News". Paste `Code.js` into Code.gs. Project Settings →
   tick "Show appsscript.json", then paste `appsscript.json` over it.
3. Project Settings → Script properties: `WP_URL` =
   `https://midlothianfriends.org`, `WP_USER` = `qtc-publisher`,
   `WP_APP_PASSWORD` = the password from step 1.
4. Run `testConnection` (approve the permissions), then `dryRunAll` and read
   the log.
5. Run `backfill` to publish the issues already in the mailbox, then
   `installTrigger` for the hourly check.

## Rules

- Only messages from clerk@, admin@ or records@ that came through the group
  (List-ID header, or admin@'s own sent copy) are published.
- The title is built from the date in the subject: "Quaker Town Crier -
  November 13, 2026". A subject with no date is used as it is.
- A later issue with the same title (a corrected re-send) updates the existing
  post instead of adding one. It can only update posts made by qtc-publisher.
- Handled messages get the Gmail label "QTC Published". If one fails, admin@
  gets one email and the script retries every hour.
- To stop: delete the trigger (Triggers, the clock icon). To republish a
  message, remove its ID from the `DONE_IDS` script property.
