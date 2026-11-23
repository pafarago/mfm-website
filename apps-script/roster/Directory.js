/**
 * MFM directory: the review page and the on-screen directory with PDF download (w17; merged into Friendly Contacts in w25)
 *
 * Same Apps Script project as the Roster Editor and Friendly Contacts. The two pages are hosted on the MFM
 * website and POST to the same /exec URL (doPost in Webhook.gs routes the actions below).
 *
 *   /directory-review/    roster editors (anyone on the PINs tab) sign in with their Roster Editor password,
 *                         see the requests in DIRECTORY_PENDING_GROUP, and Accept or Decline each one.
 *                         Accept: pending -> DIRECTORY_GROUP, Directory Approval Date = today, welcome email.
 *                         Decline: removed from pending, Directory Declined Date = today, email only if asked.
 *                         Both are in the audit log.
 *   /update/ (Friendly Contacts, w25)  the directory opens inside Friendly Contacts, from its home screen,
 *                         for members with directory access (below), after agreeing to the terms of use
 *                         each time. Made fresh from the roster, with Download PDF. Opening and each download
 *                         are in the audit log. The old /directory/ page now just says the directory has moved
 *                         and forwards to /update/.
 *
 * Who is listed (checked at every download and every Accept):
 *   a person (not a nested group) in DIRECTORY_GROUP with a role in DIRECTORY_ROLES,
 *   AND in NEWS_GROUP, AND with an Active roster row for that email.
 * What a listing shows: name and email always; phone if Show phone; address if Show address.
 * Directory access (w25): listed, AND either DIRECTORY_ON is On or the address is in DIRECTORY_TESTERS.
 *
 * Script properties (new in w16):
 *   DIRECTORY_PAGE_URL      https://midlothianfriends.org/directory/   (sign-in links for the directory
 *                           page, and the button in the welcome email; no link emails without it).
 *                           DOWNLOAD_PAGE_URL (w16) is still read if this isn't set.
 *   REVIEW_PAGE_URL         optional: https://midlothianfriends.org/directory-review/   (named in the
 *                           notice of a new request)
 *   FRIENDLY_CONTACTS_URL   optional: printed on the PDF; default https://midlothianfriends.org/update
 *   DIRECTORY_ON            On | Off (w25). Off or missing: nobody sees the directory except testers.
 *                           Requests, review and the choices in Friendly Contacts work either way.
 *   DIRECTORY_TESTERS       optional (w25): addresses, separated by commas, for whom the directory works
 *                           while DIRECTORY_ON is Off. They must still be listed to see it. Also the
 *                           list used by activateDirectoryFor() / deactivateDirectoryFor().
 *   WEBSITE_HOME_URL        optional (w25): where Close Friendly Contacts goes; default https://midlothianfriends.org
 *
 * Try it from the editor: testDirectoryPdf() emails you the PDF exactly as a download would make it.
 */

// Group roles that count as listed. Owners (admin@, clerk@) count too; remove 'OWNER' to leave them out.
var DIRECTORY_ROLES = ['MEMBER', 'MANAGER', 'OWNER'];
var PDF_ROWS = 10;        // entries down each column
var PDF_COLUMNS = 3;      // columns on each page
var FRIENDLY_CONTACTS_DEFAULT = 'https://midlothianfriends.org/update';

// ---------------------------------------------------------------- shared

/** The three group addresses; throws if any is missing. */
function dirGroups_() {
  var p = PropertiesService.getScriptProperties();
  var g = {
    news: (p.getProperty('NEWS_GROUP') || '').trim().toLowerCase(),
    dir: (p.getProperty('DIRECTORY_GROUP') || '').trim().toLowerCase(),
    pending: (p.getProperty('DIRECTORY_PENDING_GROUP') || '').trim().toLowerCase()
  };
  if (!g.news || !g.dir || !g.pending) {
    throw new Error('NEWS_GROUP, DIRECTORY_GROUP and DIRECTORY_PENDING_GROUP must all be set in the script properties.');
  }
  return g;
}

