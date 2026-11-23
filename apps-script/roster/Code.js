/**
 * MFM Roster Editor: standalone web app (server side)
 *
 * Deploy as a web app:  Execute as: Me (admin@midlothianfriends.org)   Who has access: Anyone
 *
 * Script properties (Project Settings -> Script properties):
 *   ROSTER_SHEET_ID   ID of the roster spreadsheet (the long string in its URL)
 *   AUDIT_SHEET_ID    set automatically the first time the audit log is created
 *   ROSTER_PINS       (old way, used only while there is no "PINs" tab) email:password pairs
 *
 * Who may sign in: the hidden, protected "PINs" tab of the roster spreadsheet, columns
 *   Email | Password | Notes      (one person per row)
 * A password is 4 to 64 characters: letters, digits, spaces and the usual punctuation (printable ASCII).
 * Old 4-digit PINs are simply short passwords and keep working.
 * The admin's row (PREVIEW_ADMIN, see Webhook.gs) is also the password for the Friendly Contacts preview.
 * Adding, changing or removing a row takes effect within a minute; no redeploy needed.
 *
 * Changes to script properties take effect immediately; no redeploy needed.
 * Code changes need Deploy -> Manage deployments -> edit -> New version.
 */

// Change this with every update, together with PAGE_VERSION in Index.html.
// The editor's footer shows both, and warns if they differ.
var VERSION = '2026-11-20w25';

var ROSTER_TAB = 'Roster';
var PINS_TAB = 'PINs';
var PINS_HEADERS = ['Email', 'Password', 'Notes'];
var AUDIT_TAB = 'Log';
var AUDIT_HEADERS = ['When', 'Action', 'Record ID', 'Email', 'Changed by', 'Changes'];

var SESSION_SECONDS = 6 * 60 * 60;   // sign-in lasts 6 hours
var MAX_FAILURES = 5;                // wrong passwords before lockout
var LOCKOUT_SECONDS = 60 * 60;       // lockout lasts 1 hour

// record field -> sheet header
var FIELDS = {
  email: 'Email', first: 'First name', last: 'Last name', phone: 'Phone',
  address1: 'Address 1', address2: 'Address 2', city: 'City', state: 'State', zip: 'ZIP',
  status: 'Status', id: 'ID', updated: 'Updated', updatedBy: 'Updated by'
};
var CONTENT_FIELDS = ['email', 'first', 'last', 'phone', 'address1', 'address2', 'city', 'state', 'zip'];

var US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE',
  'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'VI', 'GU', 'AS', 'MP',
  'AA', 'AE', 'AP'];

// ---------------------------------------------------------------- page

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Roster');
  t.serverVersion = VERSION;
  return t.evaluate()
    .setTitle('MFM Roster Editor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------- sign-in & sessions

/** Checks email + password. Returns {token, email}. Every attempt is logged. */
function signIn(email, pin) {
  email = String(email || '').trim().toLowerCase();
  checkPassword_(email, pin);
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, email, SESSION_SECONDS);
  audit_('Sign-in', '', email, email, '');
  return { token: token, email: email };
}

/**
 * Throws unless the password matches that email's row in the PINs tab. Shared by the editor's sign-in and
 * the Friendly Contacts preview, so wrong attempts in either count toward the same lockout.
 */
/**
 * The form of an address used to tell whether two addresses reach the same mailbox (w24). Records keep the
 * address as entered; this is only for matching.
 *   gmail.com, googlemail.com: dots and anything after "+" are ignored (Gmail delivers them all to one inbox)
 *   Outlook, Hotmail, Live, MSN, iCloud, Me, Mac: anything after "+" is ignored; dots count
 *   every other domain, the Meeting's own included: exact (ignoring capitals)
 */
