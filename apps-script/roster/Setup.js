/**
 * One-time conversion of the COPIED roster spreadsheet to the new layout.
 *
 * Before running: set ROSTER_SHEET_ID (and ROSTER_PINS) in the script properties.
 * Then choose convertRoster in the function list and click Run (approve the permissions it asks for).
 *
 * It rewrites the FIRST tab of that spreadsheet as the "Roster" tab:
 *   Email | First name | Last name | Phone | Address 1 | Address 2 | City | State | ZIP |
 *   Status | ID | Updated | Updated by
 * Any other columns (QTC, Survey, DIRECTORY...) are dropped, if you haven't already deleted them.
 *
 * Every record must have its own, unique email. Rows with no email, and later rows repeating an
 * email already used, are NOT copied; they're listed on a "Conversion review" tab with all their
 * details. Rows whose address couldn't be split cleanly are listed there too.
 *
 * Works on the copy only; the original spreadsheet and the old editor are untouched.
 * If the result isn't right, make a fresh copy of the original, update ROSTER_SHEET_ID and run it again.
 */

var REVIEW_TAB = 'Conversion review';
var NEW_HEADERS = ['Email', 'First name', 'Last name', 'Phone', 'Address 1', 'Address 2',
  'City', 'State', 'ZIP', 'Status', 'ID', 'Updated', 'Updated by'];

function convertRoster() {
  var id = PropertiesService.getScriptProperties().getProperty('ROSTER_SHEET_ID');
  if (!id) throw new Error('Set ROSTER_SHEET_ID in the script properties first.');
  var ss = SpreadsheetApp.openById(id);
  if (ss.getSheetByName(ROSTER_TAB)) throw new Error('This spreadsheet already has a "' + ROSTER_TAB + '" tab.');
  var sh = ss.getSheets()[0];

  var data = sh.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col(name) {
    var i = head.indexOf(name.toLowerCase());
    if (i === -1) throw new Error('Column "' + name + '" not found on tab "' + sh.getName() + '".');
    return i;
  }
  var iEmail = col('Email'), iFirst = col('First name'), iLast = col('Last name'),
      iPhone = col('Phone'), iAddr = col('Address');

  var out = [], review = [], seenEmail = {}, used = {}, now = new Date(), skipped = 0;

  for (var n = 1; n < data.length; n++) {
    var r = data[n];
    var email = String(r[iEmail]).trim().toLowerCase();
    var first = String(r[iFirst]).trim(), last = String(r[iLast]).trim();
    var phone = String(r[iPhone]).trim(), rawAddr = String(r[iAddr]);
    if (!email && !first && !last && !phone && !rawAddr.trim()) continue; // blank row

    var name = (first + ' ' + last).trim();
    var a = parseAddress_(rawAddr);
    var split = [a.address1, a.address2, a.city, a.state, a.zip].join(' | ');

    if (!email) {
      review.push(['NOT COPIED: no email', name, email, phone, rawAddr, split, '']);
      skipped++;
      continue;
    }
    if (seenEmail[email]) {
      review.push(['NOT COPIED: email already used by ' + seenEmail[email], name, email, phone, rawAddr, split, '']);
      skipped++;
      continue;
    }
    seenEmail[email] = name || email;

    var problems = a.problems.slice();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('Email looks invalid');

    var rid = newId_(used);
    out.push([email, first, last, normalizePhone_(phone),
      a.address1, a.address2, a.city, a.state, a.zip, 'Active', rid, now, 'conversion']);
    if (problems.length) review.push(['Check: ' + problems.join('; '), name, email, phone, rawAddr, split, rid]);
  }

  out.sort(function (x, y) {
    return (x[2] + ' ' + x[1]).toLowerCase().localeCompare((y[2] + ' ' + y[1]).toLowerCase());
  });

  // Rewrite the first tab as the Roster tab
  sh.clear();
  sh.setName(ROSTER_TAB);
  if (sh.getMaxColumns() > NEW_HEADERS.length) {
    sh.deleteColumns(NEW_HEADERS.length + 1, sh.getMaxColumns() - NEW_HEADERS.length);
  }
  var rows = Math.max(sh.getMaxRows(), out.length + 1);
  sh.getRange(1, 1, rows, 11).setNumberFormat('@');                 // Email..ID as plain text
  sh.getRange(2, 12, rows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(1, 1, 1, NEW_HEADERS.length).setValues([NEW_HEADERS]).setFontWeight('bold');
  if (out.length) sh.getRange(2, 1, out.length, NEW_HEADERS.length).setValues(out);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, NEW_HEADERS.length);

  // Review tab (at the end, so the Roster stays first)
  var rv = ss.getSheetByName(REVIEW_TAB);
  if (rv) rv.clear(); else rv = ss.insertSheet(REVIEW_TAB, ss.getSheets().length);
  review.sort(function (x, y) { return x[0].localeCompare(y[0]); });  // "Check" rows before "NOT COPIED"
  rv.getRange(1, 1, 1, 7).setValues([['Issue', 'Name', 'Email', 'Phone', 'Original address', 'Split as', 'ID']])
    .setFontWeight('bold');
  if (review.length) rv.getRange(2, 1, review.length, 7).setNumberFormat('@').setValues(review);
  rv.setFrozenRows(1);
  rv.getRange('E:E').setWrap(true);

  audit_('Conversion', '', '', Session.getEffectiveUser().getEmail(),
    out.length + ' records created; ' + skipped + ' rows not copied (see "' + REVIEW_TAB + '" tab)');

  Logger.log('Copied %s records; %s not copied (no email or duplicate email); %s rows listed on the "%s" tab. ' +
    'Audit log: %s', out.length, skipped, review.length, REVIEW_TAB, auditSheet_().getParent().getUrl());
}