function httpsProperty_(name, fallback) {
  var u = (PropertiesService.getScriptProperties().getProperty(name) || fallback || '').trim().replace(/#.*$/, '');
  return /^https:\/\/[^\s"<>]+$/.test(u) ? u : '';
}
function downloadPageUrl_() { return httpsProperty_('DIRECTORY_PAGE_URL') || httpsProperty_('DOWNLOAD_PAGE_URL'); }
function reviewPageUrl_() { return httpsProperty_('REVIEW_PAGE_URL'); }
function friendlyContactsUrl_() { return httpsProperty_('FRIENDLY_CONTACTS_URL', FRIENDLY_CONTACTS_DEFAULT); }
var WEBSITE_HOME_DEFAULT = 'https://midlothianfriends.org';
function websiteHomeUrl_() { return httpsProperty_('WEBSITE_HOME_URL') || WEBSITE_HOME_DEFAULT; }

/** Where the Accepted email's "Open the directory" button points: Friendly Contacts (sign in, then Directory on Home). */
function directoryLinkUrl_() { return linkPageUrl_(); }

/** DIRECTORY_ON = On (also Yes or True). */
function directoryOn_() {
  return /^(on|yes|true)$/i.test((PropertiesService.getScriptProperties().getProperty('DIRECTORY_ON') || '').trim());
}

/** The DIRECTORY_TESTERS addresses, lowercase. */
function directoryTesters_() {
  return (PropertiesService.getScriptProperties().getProperty('DIRECTORY_TESTERS') || '')
    .split(/[\s,;]+/).map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e.indexOf('@') > 0; });
}

function isDirectoryTester_(email) {
  var k = emailKey_(email);
  return directoryTesters_().some(function (t) { return emailKey_(t) === k; });
}

/** May the directory be shown to this address at all right now (before the listing check)? */
function directoryOpenFor_(email) { return directoryOn_() || isDirectoryTester_(email); }

/** Directory access: the directory is open for them, the groups are set up, and they are listed. */
function directoryAccess_(email) {
  if (!directoryOpenFor_(email)) return false;
  var p = PropertiesService.getScriptProperties();
  if (!['NEWS_GROUP', 'DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP'].every(function (k) { return (p.getProperty(k) || '').trim(); })) return false;
  return directoryStanding_(email).status === 'in';
}

/** A person, not a nested group or the whole organization (external addresses count as people). */
function isPerson_(m) { return !!m && m.type !== 'GROUP' && m.type !== 'CUSTOMER'; }

/** {role, type} of an address in a group, or null if it isn't in the group. */
function memberInfo_(group, email) {
  try {
    var m = AdminDirectory.Members.get(group, email);
    return { role: m.role, type: m.type };
  } catch (err) {
    if (/not found|404/i.test(err.message)) return null;
    throw err;
  }
}

function listedRole_(info) { return isPerson_(info) && DIRECTORY_ROLES.indexOf(info.role) !== -1; }

/**
 * The people in a group, keyed by mailbox (emailKey_): {key: {email, role}}, so jane.v.roberson@gmail.com
 * in a group is found for a roster record of janevroberson@gmail.com. Pass roles to keep only those.
 */
function peopleIn_(group, roles) {
  var out = {};
  listMembers_(group).forEach(function (m) {
    if (m.email && isPerson_(m) && (!roles || roles.indexOf(m.role) !== -1)) {
      out[emailKey_(m.email)] = { email: String(m.email).toLowerCase(), role: m.role };
    }
  });
  return out;
}

/** The group's own address for this person, or '' if they aren't in it (matched by mailbox). */
function inGroup_(group, email, roles) {
  var hit = peopleIn_(group, roles)[emailKey_(email)];
  return hit ? hit.email : '';
}