var PLUS_TAG_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com'];
function emailKey_(email) {
  var e = String(email || '').trim().toLowerCase();
  var at = e.lastIndexOf('@');
  if (at < 1) return e;
  var local = e.slice(0, at), domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (PLUS_TAG_DOMAINS.indexOf(domain) !== -1) local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

/**
 * Run from the editor: lists roster records whose addresses reach the same mailbox under emailKey_
 * (for example jane.v.roberson@gmail.com and janevroberson@gmail.com), so they can be merged by hand.
 */
function findEquivalentEmails() {
  var data = rosterSheet_().getDataRange().getValues();
  var cols = columns_(data[0]);
  var byKey = {};
  for (var i = 1; i < data.length; i++) {
    var e = String(data[i][cols.email]).trim();
    if (!e) continue;
    (byKey[emailKey_(e)] = byKey[emailKey_(e)] || []).push('row ' + (i + 1) + ': ' + e + ' (' +
      (data[i][cols.first] + ' ' + data[i][cols.last]).trim() + (isArchived_(data[i], cols) ? ', archived' : '') + ')');
  }
  var found = Object.keys(byKey).filter(function (k) { return byKey[k].length > 1; });
  found.forEach(function (k) { Logger.log(k + '\n  ' + byKey[k].join('\n  ')); });
  Logger.log(found.length ? found.length + ' set(s) of records share a mailbox.' : 'No records share a mailbox.');
}

function checkPassword_(email, password) {
  function fail(msg) { var e = new Error(msg); e.user = true; return e; }
  email = String(email || '').trim().toLowerCase();
  password = String(password || '').trim();
  if (!email || !password) throw fail('Enter your email and password.');

  var cache = CacheService.getScriptCache();
  var locked = 'Too many wrong passwords. Sign-in for this email is paused for up to an hour.';
  if (cache.get('lock_' + email)) throw fail(locked);

  var pins = readPins_();
  if (pins[email] && pins[email] === password) {
    cache.remove('fail_' + email);
    return true;
  }

  // Wrong password, or an email not on the list: same message either way.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var fails;
  try {
    fails = Number(cache.get('fail_' + email) || 0) + 1;
    cache.put('fail_' + email, String(fails), LOCKOUT_SECONDS);
  } finally {
    lock.releaseLock();
  }

  if (fails >= MAX_FAILURES) {
    cache.put('lock_' + email, '1', LOCKOUT_SECONDS);
    cache.remove('fail_' + email);
    audit_('Locked out', '', email, '', fails + ' wrong passwords');
    notifyAdmin_('Roster Editor: sign-in locked for ' + email,
      'There were ' + fails + ' wrong passwords for ' + email + '. Sign-in for that email is paused for an hour.\n\n' +
      (pins[email] ? 'This email is on the PINs tab.' : 'This email is NOT on the PINs tab.'));
    throw fail(locked);
  }
  audit_('Sign-in failed', '', email, '', 'Attempt ' + fails + ' of ' + MAX_FAILURES);
  throw fail('That email and password don\'t match.');
}

function signOut(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
}

/** Returns the signed-in email, or throws SESSION: (the page then shows the sign-in box). */
function requireSession_(token) {
  var email = token && CacheService.getScriptCache().get('sess_' + token);
  if (!email || !readPins_()[email]) {   // removing someone from the PINs tab ends their access within a minute
    throw new Error('SESSION: Please sign in again.');
  }
  return email;
}

/**
 * Who may sign in, as {email: password}. Read from the "PINs" tab of the roster spreadsheet, or from the
 * ROSTER_PINS property while that tab doesn't exist yet. Kept for a minute so each click doesn't reread it.
 * Bad entries are skipped and reported to admin (at most every 6 hours, and never with the password).
 */
function readPins_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('pins');
  if (hit) return JSON.parse(hit);

  var pins = {}, bad = [], source;
  function addPin(email, pin, label) {
    email = String(email || '').trim().toLowerCase();
    pin = String(pin || '').trim();
    if (!email && !pin) return;
    if (/^\d{1,3}$/.test(pin)) pin = ('000' + pin).slice(-4);   // a number cell drops leading zeros: 937 -> 0937
    if (/^[^\s:@]+@[^\s:@]+\.[^\s:]+$/.test(email) && /^[\x20-\x7E]{4,64}$/.test(pin)) pins[email] = pin;
    else bad.push(label + (email || '(no email)') + (pin ? ' (password must be 4 to 64 ordinary characters)' : ' (no password)'));
  }

  var sh = SpreadsheetApp.openById(rosterId_()).getSheetByName(PINS_TAB);
  if (sh) {
    source = 'the "' + PINS_TAB + '" tab';
    sh.getDataRange().getDisplayValues().slice(1).forEach(function (r, i) {
      addPin(r[0], r[1], 'Row ' + (i + 2) + ': ');
    });
  } else {
    source = 'ROSTER_PINS';
    var raw = PropertiesService.getScriptProperties().getProperty('ROSTER_PINS') || '';
    raw.split(/[,\n;]/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var i = part.lastIndexOf(':');
      addPin(i === -1 ? part : part.slice(0, i), i === -1 ? '' : part.slice(i + 1), '');
    });
  }

  if (bad.length && !cache.get('pinwarn')) {
    cache.put('pinwarn', '1', 21600);
    notifyAdmin_('Roster Editor: problem in ' + source,
      'These entries were skipped. Each needs an email address and a password of 4 to 64 ordinary characters ' +
      '(letters, digits, spaces and the usual punctuation).\n\n' + bad.join('\n'));
  }
  cache.put('pins', JSON.stringify(pins), 60);
  return pins;
}