/**
 * Splits a multi-line address cell into parts. Typical inputs:
 *   "7812 Hampton Summit Ter\nChesterfield\nVA\n23832"
 *   "Richmond, VA\nUS"     "123 Main St\nApt 4\nRichmond, VA 23225"
 * Returns {address1, address2, city, state, zip, problems[]}.
 */
function parseAddress_(raw) {
  var a = { address1: '', address2: '', city: '', state: '', zip: '', problems: [] };
  var s = String(raw || '').replace(/\r/g, '');
  if (!s.trim()) return a; // no address is fine

  var fixed = fixMojibake_(s);
  if (fixed !== s) { a.problems.push('Garbled characters were repaired; please confirm'); s = fixed; }
  if (/[ÃÂ�]/.test(s)) a.problems.push('Garbled characters');

  var lines = s.split('\n').map(function (l) { return l.trim().replace(/,$/, ''); })
    .filter(function (l) { return l; });

  // Country
  var lastLine = lines[lines.length - 1];
  if (/^(US|USA|United States( of America)?)$/i.test(lastLine)) lines.pop();
  else lines[lines.length - 1] = lastLine.replace(/[\s,]+(US|USA|United States)$/i, '');

  // ZIP on its own line
  if (lines.length && /^\d{5}(-\d{4})?$/.test(lines[lines.length - 1])) a.zip = lines.pop();

  // State on its own line
  if (lines.length > 1 && /^[A-Za-z]{2}$/.test(lines[lines.length - 1])) {
    a.state = lines.pop().toUpperCase();
  }

  if (lines.length) {
    var tail = lines[lines.length - 1];
    if (!a.state) {
      // "City, ST", "City, ST 12345" or "City ST 12345"
      var m = tail.match(/^(.+?),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/) ||
              tail.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m && US_STATES.indexOf(m[2].toUpperCase()) !== -1) {
        lines.pop();
        a.city = m[1].trim();
        a.state = m[2].toUpperCase();
        if (m[3]) a.zip = m[3];
      }
    } else if (lines.length > 1 || !/\d/.test(tail)) {
      a.city = lines.pop(); // the line just above the state
    }
  }

  a.address1 = lines[0] || '';
  a.address2 = lines.slice(1).join(', ');

  if (lines.length > 2) a.problems.push('More than two street lines (extra lines joined into Address 2)');
  if (!a.city) a.problems.push('No city found');
  if (!a.state) a.problems.push('No state found');
  else if (US_STATES.indexOf(a.state) === -1) a.problems.push('Unrecognized state "' + a.state + '"');
  if (!a.zip) a.problems.push('No ZIP found');
  return a;
}

/**
 * Undoes text that was UTF-8 encoded and then misread as Windows-1252, possibly more than once
 * (e.g. "Ã‚Â½" -> "Â½" -> "½"). Returns the input unchanged if it can't be repaired cleanly.
 */
var CP1252_ = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
  0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };

function fixMojibake_(s) {
  for (var pass = 0; pass < 3 && /[Â-ô][\u0080-¿Œ-™]/.test(s); pass++) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 256) bytes.push(c);
      else if (CP1252_[c] !== undefined) bytes.push(CP1252_[c]);
      else return s;
    }
    var decoded = Utilities.newBlob(bytes.map(function (b) { return b > 127 ? b - 256 : b; }))
      .getDataAsString('UTF-8');
    if (decoded.indexOf('�') !== -1) return s;
    s = decoded;
  }
  return s;
}