/** Every roster row for an email: {all: [...], active: [...]}, each {i, record, consent, approved, declined, left, terms}. */
function rosterRowsFor_(email) {
  var sh = rosterSheet_();
  var cc = ensureConsentColumns_(sh);
  var data = sh.getDataRange().getValues();
  var cols = columns_(data[0]);
  var out = { all: [], active: [] };
  for (var i = 1; i < data.length; i++) {
    if (emailKey_(data[i][cols.email]) !== emailKey_(email)) continue;
    var row = { i: i, record: rowToRecord_(data[i], cols), consent: readConsent_(data[i], cc),
                approved: dateCell_(data[i][cc.approved]), declined: dateCell_(data[i][cc.declined]),
                left: dateCell_(data[i][cc.left]), terms: termsDate_(data[i], cc) };
    out.all.push(row);
    if (row.record.status !== 'Archived') out.active.push(row);
  }
  return out;
}

/** "Pat Example", "Amy Quinn and Ted Quinn", "A, B and C". */
function joinNames_(names) {
  names = names.filter(Boolean);
  if (names.length < 2) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function fullName_(r) { return (r.first + ' ' + r.last).trim(); }

function directoryChoice_() { return CHOICES.filter(function (c) { return c.key === 'directory'; })[0]; }

// ---------------------------------------------------------------- the directory in Friendly Contacts

/**
 * Where someone stands, as the download page needs it:
 *   'in'        listed: may download (names: the names on their Active roster rows)
 *   'pending'   their request is waiting for review
 *   'declined'  their request was declined
 *   'out'       anything else (not listed, not on news, no Active roster row, not on the roster at all)
 */
function directoryStanding_(email) {
  var g = dirGroups_();
  var rows = rosterRowsFor_(email);
  if (inGroup_(g.dir, email, DIRECTORY_ROLES)) {
    if (!rows.active.length || !inGroup_(g.news, email)) return { status: 'out', rows: rows };
    return { status: 'in', rows: rows,
             names: joinNames_(rows.active.map(function (r) { return fullName_(r.record); })) };
  }
  if (inGroup_(g.pending, email)) return { status: 'pending', rows: rows };
  if (rows.all.some(function (r) { return r.declined; })) return { status: 'declined', rows: rows };
  return { status: 'out', rows: rows };
}

/** A download session: Friendly Contacts' sign-in token, but never an admin preview token. */
function downloadToken_(req) {
  var tok = verifyToken_(req.token);
  if (tok.preview) throw userError_('A preview can\'t download the directory.');
  if (!directoryOpenFor_(tok.email)) throw userError_('The directory isn\u2019t open yet.');
  return tok;
}


/** After sign-in: may this person download? Also the terms to show. */
function dlStatus_(req) {
  var tok = downloadToken_(req);
  var st = directoryStanding_(tok.email);
  var ch = directoryChoice_();
  return { email: tok.email, status: st.status, names: st.names || '',
           termsTitle: ch.termsTitle, terms: ch.terms, update: friendlyContactsUrl_() };
}

/**
 * Open the directory on screen: agree to the terms, get the listing as compact rows
 * [last, first, email, phone, address line 1, address line 2] (only what each person agreed to show).
 */
function dirOpen_(req) {
  var tok = downloadToken_(req);
  if (req.agree !== true) throw userError_('Please check the box to agree to the directory terms of use.');
  var st = directoryStanding_(tok.email);
  if (st.status !== 'in') throw userError_('Only people listed in the directory can see it.');
  var entries = directoryEntries_();
  var ch = directoryChoice_();
  audit_('Directory opened', st.rows.active.map(function (r) { return r.record.id; }).join(', '), tok.email,
    tok.email + ' (self)', 'Agreed to the ' + ch.termsTitle + '; ' + entries.length + ' entries');
  return {
    names: st.names,
    stamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy, h:mm a'),
    rows: entries.map(function (e) { return [e.last, e.first, e.email, e.phone, e.line1, e.line2]; })
  };
}

/** Download: agree to the terms, get the PDF (base64). The session stays open, so it can be downloaded again. */
function dlGet_(req) {
  var tok = downloadToken_(req);
  if (req.agree !== true) throw userError_('Please check the box to agree to the directory terms of use.');
  var st = directoryStanding_(tok.email);
  if (st.status !== 'in') throw userError_('Only people listed in the directory can download it.');
  var entries = directoryEntries_();
  var now = new Date();
  var blob = directoryPdf_(entries, st.names, tok.email, now);
  var ch = directoryChoice_();
  audit_('Directory download', st.rows.active.map(function (r) { return r.record.id; }).join(', '), tok.email,
    tok.email + ' (self)', 'Agreed to the ' + ch.termsTitle + '; PDF with ' + entries.length + ' entries');
  return { filename: blob.getName(), pdf: Utilities.base64Encode(blob.getBytes()), count: entries.length };
}

/** Close Friendly Contacts (and the old download page's Sign out): ends the session quietly (no email, unlike Cancel). */
function dlSignOut_(req) {
  try { spendToken_(verifyToken_(req.token)); } catch (e) { /* already ended */ }
  return {};
}

// ---------------------------------------------------------------- the directory itself

/** Everyone listed, sorted by last then first name, with only what each person agreed to show. */
function directoryEntries_() {
  var g = dirGroups_();
  var dir = peopleIn_(g.dir, DIRECTORY_ROLES);
  var news = peopleIn_(g.news);
  var sh = rosterSheet_();
  var cc = ensureConsentColumns_(sh);
  var data = sh.getDataRange().getValues();
  var cols = columns_(data[0]);
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var email = String(data[i][cols.email]).trim().toLowerCase();
    if (!email || !dir[emailKey_(email)] || !news[emailKey_(email)]) continue;
    var r = rowToRecord_(data[i], cols);
    if (r.status === 'Archived' || !(r.first || r.last)) continue;
    var consent = readConsent_(data[i], cc);
    var e = { first: r.first, last: r.last, email: email, phone: '', line1: '', line2: '' };
    if (consent.phone && r.phone) e.phone = r.phone;
    if (consent.address && (r.address1 || r.city)) {
      e.line1 = [r.address1, r.address2].filter(Boolean).join(', ');
      e.line2 = [r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    }
    out.push(e);
  }
  out.sort(function (a, b) {
    return a.last.localeCompare(b.last, 'en', { sensitivity: 'base' }) ||
           a.first.localeCompare(b.first, 'en', { sensitivity: 'base' });
  });
  return out;
}

/**
 * The PDF, in the layout of the earlier directories: Letter pages of 3 columns x 10 boxed entries, read
 * down each column. Header: title, date and time made, link to Friendly Contacts. Footer: the note about
 * recorded members, the terms of use, "Prepared for", page numbers. Email, phone and the Friendly
 * Contacts address are links (mailto:, tel:, https:).
 */
function directoryPdf_(entries, names, email, when) {
  var tz = Session.getScriptTimeZone();
  var stamp = Utilities.formatDate(when, tz, "MMMM d, yyyy, h:mm a");
  var fc = friendlyContactsUrl_();
  var ch = directoryChoice_();
  var per = PDF_ROWS * PDF_COLUMNS;
  var pages = Math.max(1, Math.ceil(entries.length / per));
  var esc = escapeHtml_;

  function cell(e) {
    if (!e) return '<td class="empty">&nbsp;</td>';
    var digits = String(e.phone).replace(/\D/g, '');
    var phone = !e.phone ? '&nbsp;'
      : digits.length === 10 ? '<a class="ph" href="tel:+1' + digits + '">' + esc(e.phone) + '</a>'
      : esc(e.phone);
    return '<td>' +
      '<div class="nm">' + esc(e.last) + (e.last && e.first ? ', ' : '') + esc(e.first) + '</div>' +
      '<div class="em"><a class="em" href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a></div>' +
      '<div class="ln">' + (e.line1 ? esc(e.line1) : '&nbsp;') + '</div>' +
      '<div class="ln">' + (e.line2 ? esc(e.line2) : '&nbsp;') + '</div>' +
      '<div class="ln ph">' + phone + '</div>' +
      '</td>';
  }

  var body = '';
  for (var p = 0; p < pages; p++) {
    var rows = '';
    for (var r = 0; r < PDF_ROWS; r++) {
      rows += '<tr>';
      for (var c = 0; c < PDF_COLUMNS; c++) rows += cell(entries[p * per + c * PDF_ROWS + r]);
      rows += '</tr>';
    }
    body +=
      '<div class="page"' + (p ? ' style="page-break-before:always"' : '') + '>' +
      '<div class="title">Midlothian Friends Meeting Directory<br>' + esc(stamp) + '</div>' +
      '<div class="note">Note: Each household member is listed separately. To update your own listing, use ' +
        'Friendly Contacts at <a href="' + esc(fc) + '">' + esc(fc) + '</a>.</div>' +
      '<table class="grid">' + rows + '</table>' +
      '<div class="foot">Note: Midlothian Friends Meeting makes no distinction between <b><i>recorded</i></b> ' +
        'members and <b><i>non-recorded</i></b> members. Therefore, <b><i>recorded</i></b> members are not ' +
        'annotated on this list. You have agreed to the following terms of use: ' + esc(ch.terms) + '</div>' +
      '<table class="by"><tr><td>Prepared for ' + esc(names) + ' (' + esc(email) + ')</td>' +
        '<td class="pn">Page ' + (p + 1) + ' of ' + pages + '</td></tr></table>' +
      '</div>';
  }

  var css =
    'body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;}' +
    '.title{text-align:center;font-weight:bold;font-size:13.5pt;line-height:1.2;}' +
    '.note{font-size:8pt;margin:8pt 0 6pt;}' +
    '.note a{color:#0000cc;}' +
    'table.grid{width:100%;border-collapse:collapse;table-layout:fixed;}' +
    'table.grid td{border:1px solid #000;padding:2pt 5pt 2pt;height:52pt;vertical-align:top;width:33.3%;}' +
    'table.grid td.empty{border:none;}' +
    '.nm{font-size:10.5pt;line-height:1.15;}' +
    '.em{font-family:"Times New Roman",Times,serif;font-size:9pt;color:#0000cc;text-decoration:none;line-height:1.15;}' +
    '.ln{font-size:8.5pt;line-height:1.15;}' +
    '.ph{color:#d00000;text-decoration:none;}' +
    '.foot{font-size:8pt;line-height:1.3;margin-top:6pt;}' +
    'table.by{width:100%;border-collapse:collapse;font-size:8pt;margin-top:4pt;}' +
    'table.by td{padding:0;}' +
    'table.by td.pn{text-align:right;}';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    body + '</body></html>';
  var name = 'MFM-Directory-' + Utilities.formatDate(when, tz, 'yyyy-MM-dd-HHmm') + '.pdf';
  return Utilities.newBlob(html, 'text/html', 'directory.html').getAs('application/pdf').setName(name);
}

/** Run from the editor: emails you (NOTIFY_EMAIL) the PDF a download would make right now. Logs nothing. */
function testDirectoryPdf() {
  var entries = directoryEntries_();
  var me = Session.getEffectiveUser().getEmail();
  var blob = directoryPdf_(entries, 'Test copy', me, new Date());
  GmailApp.sendEmail(notifyEmail_(), 'Directory PDF test (' + entries.length + ' entries)',
    'The directory as a download would make it now. Prepared for: "Test copy".', { attachments: [blob] });
  Logger.log('Sent %s with %s entries to %s.', blob.getName(), entries.length, notifyEmail_());
}

// ---------------------------------------------------------------- review page

/** Roster editors sign in with their Roster Editor password (the PINs tab; same lockout). */
function reviewSignIn_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  checkPassword_(email, req.password);
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, email, SESSION_SECONDS);
  audit_('Sign-in', '', email, email, 'Directory review');
  return { token: token, email: email };
}