function rosterId_() {
  var id = PropertiesService.getScriptProperties().getProperty('ROSTER_SHEET_ID');
  if (!id) throw new Error('ROSTER_SHEET_ID is not set in the script properties.');
  return id;
}

/**
 * Run once from the editor: makes the hidden, protected "PINs" tab from ROSTER_PINS.
 * Afterwards check the tab, then delete the ROSTER_PINS property.
 */
function createPinsTab() {
  var ss = SpreadsheetApp.openById(rosterId_());
  if (ss.getSheetByName(PINS_TAB)) throw new Error('The roster spreadsheet already has a "' + PINS_TAB + '" tab.');
  CacheService.getScriptCache().remove('pins');
  var pins = readPins_();   // still from ROSTER_PINS, since the tab doesn't exist yet
  var rows = Object.keys(pins).sort().map(function (e) { return [e, pins[e], '']; });

  var sh = ss.insertSheet(PINS_TAB, ss.getSheets().length);
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), 50), 2).setNumberFormat('@');   // keeps leading zeros
  sh.getRange(1, 1, 1, 3).setValues([PINS_HEADERS]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 280); sh.setColumnWidth(3, 300);

  // Only the spreadsheet owner may change it. (Anyone who can open the spreadsheet can still unhide and read it.)
  var prot = sh.protect().setDescription('Roster Editor sign-in PINs');
  prot.removeEditors(prot.getEditors());
  if (prot.canDomainEdit()) prot.setDomainEdit(false);
  sh.hideSheet();

  CacheService.getScriptCache().remove('pins');
  Logger.log('Created the hidden "%s" tab with %s people. Check it, then delete the ROSTER_PINS property.',
    PINS_TAB, rows.length);
}

// ---------------------------------------------------------------- data API (called from Index.html)

/** All records, current and archived. Rows typed directly into the sheet get an ID when first loaded. */
function getRecords(token) {
  requireSession_(token);
  return withLock_(function () {
    var sh = rosterSheet_();
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var used = {}, out = [];

    for (var i = 1; i < data.length; i++) used[String(data[i][cols.id])] = true;
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!hasContent_(r, cols)) continue;
      if (!String(r[cols.id]).trim()) {
        r[cols.id] = newId_(used);
        sh.getRange(i + 1, cols.id + 1).setNumberFormat('@').setValue(r[cols.id]);
      }
      out.push(rowToRecord_(r, cols));
    }
    return out;
  });
}