function reviewSignOut_(req) {
  if (req.token) CacheService.getScriptCache().remove('sess_' + String(req.token));
  return {};
}

/** The signed-in reviewer's email, or a session problem (the page goes back to sign-in). */
function reviewer_(token) {
  try {
    return requireSession_(token);
  } catch (e) {
    var err = userError_('Please sign in again.');
    err.sessionProblem = 'review';
    throw err;
  }
}

/** The pending requests, oldest first, each showing only what the person agreed to list. */
function reviewList_(req) {
  var who = reviewer_(req.token);
  var g = dirGroups_();
  var pendingByKey = peopleIn_(g.pending);
  var pending = Object.keys(pendingByKey).map(function (k) { return pendingByKey[k].email; });
  var news = peopleIn_(g.news);
  var sh = rosterSheet_();
  var cc = ensureConsentColumns_(sh);
  var data = sh.getDataRange().getValues();
  var cols = columns_(data[0]);
  var byEmail = {};
  for (var i = 1; i < data.length; i++) {
    var em = String(data[i][cols.email]).trim().toLowerCase();
    if (!em) continue;
    var r = rowToRecord_(data[i], cols);
    var had = byEmail[emailKey_(em)];
    if (had && had.record.status !== 'Archived') continue;   // keep the first Active row
    byEmail[emailKey_(em)] = { record: r, consent: readConsent_(data[i], cc), terms: termsDate_(data[i], cc),
                               approved: dateCell_(data[i][cc.approved]), left: dateCell_(data[i][cc.left]) };
  }
  var tz = Session.getScriptTimeZone();
  var items = pending.map(function (email) {
    var row = byEmail[emailKey_(email)];
    var r = row ? row.record : null;
    var item = { email: email, name: r ? fullName_(r) : '', onNews: !!news[emailKey_(email)],
                 onRoster: !!(r && r.status !== 'Archived'), asked: '', askedAt: 0,
                 showPhone: false, showAddress: false, phone: '', address: '', previous: '' };
    if (row) {
      item.showPhone = row.consent.phone;
      item.showAddress = row.consent.address;
      if (row.consent.phone) item.phone = r.phone;
      if (row.consent.address) {
        item.address = [[r.address1, r.address2].filter(Boolean).join(', '),
          [r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join('\n');
      }
      if (row.terms) { item.asked = Utilities.formatDate(row.terms, tz, 'MMM d, yyyy'); item.askedAt = row.terms.getTime(); }
      // Asking again after leaving: always reviewed (w25); the card says so.
      if (row.approved && row.left) {
        item.previous = 'Previously listed, approved ' + Utilities.formatDate(row.approved, tz, 'MMM d, yyyy') +
          ', left ' + Utilities.formatDate(row.left, tz, 'MMM d, yyyy');
      }
    }
    return item;
  });
  items.sort(function (a, b) { return (a.askedAt || Infinity) - (b.askedAt || Infinity) || a.email.localeCompare(b.email); });
  return { reviewer: who, items: items };
}

/** Accept or Decline one request. */
function reviewDecide_(req) {
  var who = reviewer_(req.token);
  var email = cleanEmail_(req.email);
  var accept = req.decision === 'accept';
  if (!accept && req.decision !== 'decline') throw userError_('Unknown decision.');
  var g = dirGroups_();
  if (!groupMember_(g.pending, email)) {
    throw userError_('This request is no longer waiting for review. Someone may have decided it already.');
  }
  var rows = rosterRowsFor_(email);
  var ids = rows.all.map(function (r) { return r.record.id; }).join(', ');
  var first = rows.active.length ? rows.active[0].record.first : '';
  var name = rows.active.length ? fullName_(rows.active[0].record) : email;
  var problem = '';

  if (accept) {
    if (!rows.active.length) throw userError_(name + ' has no active roster record, so they can\'t be listed.');
    if (!inGroup_(g.news, email)) {
      throw userError_(name + ' no longer receives the news, so they can\'t be listed. The nightly check will remove the request.');
    }
    addMember_(g.dir, email);
    removeMember_(g.pending, email);
    setDirectoryDates_(email, { approved: true });
    audit_('Directory accepted', ids, email, who, 'Moved from ' + g.pending + ' to ' + g.dir + '; ' + APPROVED_COL + ' set');
    try { sendAcceptedEmail_(email, first); }
    catch (e) { problem = 'Accepted, but the welcome email couldn\'t be sent.'; reportError_(e, 'directory welcome email'); }
  } else {
    removeMember_(g.pending, email);
    setDirectoryDates_(email, { declined: true });
    audit_('Directory declined', ids, email, who, 'Removed from ' + g.pending + '; ' + DECLINED_COL + ' set' +
      (req.notify ? '; emailed' : '; not emailed'));
    if (req.notify) {
      try { sendDeclinedEmail_(email, first); }
      catch (e) { problem = 'Declined, but the email couldn\'t be sent.'; reportError_(e, 'directory declined email'); }
    }
  }
  return { decision: accept ? 'accept' : 'decline', name: name, emailed: accept || !!req.notify, problem: problem };
}

/**
 * On every row for that email. Accept: Approval Date = today, Declined and Left Dates cleared.
 * Decline: Declined Date = today. Left (w25): Left Date = today.
 */
function setDirectoryDates_(email, what) {
  withLock_(function () {
    var sh = rosterSheet_();
    var cc = ensureConsentColumns_(sh);
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var today = new Date();
    for (var i = 1; i < data.length; i++) {
      if (emailKey_(data[i][cols.email]) !== emailKey_(email)) continue;
      if (what.approved) {
        sh.getRange(i + 1, cc.approved + 1).setValue(today);
        sh.getRange(i + 1, cc.declined + 1).clearContent();
        sh.getRange(i + 1, cc.left + 1).clearContent();
      }
      if (what.declined) sh.getRange(i + 1, cc.declined + 1).setValue(today);
      if (what.left) sh.getRange(i + 1, cc.left + 1).setValue(today);
    }
  });
}

// ---------------------------------------------------------------- emails

function sendAcceptedEmail_(email, first) {
  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var greeting = first ? 'Dear ' + first + ',' : 'Dear Friend,';
  var dl = directoryLinkUrl_(), fc = friendlyContactsUrl_();
  var btn = dl ? '<div style="max-width:300px;margin:4px auto 22px;"><a href="' + escapeHtml_(dl) + '" style="display:block;' +
    'background:#1e7b34;color:#ffffff;text-decoration:none;font-size:18px;font-weight:700;text-align:center;padding:15px 10px;' +
    'border-radius:14px;">Open the directory</a></div>' : '';
  var paras = [
    'Your request to be listed in the Midlothian Friends Meeting directory has been accepted. You are now listed, and you can open the directory at any time.',
    'To change what the directory shows about you, or to leave it, use Friendly Contacts at ' +
      '<a href="' + escapeHtml_(fc) + '">' + escapeHtml_(fc) + '</a>.'
  ];
  var html = emailShell_(
    '<div style="font-size:24px;font-weight:700;text-align:center;margin:0 0 18px;">You’re in the directory</div>' +
    '<p style="' + p + '">' + escapeHtml_(greeting) + '</p>' +
    '<p style="' + p + '">' + paras[0] + '</p>' + btn +
    '<p style="' + p + '">' + paras[1] + '</p>' +
    '<p style="' + p + '">Questions? Just reply to this email.</p>' +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  var text = 'You’re in the directory\n\n' + greeting + '\n\n' + paras[0] + (dl ? '\n\nOpen the directory: ' + dl : '') +
    '\n\nTo change what the directory shows about you, or to leave it, use Friendly Contacts at ' + fc + '.' +
    '\n\nQuestions? Just reply to this email.\n\nIn Friendship,\nMidlothian Friends Meeting\n';
  sendMail_(email, 'You’re listed in the Midlothian Friends Meeting directory', text, html);
}

function sendDeclinedEmail_(email, first) {
  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var greeting = first ? 'Dear ' + first + ',' : 'Dear Friend,';
  var msg = 'Thank you for your interest in the Midlothian Friends Meeting directory. Your request to be listed was declined.';
  var html = emailShell_(
    '<div style="font-size:24px;font-weight:700;text-align:center;margin:0 0 18px;">Your directory request</div>' +
    '<p style="' + p + '">' + escapeHtml_(greeting) + '</p><p style="' + p + '">' + msg + '</p>' +
    '<p style="' + p + '">Questions? Just reply to this email.</p>' +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  var text = 'Your directory request\n\n' + greeting + '\n\n' + msg +
    '\n\nQuestions? Just reply to this email.\n\nIn Friendship,\nMidlothian Friends Meeting\n';
  sendMail_(email, 'Your directory request, Midlothian Friends Meeting', text, html);
}