/**
 * Adds (no id) or updates (with id) one record's contact details.
 * rec.updated must be the value the page loaded; if the row changed since, the save is refused.
 */
function saveRecord(token, rec) {
  var user = requireSession_(token);
  var c = cleanRecord_(rec);

  return withLock_(function () {
    var sh = rosterSheet_();
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var rowIndex = -1, used = {};

    for (var i = 1; i < data.length; i++) {
      used[String(data[i][cols.id])] = true;
      if (c.id && String(data[i][cols.id]) === c.id) rowIndex = i;
    }

    if (c.id) {
      if (rowIndex === -1) throw new Error('This record no longer exists. Reload the page.');
      checkStamp_(data[rowIndex], cols, rec.updated);
    }

    // Emails are unique across current AND archived records. Checked only when the email is new or
    // changed, so a duplicate typed directly into the sheet doesn't block other edits.
    var oldEmail = rowIndex === -1 ? '' : String(data[rowIndex][cols.email]).trim().toLowerCase();
    if (c.email !== oldEmail) {
      for (var j = 1; j < data.length; j++) {
        if (j === rowIndex || emailKey_(data[j][cols.email]) !== emailKey_(c.email)) continue;
        var who = (data[j][cols.first] + ' ' + data[j][cols.last]).trim();
        if (isArchived_(data[j], cols)) {
          throw new Error(c.email + ' belongs to an archived record for ' + who +
            '. Turn on "Show archived" and restore that record instead.');
        }
        var theirs = String(data[j][cols.email]).trim().toLowerCase();
        throw new Error(c.email + ' is already used by ' + who +
          (theirs !== c.email ? ' (as ' + theirs + ', which reaches the same mailbox)' : '') + '.');
      }
    }

    var before = rowIndex === -1 ? null : rowToRecord_(data[rowIndex], cols);
    if (before && CONTENT_FIELDS.every(function (f) { return before[f] === c[f]; })) {
      return before;   // nothing changed; don't touch the sheet or the log
    }
    if (!c.id) c.id = newId_(used);

    var width = data[0].length, row;
    if (rowIndex === -1) { row = []; for (var k = 0; k < width; k++) row.push(''); }
    else row = data[rowIndex].slice();
    CONTENT_FIELDS.forEach(function (f) { row[cols[f]] = c[f]; });
    row[cols.id] = c.id;
    if (rowIndex === -1) row[cols.status] = 'Active';
    row[cols.updated] = new Date();
    row[cols.updatedBy] = user;

    var saved = writeRow_(sh, cols, rowIndex, row);
    audit_(before ? 'Update' : 'Create', saved.id, saved.email, user, describeChanges_(before, saved));
    return saved;
  });
}

/** Sets a record's Status to 'Active' or 'Archived'. Nothing is ever deleted. */
function setStatus(token, id, status, updated) {
  var user = requireSession_(token);
  if (status !== 'Active' && status !== 'Archived') throw new Error('Unknown status.');

  return withLock_(function () {
    var sh = rosterSheet_();
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cols.id]) !== String(id)) continue;
      checkStamp_(data[i], cols, updated);
      var row = data[i].slice();
      row[cols.status] = status;
      row[cols.updated] = new Date();
      row[cols.updatedBy] = user;
      var saved = writeRow_(sh, cols, i, row);
      audit_(status === 'Archived' ? 'Archive' : 'Restore', saved.id, saved.email, user, '');
      return saved;
    }
    throw new Error('This record no longer exists. Reload the page.');
  });
}

// ---------------------------------------------------------------- audit log

/** Appends one line to the audit log. A logging failure never blocks the change itself. */
function audit_(action, id, email, by, changes) {
  try {
    auditSheet_().appendRow([new Date(), action, id, email, by, changes]);
  } catch (err) {
    notifyAdmin_('Roster Editor: audit log write failed',
      'Could not log: ' + [action, id, email, by, changes].join(' | ') + '\n\nError: ' + err.message);
  }
}

/** The audit log sheet; the log spreadsheet is created (owned by the script owner) on first use. */
function auditSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('AUDIT_SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('MFM Roster Audit Log');
    props.setProperty('AUDIT_SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(AUDIT_TAB);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(AUDIT_TAB);
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sh.getRange('F:F').setWrap(true);
  }
  return sh;
}

function describeChanges_(before, after) {
  var parts = [];
  CONTENT_FIELDS.forEach(function (f) {
    var a = before ? before[f] : '', b = after[f];
    if (a === b) return;
    parts.push(before ? FIELDS[f] + ': ' + (a || '(blank)') + ' → ' + (b || '(blank)') : FIELDS[f] + ': ' + b);
  });
  return parts.join('; ');
}

// ---------------------------------------------------------------- helpers

function rosterSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('ROSTER_SHEET_ID');
  if (!id) throw new Error('ROSTER_SHEET_ID is not set in the script properties.');
  var sh = SpreadsheetApp.openById(id).getSheetByName(ROSTER_TAB);
  if (!sh) throw new Error('The roster spreadsheet has no "' + ROSTER_TAB + '" tab. Run convertRoster first.');
  return sh;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The roster is busy. Please try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Writes a full row, keeping text columns as text (ZIP leading zeros, no formulas); returns the saved record. */
function writeRow_(sh, cols, rowIndex, row) {
  var sheetRow = rowIndex === -1 ? sh.getLastRow() + 1 : rowIndex + 1;
  if (rowIndex === -1) {
    CONTENT_FIELDS.concat(['id', 'status']).forEach(function (f) {
      sh.getRange(sheetRow, cols[f] + 1).setNumberFormat('@');
    });
    sh.getRange(sheetRow, cols.updated + 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  var range = sh.getRange(sheetRow, 1, 1, row.length);
  range.setValues([row]);
  SpreadsheetApp.flush();
  return rowToRecord_(range.getValues()[0], cols);   // re-read so the page gets exactly what's stored
}

function checkStamp_(row, cols, updated) {
  if (stamp_(row[cols.updated]) !== (updated || '')) {
    throw new Error('Someone changed this record after you opened it. ' +
      'Close this box, reload the page and make your change again.');
  }
}

/** Maps each field to its 0-based column, by header name. */
function columns_(headerRow) {
  var head = headerRow.map(function (h) { return String(h).trim().toLowerCase(); });
  var cols = {}, missing = [];
  Object.keys(FIELDS).forEach(function (f) {
    var i = head.indexOf(FIELDS[f].toLowerCase());
    if (i === -1) missing.push(FIELDS[f]); else cols[f] = i;
  });
  if (missing.length) {
    throw new Error('The roster tab is missing these columns: ' + missing.join(', ') + '.');
  }
  return cols;
}

function hasContent_(r, cols) {
  return CONTENT_FIELDS.some(function (f) { return String(r[cols[f]]).trim() !== ''; });
}

/** "Archived" (or "Inactive", from early testing) means archived; anything else, including blank, is current. */
function isArchived_(r, cols) {
  var s = String(r[cols.status]).trim().toLowerCase();
  return s === 'archived' || s === 'inactive';
}

function rowToRecord_(r, cols) {
  var rec = {};
  CONTENT_FIELDS.concat(['id', 'updatedBy']).forEach(function (f) {
    rec[f] = String(r[cols[f]] == null ? '' : r[cols[f]]).trim();
  });
  rec.status = isArchived_(r, cols) ? 'Archived' : 'Active';   // blank counts as Active
  rec.updated = stamp_(r[cols.updated]);
  return rec;
}

/** Comparable string form of the Updated cell. */
function stamp_(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}

function newId_(used) {
  var id;
  do { id = Utilities.getUuid().slice(0, 8); } while (used[id]);
  used[id] = true;
  return id;
}

/** Trims, validates and normalizes a record from the page. Throws a readable message on bad input. */
function cleanRecord_(rec) {
  function s(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
  var c = {
    id: s(rec.id, 40),
    email: s(rec.email, 120).toLowerCase(),
    first: s(rec.first, 80),
    last: s(rec.last, 80),
    phone: normalizePhone_(s(rec.phone, 40)),
    address1: tidyAddressLine_(s(rec.address1, 120)),
    address2: tidyAddressLine_(s(rec.address2, 120)),
    city: tidyCity_(s(rec.city, 80)),
    state: s(rec.state, 10).toUpperCase(),
    zip: s(rec.zip, 10)
  };
  if (!c.email) throw new Error('Enter an email address. Every person on the roster needs their own.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
    throw new Error('"' + c.email + '" doesn\'t look like an email address.');
  }
  if (!c.first && !c.last) throw new Error('Enter a first or last name.');
  if (c.state && US_STATES.indexOf(c.state) === -1) {
    throw new Error('State should be a two-letter abbreviation, like VA.');
  }
  if (c.zip && !/^\d{5}$/.test(c.zip)) {
    throw new Error('ZIP should be 5 digits.');
  }
  if (c.phone && !validUSPhone_(c.phone)) {
    throw new Error('Phone should be a 10-digit US number with a valid area code, like (804) 555-1234, or blank.');
  }
  return c;
}

// ---------------------------------------------------------------- address tidy-up
// Light, low-risk cleanup for readable addresses (not USPS format). Street-name words and
// abbreviations are left as typed; capitalization is fixed only when a line was typed
// entirely in lowercase or entirely in capitals.

var UNIT_LABELS_ = { '#': 'Apt', apt: 'Apt', apartment: 'Apt', ste: 'Suite', suite: 'Suite', unit: 'Unit', lot: 'Lot' };
var KEEP_CAPS_ = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'PO', 'RR', 'HC'];
var SMALL_WORDS_ = ['of', 'the', 'and', 'at', 'on', 'in'];
// Street abbreviations that get normal capitals even when typed in CAPS (AVE -> Ave).
var STREET_ABBR_ = ['AVE', 'ST', 'RD', 'DR', 'LN', 'CT', 'TER', 'CIR', 'PL', 'HWY', 'SQ', 'TRL', 'WAY', 'PKY', 'EXT'];
// Name particles: kept lowercase mid-line when typed that way in an otherwise capitalized line
// ("12 de la Vina St"), but capitalized when the whole line was typed in lowercase or CAPS.
var PARTICLES_ = ['van', 'von', 'de', 'del', 'della', 'der', 'den', 'di', 'da', 'du', 'la', 'le', 'ter', 'dos', 'das'];

function tidyAddressLine_(s) {
  s = tidySpaces_(s);
  if (!s) return s;
  s = fixCase_(s);
  // "#2b", "apt. 2b", "Apartment 2B", "apt #4", "ste 200", "unit a", "lot 12"  ->  "Apt 2B", "Suite 200", ...
  return s.replace(
    /(^|[\s,])(#|(?:apt\.?|apartment|ste\.?|suite|unit|lot)(?:\s+|\s*#\s*|(?=\d)))([0-9][0-9a-z-]*|[a-z])(?=$|[\s,])/gi,
    function (all, pre, label, id) {
      var key = label.replace(/[.#\s]/g, '').toLowerCase() || '#';
      return pre + UNIT_LABELS_[key] + ' ' + id.toUpperCase();
    });
}

function tidyCity_(s) {
  return fixCase_(tidySpaces_(s));
}

function tidySpaces_(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[\s,]+$/, '').replace(/^[\s,]+/, '');
}

/**
 * Fixes capitalization word by word.
 *  - A line typed entirely in lowercase or CAPS gets normal capitals throughout.
 *  - Otherwise only words typed entirely in lowercase are capitalized ("road" -> "Road");
 *    any word with a capital letter is left as typed (McKinley, MacArthur, NW, iPhone).
 * In a mixed line, a word in CAPS with 4+ letters (MEETING, ROAD) or a street abbreviation (AVE, ST)
 * also gets normal capitals; other 2-3 letter capitals (NW, PO, VCU) are kept.
 * Exceptions: small words (of, the, and...) stay lowercase mid-line; ordinals stay "22nd";
 * N/S/E/W/NE/NW/SE/SW, PO, RR, HC are capitals; "mcdonald" -> "McDonald"; "o'brien" -> "O'Brien".
 */
function fixCase_(s) {
  var letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters) return s;
  var wholeLine = letters === letters.toLowerCase() || letters === letters.toUpperCase();
  var i = 0;
  return s.replace(/[A-Za-z0-9'.\-]+/g, function (w) {
    var first = i++ === 0, bare = w.replace(/\./g, ''), lower = w.toLowerCase();
    if (/^\d+(st|nd|rd|th)$/i.test(w)) return lower;                            // 1st, 22nd
    if (/^\d/.test(w)) return w.toUpperCase();                                  // 12A
    if (!wholeLine && w !== lower) {                                            // has a capital
      var allCaps = w === w.toUpperCase() && /[A-Z]/.test(w);
      if (allCaps && KEEP_CAPS_.indexOf(bare) === -1 &&
          (bare.replace(/[^A-Z]/g, '').length >= 4 || STREET_ABBR_.indexOf(bare) !== -1)) {
        return capitalizeWord_(lower);                                         // MEETING -> Meeting
      }
      return w;                                                                // McKinley, NW: as typed
    }
    if (KEEP_CAPS_.indexOf(bare.toUpperCase()) !== -1) return w.toUpperCase();  // NW, PO
    if (!first && SMALL_WORDS_.indexOf(lower) !== -1) return lower;             // of, the
    if (!first && !wholeLine && PARTICLES_.indexOf(lower) !== -1) return lower; // de, van (typed so)
    return capitalizeWord_(lower);
  });
}

function capitalizeWord_(w) {
  return w.split('-').map(function (part) {
    if (/^mc[a-z]{2,}/.test(part)) return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
    if (/^o'[a-z]/.test(part)) return "O'" + part.charAt(2).toUpperCase() + part.slice(3);
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('-');
}

/** Called from the page when an address field loses focus, so the tidy-up shows before saving. */
function tidyFields(token, f) {
  requireSession_(token);
  return {
    address1: tidyAddressLine_(String(f.address1 || '').slice(0, 120)),
    address2: tidyAddressLine_(String(f.address2 || '').slice(0, 120)),
    city: tidyCity_(String(f.city || '').slice(0, 80))
  };
}

/** Digits of a phone number, with a leading US country code 1 quietly dropped. */
function phoneDigits_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d;
}

/** Exactly 10 digits; area code and exchange start with 2-9 and aren't N11 (411, 911...). */
function validUSPhone_(p) {
  var d = phoneDigits_(p);
  function part(x) { return /^[2-9]\d\d$/.test(x) && !/^[2-9]11$/.test(x); }
  return d.length === 10 && part(d.slice(0, 3)) && part(d.slice(3, 6));
}

/** Valid US numbers become (804) 555-1234; anything else is returned unchanged. */
function normalizePhone_(p) {
  if (!validUSPhone_(p)) return p;
  var d = phoneDigits_(p);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

function notifyAdmin_(subject, body) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  } catch (err) {
    console.error('Could not email admin: ' + err.message);
  }
}
