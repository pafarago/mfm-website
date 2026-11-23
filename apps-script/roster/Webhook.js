/**
 * MFM member self-service (the "webhook"): back end
 *
 * Lives in the same Apps Script project as the Roster Editor and uses the same roster, rules
 * (unique email, phone, ZIP, address tidy-up) and audit log. The page people see (member.html)
 * is hosted on the MFM website and talks to this code with fetch() POSTs to the same /exec URL
 * the editor uses. The editor answers GET (doGet); this answers POST (doPost).
 *
 * Flow:  email -> sign-in email -> 30-minute session ->
 *        Your information -> News -> Directory (only if News is Yes) -> Review -> Save.
 * Two ways to sign in (SIGNIN_METHOD below):
 *  - Code: a 6-digit code, typed on the page and checked with Verify. Works for 15 minutes and
 *    5 tries; only the latest code works; used up by Verify, voided by Cancel.
 *  - Link: a link to the member page with a one-time key after "#"; the page signs in as it opens and
 *    goes straight to step 1. Works once, for 15 minutes; only the latest link works; voided by Cancel.
 *    Works on any device. If the link was already used (some email scanners open links first), the page
 *    offers a code instead, even when SIGNIN_METHOD is link.
 *  - The session ends when Cancel or Close Friendly Contacts is tapped, or 30 minutes pass. Saving no
 *    longer ends it (w25), so a member with directory access can go Home after saving.
 *
 * Unified app (w25): members with directory access (Directory.gs) get a home screen with My information and
 * Directory (the terms of use are agreed each time it opens); everyone else goes straight to My information.
 * The sign-in emails mention the directory only to members with directory access.
 *
 * Directory: only for people who receive the news. "Include me" (a checkbox) means accepting the terms of
 * use. Every request goes to DIRECTORY_PENDING_GROUP for review (w25: including people approved before who
 * later left); approved people are moved into DIRECTORY_GROUP. Someone with a "Directory Declined Date" is
 * told "Your request was declined." and isn't re-queued. Unchecking, or a No to news, removes the person
 * from both groups at once, and leaving the directory sets "Directory Left Date".
 * Kept in the roster (the Roster Editor neither shows nor changes them): "Show phone", "Show address"
 * (what the directory shows), "Directory terms" (date the member accepted the terms), "Directory Approval
 * Date", "Directory Declined Date" and "Directory Left Date" (w25).
 *
 * Carrying the April 2025 directory forward (only after the Meeting agrees):
 *   activateDirectory()             everyone in DIRECTORY_GROUP gets today's Directory Approval Date, Show
 *                                   phone Yes and, for the April 2025 addresses, Show address Yes (blank
 *                                   cells only). They then see "You're already in our directory" until they save.
 *   activateDirectoryFor()          the same for the addresses in the DIRECTORY_TESTERS property only
 *   deactivateDirectory() / deactivateDirectoryFor()   undo, for people who haven't saved since
 *
 * Admin preview: /update/?preview asks for the password in PREVIEW_ADMIN's row of the PINs tab, then shows
 * any member's pages exactly as they would see them. Nothing is saved and no email is sent.
 *
 * Directory review page and the directory itself (w16, w17): see Directory.gs. Since w25 the directory is part
 * of Friendly Contacts and has no sign-in of its own (DIRECTORY_PAGE_URL is no longer used).
 *
 * Nightly check: scrubDirectory() removes from both directory groups anyone not in NEWS_GROUP
 * (e.g. people who unsubscribed with Google's link). Silent; each removal is in the audit log.
 * It also removes archived roster records from all three groups (news, directory, pending), and fills in
 * "Directory Left Date" for approved people no longer in DIRECTORY_GROUP (w25). Restoring a record in the Roster
 * Editor doesn't restore group memberships: the person rejoins through Friendly Contacts.
 * Turn it on once by running installNightlyScrub() in the editor.
 *
 * Script properties (Project Settings -> Script properties):
 *   FROM_EMAIL                 sender address, e.g. records@midlothianfriends.org (a Gmail "Send mail
 *                              as" address of the script owner); otherwise mail comes from the owner
 *   NOTIFY_EMAIL               gets notices: new and restored records, failed group changes, errors
 *   NEWS_GROUP                 newsletter group; the News question appears once this is set
 *   DIRECTORY_GROUP            the directory group           } the Directory question appears only
 *   DIRECTORY_PENDING_GROUP    requests awaiting approval    } when BOTH are set
 *   SIGNIN_METHOD              code | link | choose (default). "choose" is for testing: the page decides,
 *                              link at /update/ and code at /update/?code. After testing set code or link.
 *   LINK_PAGE_URL              the member page address put in link emails, e.g.
 *                              https://midlothianfriends.org/update/  (no link emails without it)
 *   PREVIEW_ADMIN              optional: who may use the preview, default admin@midlothianfriends.org
 *   LOGO_URL                   optional: the logo shown in the emails, default
 *                              https://midlothianfriends.freeddns.org/logo.png (embedded in each email)
 *   DIRECTORY_ON, DIRECTORY_TESTERS, WEBSITE_HOME_URL   see Directory.gs (w25)
 *   CODES_PER_EMAIL_PER_HOUR   optional, default 10 (codes and links together)
 *   CODES_PER_HOUR_TOTAL       optional, default 100
 *   TOKEN_SECRET               created automatically on first use
 *
 * Services (Editor -> Services -> +):
 *   Admin SDK API (identifier AdminDirectory)  required, for the groups
 *   Gmail API (identifier Gmail)               optional; lets the sender name come from Gmail's
 *                                              "Send mail as" setting instead of FROM_NAME below
 */

var WEBHOOK_VERSION = '2026-11-23w26';
var FROM_NAME = 'Midlothian Friends Meeting';   // used only if Gmail's "Send mail as" name can't be read
var CODE_MINUTES = 30;
var CODE_TRIES = 5;
var SESSION_MINUTES = 30;
var CONSENT_COLS = { phone: 'Show phone', address: 'Show address' };
var CONSENT_DEFAULTS = { phone: true, address: false };
var TERMS_COL = 'Directory terms';   // date the member agreed to the directory terms of use
var APPROVED_COL = 'Directory Approval Date';   // when the request was accepted
var DECLINED_COL = 'Directory Declined Date';   // declined: "Your request was declined.", not re-queued
var LEFT_COL = 'Directory Left Date';           // left the directory (w25): shown on the review card if they ask again
var PREVIEW_ADMIN_DEFAULT = 'admin@midlothianfriends.org';

/** The Yes/No choices on step 2. Each appears only when its group properties are set. */
var CHOICES = [
  { key: 'news', props: ['NEWS_GROUP'],
    question: 'Would you like to receive news from Midlothian Friends Meeting?',
    yes: 'Yes, send me news', no: 'No, thank you',
    nowIn: 'You are currently receiving news.', nowOut: 'You are not currently receiving news.',
    doneIn: 'You will receive news from Midlothian Friends Meeting. You can stop at any time with the unsubscribe link at the bottom of any newsletter.',
    doneOut: 'You will not receive news from Midlothian Friends Meeting.',
    reviewIn: 'Receive news: Yes', reviewOut: 'Receive news: No' },
  { key: 'directory', props: ['DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP'], pending: true, requires: 'news',
    title: 'The member directory',
    preamble: [
      'Midlothian Friends Meeting publishes a contact directory to help us stay in touch with one another. ' +
        'Only people listed in the directory can download it, and no one else. If you\u2019re listed, we\u2019ll ' +
        'occasionally email you about the directory, for example, when a new edition is ready.'
    ],
    reviewPara: 'Requests to be listed in the directory are reviewed. For example, requests from the email addresses ' +
      'of businesses, government agencies, polling firms, and political organizations are declined.',   // shown only for a new request
    reviewTime: 'Requests are normally processed weekly.',   // under "Include me" (w25)
    carried: 'You were listed in the Midlothian Friends Meeting directory of April 2025, so we\u2019ve kept your listing. ' +
      'Please review the following elections. Any changes that you make will be reflected in future directories.',
    declined: 'Your request was declined.',
    termsTitle: 'Directory terms of use effective January 1, 2027',
    terms: 'I will use the directory only to keep in touch with Friends personally. I will not use it to send ' +
      'bulk email or to add anyone to a mailing list, and I will not sell, publish, or share it, or any part of it, ' +
      'with anyone else.',
    question: 'Include me in the directory.',
    note: 'Members who use the directory will see:',
    showsEntry: true,
    yes: 'Yes, list me', no: 'No, thank you',
    nowIn: 'You are currently listed in the directory.',
    nowPending: 'Your request to be listed is waiting for review.',
    nowOut: 'You are not currently listed in the directory.',
    doneIn: 'You remain listed in the directory.',
    doneListed: 'You are listed in the directory.',
    donePending: 'Your request to be listed in the directory is pending. Requests are normally processed weekly.',
    doneOut: 'You will not be listed in the directory.',
    reviewIn: 'Include in directory: Yes', reviewOut: 'Include in directory: No' }
];

// ---------------------------------------------------------------- entry point

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'config':   out = signinConfig_(req); break;
      case 'sendCode': out = memberSendCode_(req); break;
      case 'linkStatus': out = memberLinkStatus_(req); break;
      case 'verify':   out = memberVerify_(req); break;
      case 'cancel':   out = memberCancel_(req); break;
      case 'load':     out = memberLoad_(req); break;
      case 'tidy':     out = memberTidy_(req); break;
      case 'preview':  out = memberPreview_(req); break;
      case 'save':     out = memberSave_(req); break;
      case 'adminPreview': out = adminPreview_(req); break;
      case 'dlStatus':     out = dlStatus_(req); break;       // Directory.gs: the download page
      case 'dirOpen':      out = dirOpen_(req); break;
      case 'dlGet':        out = dlGet_(req); break;
      case 'dlSignOut':    out = dlSignOut_(req); break;
      case 'signOut':      out = dlSignOut_(req); break;      // Close Friendly Contacts (w25)
      case 'reviewSignIn': out = reviewSignIn_(req); break;   // Directory.gs: the review page
      case 'reviewSignOut': out = reviewSignOut_(req); break;
      case 'reviewList':   out = reviewList_(req); break;
      case 'reviewDecide': out = reviewDecide_(req); break;
      default: throw userError_('Unknown request.');
    }
    out.ok = true;
  } catch (err) {
    if (/roster is busy/i.test(err.message)) err.user = true;
    if (err.user) {
      out = { ok: false, error: err.message, sessionProblem: err.sessionProblem || '', codeProblem: err.codeProblem || '' };
      if (err.email) out.email = err.email;   // only for 'scanner': fills in the address the link was sent to
    } else {
      // Unexpected: a friendly message for the member, the details for the committee.
      reportError_(err, req && req.action);
      out = { ok: false, error: 'Something went wrong on our side. The Records Committee has been notified. Please try again later.' };
    }
  }
  out.version = WEBHOOK_VERSION;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(msg) {
  var err = new Error(msg);
  err.user = true;
  return err;
}

/** Emails the details of an unexpected error, at most once every 30 minutes for the same error. */
function reportError_(err, action) {
  try {
    var msg = String(err && err.message || err);
    var key = 'errnote_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, msg)).slice(0, 20);
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, '1', 1800);
    notify_('[MFM Roster] Member page error', 'The member page hit an unexpected error' +
      (action ? ' during "' + action + '"' : '') + ':\n\n' + msg + '\n\n' + (err && err.stack ? err.stack : '') +
      '\n\nMembers saw: "Something went wrong on our side." (Repeats of this error are not emailed for 30 minutes.)');
  } catch (e) { console.error(e); }
}

// ---------------------------------------------------------------- security codes

/** Emails a one-time security code. The reply is the same whether or not the address is on the roster. */
function memberSendCode_(req) {
  var email = cleanEmail_(req.email);
  var ref = String(req.ref || '').slice(0, 64);   // the page's private reference, needed to cancel
  var props = PropertiesService.getScriptProperties();
  var perEmail = Number(props.getProperty('CODES_PER_EMAIL_PER_HOUR')) || 10;
  var total = Number(props.getProperty('CODES_PER_HOUR_TOTAL')) || 100;

  withLock_(function () {
    if (!countInWindow_('req_all', total)) {
      throw userError_('We\'re receiving a lot of requests right now. Please try again in an hour.');
    }
    if (!countInWindow_('req_' + emailKey_(email), perEmail)) {
      throw userError_('There have been too many sign-in requests for this address in the last hour. ' +
        'Please use your most recent sign-in email, or try again in an hour.');
    }
  });

  var method = req.fallback === true ? 'code' : signinMethod_(req.method);   // a link failed: code instead
  // Never email a group address: the message would go to the whole list, and whoever opened it first
  // would be signed in as the group. Same reply as always, so the page reveals nothing.
  if (isGroupAddress_(email)) {
    audit_('Sign-in refused', '', email, 'member page', 'Group address: no email sent');
    return { method: method };
  }
  var cache = CacheService.getScriptCache();
  var found = findByEmail_(email);
  // w25: the email mentions the directory only to members who can open it (never blocks a sign-in).
  var dir = false;
  if (found) { try { dir = directoryAccess_(email); } catch (e) { dir = false; } }
  var at = Date.now();   // shown in the email ("Sent ...") and carried in the link
  if (method === 'link') {
    var key = linkKeyFor_(email, at);
    // As with codes: only a scrambled form is kept, and only the latest one for each address works.
    cache.put('code_' + email, JSON.stringify({ h: sign_(email + '|link|' + key), link: true, tries: 0, ref: ref, at: at }), CODE_MINUTES * 60);
    cache.put('lnk_' + keyId_(key), email, CODE_MINUTES * 60);
    sendLinkEmail_(email, linkPageUrl_() + '#k=' + key, found ? found.record.first : '', !!found, dir, at);
    return { method: 'link' };
  }
  var code = newCode_();
  // Only a scrambled form of the code is kept, and only the latest code for each address.
  cache.put('code_' + email, JSON.stringify({ h: sign_(email + '|' + code), tries: 0, ref: ref, at: at }), CODE_MINUTES * 60);
  sendCodeEmail_(email, code, found ? found.record.first : '', !!found, dir, at);
  return { method: 'code' };
}

/**
 * True for the three group addresses and for any address on the groups' own domain that is a Google
 * Group (or a group's alias). Other addresses are never looked up.
 */
function isGroupAddress_(email) {
  var props = PropertiesService.getScriptProperties();
  var groups = ['NEWS_GROUP', 'DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP']
    .map(function (k) { return (props.getProperty(k) || '').trim().toLowerCase(); }).filter(Boolean);
  if (groups.indexOf(email) !== -1) return true;
  var domains = groups.map(function (g) { return g.split('@')[1]; });
  if (domains.indexOf(email.split('@')[1]) === -1) return false;
  try {
    AdminDirectory.Groups.get(email);
    return true;
  } catch (err) {
    return false;   // not a group (a user such as admin@ or clerk@); never block a sign-in over a failed lookup
  }
}

/**
 * Which way to sign in. SIGNIN_METHOD = code or link decides; otherwise ("choose", for testing) the
 * page's wish does. Link needs LINK_PAGE_URL; without it, code.
 */
function signinMethod_(wish) {
  var set = (PropertiesService.getScriptProperties().getProperty('SIGNIN_METHOD') || 'choose').trim().toLowerCase();
  var m = set === 'code' || set === 'link' ? set : (wish === 'code' ? 'code' : 'link');
  return m === 'link' && !linkPageUrl_() ? 'code' : m;
}

/** For the page as it opens: the sign-in method, and whether it's fixed (no longer chosen by the page). */
function signinConfig_(req) {
  var set = (PropertiesService.getScriptProperties().getProperty('SIGNIN_METHOD') || 'choose').trim().toLowerCase();
  var from = (PropertiesService.getScriptProperties().getProperty('FROM_EMAIL') || '').trim().toLowerCase();
  return { method: signinMethod_(req.method), fixed: set === 'code' || set === 'link', from: from, home: websiteHomeUrl_() };
}

/** LINK_PAGE_URL, only if it's an https address; '' otherwise. Never taken from the page, so emails can't be made to point elsewhere. */
function linkPageUrl_() {
  var u = (PropertiesService.getScriptProperties().getProperty('LINK_PAGE_URL') || '').trim().replace(/#.*$/, '');
  return /^https:\/\/[^\s"<>]+$/.test(u) ? u : '';
}

/**
 * A sign-in link's key (w23): 32 random characters, then a 16-character seal, then the address and the time
 * it was sent, scrambled with the script's secret. So an old link can always say whose it was and when it was
 * sent, however old it is, while nobody can read or change what it carries. Links from before w23 are just
 * the 32 random characters; they still work, but only the cache knows whose they were.
 */
function linkKeyFor_(email, at) {
  var rand = newLinkKey_();
  var plain = at.toString(36) + '|' + email;
  return rand + sign_('lnkinfo|' + rand + '|' + plain).slice(0, 16) + scramble_(plain, rand);
}

/** {email, at} from a w23 key, or null (an older key, or one that has been tampered with). */
function readLinkKey_(key) {
  if (key.length <= 48) return null;
  var rand = key.slice(0, 32), seal = key.slice(32, 48), plain;
  try { plain = unscramble_(key.slice(48), rand); } catch (e) { return null; }
  if (sign_('lnkinfo|' + rand + '|' + plain).slice(0, 16) !== seal) return null;
  var bar = plain.indexOf('|');
  var at = parseInt(plain.slice(0, bar), 36);
  return bar > 0 && at > 0 ? { at: at, email: plain.slice(bar + 1) } : null;
}

/** Text XORed with a keystream made from the script's secret and the key's random part (websafe base64). */
function scramble_(text, rand) {
  var bytes = Utilities.newBlob(text).getBytes();
  return Utilities.base64EncodeWebSafe(xorStream_(bytes, rand)).replace(/=+$/, '');
}
function unscramble_(b64, rand) {
  while (b64.length % 4) b64 += '=';
  return Utilities.newBlob(xorStream_(Utilities.base64DecodeWebSafe(b64), rand)).getDataAsString();
}
function xorStream_(bytes, rand) {
  var out = [], block = [];
  for (var i = 0; i < bytes.length; i++) {
    if (i % 32 === 0) block = Utilities.computeHmacSha256Signature('ks|' + rand + '|' + (i / 32), tokenSecret_());
    out.push(bytes[i] ^ block[i % 32]);
  }
  return out;
}

/** "Tuesday, November 17 at 2:06 PM" (with the year when it isn't this year). */
function whenSent_(ms) {
  var tz = Session.getScriptTimeZone(), d = new Date(ms);
  var sameYear = Utilities.formatDate(d, tz, 'yyyy') === Utilities.formatDate(new Date(), tz, 'yyyy');
  return Utilities.formatDate(d, tz, sameYear ? "EEEE, MMMM d 'at' h:mm a" : "EEEE, MMMM d, yyyy 'at' h:mm a");
}

function newLinkKey_() {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  return Utilities.base64EncodeWebSafe(b).replace(/=+$/, '').slice(0, 32);   // about 190 random bits
}

function keyId_(key) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key))).slice(0, 40);
}

/** Counts a request in a fixed one-hour window starting at the first request. False if over the limit. */
function countInWindow_(key, limit) {
  var cache = CacheService.getScriptCache();
  var now = Date.now();
  var w = JSON.parse(cache.get(key) || 'null') || { n: 0, t: now };
  if (w.n >= limit) return false;
  w.n++;
  var left = Math.max(1, Math.ceil((w.t + 3600 * 1000 - now) / 1000));
  cache.put(key, JSON.stringify(w), left);
  return true;
}

/** Checks a code. Right: the code is used up, a 30-minute session starts, and it's logged. */
function memberVerify_(req) {
  if (req.key) return memberVerifyLink_(req);
  var email = cleanEmail_(req.email);
  var code = String(req.code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache();
  var viaDownload = false;
  var token = withLock_(function () {
    var raw = cache.get('code_' + email);
    if (!raw) throw codeError_('none', 'That security code has expired or was cancelled. Please tap "Send a new code."');
    var c = JSON.parse(raw);
    if (c.link) throw codeError_('none', 'We sent you a sign-in link, not a code. Please tap the link in the email, or tap "Send a new code."');
    if (code.length === 6 && sign_(email + '|' + code) === c.h) {
      cache.remove('code_' + email);
      viaDownload = !!c.dl;
      return makeToken_(rosterEmail_(email));
    }
    c.tries++;
    if (c.tries >= CODE_TRIES) {
      cache.remove('code_' + email);
      throw codeError_('used-up', 'That security code isn\'t right, and it has now been cancelled after ' + CODE_TRIES +
        ' tries. Please tap "Send a new code."');
    }
    cache.put('code_' + email, JSON.stringify(c), CODE_MINUTES * 60);
    var left = CODE_TRIES - c.tries;
    throw codeError_('wrong', 'That security code isn\'t right. Please check it and try again (' + left +
      (left === 1 ? ' try' : ' tries') + ' left).');
  });
  var found = findByEmail_(email);
  audit_('Verified', found ? found.record.id : '', email, email + ' (self)', viaDownload ? 'Directory download' : 'Member page');
  return { token: token };
}

/** Checks a sign-in link's key (sent by the page as it opens from the link). Used up when right. */
// How long the server remembers that a link was used: 6 hours, the cache's limit. (A used link is more than
// 30 minutes old after that, so it counts as expired either way.)
var LINK_MEMORY_SECONDS = 21600;
// Two "already used" links for the same address within this many minutes: the mail service is using them up.
var SCANNER_WINDOW_MINUTES = 5;

/**
 * Sign in with a link. A link that no longer works gets one of four answers (codeProblem), each naming when
 * the tapped link was sent, so the person can match it to the "Sent ..." line in the email:
 *   'replaced'  a newer link or code was sent and still works: says when, and until when
 *   'expired'   nothing is waiting: the page offers Start over (a new link)
 *   'used'      already used, most often an old email tapped again: the page offers Start over (a new link)
 *   'scanner'   a second 'used' for the same address within SCANNER_WINDOW_MINUTES: the mail service
 *               must be opening links first, so the page switches to a one-time security code
 */
function memberVerifyLink_(req) {
  var key = String(req.key || '').slice(0, 400);
  var id = keyId_(key);
  var cache = CacheService.getScriptCache();
  var info = readLinkKey_(key);   // w23 links carry their address and sent time
  var tapped = info ? 'The link you tapped was sent ' + whenSent_(info.at) : '';
  var startOver = 'Please delete that email, then tap \u201cStart over\u201d to get a new one.';
  var spentBy = cache.get('lnkspent_' + id);
  if (spentBy) {
    if (cache.get('lnkrepeat_' + spentBy)) {
      cache.remove('lnkrepeat_' + spentBy);
      var err = codeError_('scanner', 'It looks like your email service won\u2019t let sign-in links work for you. ' +
        'We\u2019ll email you a one-time security code instead.');
      err.email = spentBy;
      throw err;
    }
    cache.put('lnkrepeat_' + spentBy, '1', SCANNER_WINDOW_MINUTES * 60);
    throw codeError_('used', tapped ? tapped + ' and has already been used. ' + startOver : startOver);
  }
  var expired = tapped ? tapped + ' and has expired. ' + startOver : startOver;
  var email = info ? info.email : (cache.get('lnk_' + id) || cache.get('lnkown_' + id));
  if (!email) throw codeError_('expired', expired);
  var viaDownload = false;
  var token = withLock_(function () {
    var raw = cache.get('code_' + email);
    var c = raw ? JSON.parse(raw) : null;
    if (!c || !c.link || c.h !== sign_(email + '|link|' + key)) {
      cache.remove('lnk_' + id);
      if (c && c.at) {   // a newer link or code was sent and still works
        var until = Utilities.formatDate(new Date(c.at + CODE_MINUTES * 60 * 1000), Session.getScriptTimeZone(), 'h:mm a');
        var newer = (c.link ? 'newer one' : 'one-time security code') + ' was sent ' + whenSent_(c.at) + ' and works until ' + until;
        throw codeError_('replaced', (tapped ? tapped + '. A ' + newer : 'A ' + newer) +
          (c.link ? '. Please use that one and delete the older emails.'
                  : '. Please enter it where you asked for it, and delete the older emails.') +
          ' If it\u2019s after ' + until + ', tap \u201cStart over\u201d.');
      }
      throw codeError_('expired', expired);
    }
    cache.remove('code_' + email);
    cache.remove('lnk_' + id);
    cache.put('lnkspent_' + id, email, LINK_MEMORY_SECONDS);   // a later tap on this link: 'used'
    // Lets the window that asked for this link learn that it was used (and nothing more).
    if (c.ref) cache.put('lnkused_' + keyId_(email + '|' + c.ref), '1', 3600);
    viaDownload = !!c.dl;
    return makeToken_(rosterEmail_(email));
  });
  var found = findByEmail_(email);
  audit_('Verified', found ? found.record.id : '', email, email + ' (self)', (viaDownload ? 'Directory download' : 'Member page') + ' (link)');
  return { token: token };
}

/**
 * For the window that asked for a link: has that link been used (in any window)? Needs the page's
 * private reference, so only that window can ask. Says only yes or no; gives no access to anything.
 */
function memberLinkStatus_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var ref = String(req.ref || '').slice(0, 64);
  if (!email || !ref) return { used: false };
  return { used: !!CacheService.getScriptCache().get('lnkused_' + keyId_(email + '|' + ref)) };
}

/**
 * Cancel at any point. A link's own page can cancel that link (it holds the key). Before Verify: voids the code, but only if the request carries the private
 * reference given when the code was requested (so nobody can void someone else's code).
 * After Verify: ends the session and logs it.
 */
function memberCancel_(req) {
  if (req.token) {
    var tok;
    try { tok = verifyToken_(req.token); } catch (e) { return {}; }   // already ended: nothing to do
    spendToken_(tok);
    if (tok.preview) return {};   // an admin preview: no email, nothing to log
    var found = findByEmail_(tok.email);
    audit_('Cancelled', found ? found.record.id : '', tok.email, tok.email + ' (self)', 'Cancelled after verifying; nothing saved');
    try { sendCanceledEmail_(tok.email, found ? found.record.first : ''); }
    catch (e) { reportError_(e, 'cancel email'); }
    return {};
  }
  var cache = CacheService.getScriptCache();
  if (req.key) {
    var kid = keyId_(String(req.key).slice(0, 400));
    var le = cache.get('lnk_' + kid);
    if (le) {
      var lc = JSON.parse(cache.get('code_' + le) || 'null');
      if (lc && lc.link && lc.h === sign_(le + '|link|' + String(req.key).slice(0, 400))) cache.remove('code_' + le);
      cache.remove('lnk_' + kid);
    }
    return {};
  }
  var email = String(req.email || '').trim().toLowerCase();
  var ref = String(req.ref || '');
  if (!email || !ref) return {};
  var raw = cache.get('code_' + email);
  if (raw && JSON.parse(raw).ref === ref) cache.remove('code_' + email);
  return {};
}

function newCode_() {
  // 6 digits from a SHA-256 of a fresh random UUID (Apps Script has no crypto random generator).
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var n = 0;
  for (var i = 0; i < 6; i++) n = (n * 256 + (b[i] & 255)) % 1000000007;
  return ('000000' + (n % 1000000)).slice(-6);
}

function cleanEmail_(v) {
  var email = String(v || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw userError_('Please enter a valid email address.');
  }
  return email;
}

function codeError_(why, msg) {
  var err = userError_(msg);
  err.codeProblem = why;
  return err;
}

// ---------------------------------------------------------------- after Verify: the three steps

/** Step 1 data: what's on file, the current choices and the directory consent settings. */
function memberLoad_(req) {
  var tok = verifyToken_(req.token);
  var email = tok.email;
  var found = findByEmail_(email);
  var r = found ? found.record : null;
  return {
    email: email,
    preview: !!tok.preview,
    access: !tok.preview && directoryAccess_(email),   // w25: the home screen and the Directory button
    isNew: !found,
    archived: !!(r && r.status === 'Archived'),
    record: r ? pick_(r, MEMBER_FIELDS_) : null,
    updated: r ? r.updated : '',
    consent: found ? found.consent : { phone: CONSENT_DEFAULTS.phone, address: CONSENT_DEFAULTS.address },
    choices: activeChoices_().map(function (c) {
      var st = choiceStatus_(c, email);
      var out = { key: c.key, question: c.question, note: c.note || '', showsEntry: !!c.showsEntry,
               yes: c.yes, no: c.no, reviewIn: c.reviewIn, reviewOut: c.reviewOut,
               requires: c.requires || '', title: c.title || '', preamble: (c.preamble || []).slice(),
               terms: c.terms || '', termsTitle: c.termsTitle || '', termsDate: c.terms && found ? found.termsDate : '',
               reviewTime: c.reviewTime || '',
               status: st,                                     // 'in' | 'pending' | 'out'
               current: st !== 'out',
               now: st === 'in' ? c.nowIn : st === 'pending' ? c.nowPending : c.nowOut };
      if (c.key === 'directory') {
        var approved = !!(found && found.approved), declined = !!(found && found.declined) && st === 'out';
        out.approved = approved;
        out.declined = declined ? c.declined : '';
        // Carried forward: approved at activation, still listed, and hasn't saved a choice since.
        out.carried = approved && st === 'in' && !(found && found.termsDate) ? c.carried : '';
        // "New requests are reviewed": only for someone who would actually be a new request.
        // w25: everyone asking is reviewed, including people approved before who later left.
        if (st === 'out' && !declined) out.preamble.push(c.reviewPara);
      }
      return out;
    })
  };
}

/** Tidies address fields as the person leaves them (same rules as on save). */
function memberTidy_(req) {
  verifyToken_(req.token);
  var f = req.fields || {};
  return {
    address1: tidyAddressLine_(String(f.address1 || '').slice(0, 120)),
    address2: tidyAddressLine_(String(f.address2 || '').slice(0, 120)),
    city: tidyCity_(String(f.city || '').slice(0, 80))
  };
}

/** Next on step 1: check and format the entries exactly as Save would, without storing anything. */
function memberPreview_(req) {
  var email = verifyToken_(req.token).email;
  return { record: pick_(cleanMember_(email, req.record || {}), MEMBER_FIELDS_) };
}

/** Save on step 3: write the roster (and consent), then apply each Yes/No choice. The session stays open (w25). */
function memberSave_(req) {
  var tok = verifyToken_(req.token);
  if (tok.preview) throw userError_('This is a preview. Nothing is saved.');
  var email = tok.email;
  var c = cleanMember_(email, req.record || {});
  var choices = req.choices || {};
  var active = activeChoices_();
  // No news means no directory: the directory question isn't asked, and saving removes any listing.
  active.forEach(function (ch) {
    if (ch.requires && ch_(active, ch.requires) && choices[ch.requires] === false) choices[ch.key] = false;
  });
  active.forEach(function (ch) {
    if (choices[ch.key] !== true && choices[ch.key] !== false) {
      throw userError_('Please answer: ' + ch.question);
    }
  });
  // Consent is changed only when the directory question is active and answered Yes.
  var dirActive = active.some(function (ch) { return ch.key === 'directory'; });
  var newConsent = null;
  if (dirActive && choices.directory === true) {
    var rc = req.consent || {};
    if ([rc.phone, rc.address].some(function (v) { return v !== true && v !== false; })) {
      throw userError_('Please answer the questions about what to show in the directory.');
    }
    newConsent = { phone: rc.phone, address: rc.address };
  }
  var wantsTerms = dirActive && choices.directory === true;   // must have agreed, now or before
  var by = email + ' (self)';

  var result = withLock_(function () {
    if (tokenSpent_(tok)) throw sessionError_('used');   // e.g. a double tap on Save
    var sh = rosterSheet_();
    var cc = ensureConsentColumns_(sh);
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var rowIndex = -1, used = {};
    for (var i = 1; i < data.length; i++) {
      used[String(data[i][cols.id])] = true;
      if (emailKey_(data[i][cols.email]) === emailKey_(email)) rowIndex = i;
    }

    var before = rowIndex === -1 ? null : rowToRecord_(data[rowIndex], cols);
    if ((before ? before.updated : '') !== (req.updated || '') || (!before && req.updated)) {
      throw userError_('Your information was changed by someone else while this page was open. ' +
        'Please sign in again.');
    }
    var oldConsent = rowIndex === -1 ? { phone: CONSENT_DEFAULTS.phone, address: CONSENT_DEFAULTS.address }
                                     : readConsent_(data[rowIndex], cc);
    var consentChanged = !!newConsent && (newConsent.phone !== oldConsent.phone || newConsent.address !== oldConsent.address);
    var agreedBefore = rowIndex !== -1 && !!termsDate_(data[rowIndex], cc);
    var declined = rowIndex !== -1 && !!dateCell_(data[rowIndex][cc.declined]);
    var newTerms = wantsTerms && !agreedBefore;
    if (newTerms && req.terms !== true) {
      throw userError_('To be listed in the directory, please check the box to agree to the directory terms of use.');
    }
    if (declined && wantsTerms && dirActive) {
      // A declined request isn't queued again (the page doesn't offer it; this is the server's check).
      var inDir = groupMember_(ch_(active, 'directory').group, email);
      if (!inDir) throw userError_('Your request to be listed in the directory was declined.');
    }
    var restoring = !!(before && before.status === 'Archived');
    var changed = !before || restoring || consentChanged || newTerms ||
      CONTENT_FIELDS.some(function (f) { return before[f] !== c[f]; });
    var saved = before;

    if (changed) {
      var width = data[0].length, row;
      if (rowIndex === -1) { row = []; for (var k = 0; k < width; k++) row.push(''); }
      else row = data[rowIndex].slice();
      CONTENT_FIELDS.forEach(function (f) { row[cols[f]] = c[f]; });
      if (rowIndex === -1) row[cols.id] = newId_(used);
      if (newConsent) {
        row[cc.phone] = newConsent.phone ? 'Yes' : 'No';
        row[cc.address] = newConsent.address ? 'Yes' : 'No';
      }
      if (newTerms) row[cc.terms] = new Date();
      row[cols.status] = 'Active';
      row[cols.updated] = new Date();
      row[cols.updatedBy] = by;

      saved = writeRow_(sh, cols, rowIndex, row);
      if (!before) {
        audit_('Create', saved.id, email, by, describeChanges_(null, saved));
      } else {
        if (restoring) audit_('Restore', saved.id, email, by, '');
        var diff = describeChanges_(before, saved);
        if (diff) audit_('Update', saved.id, email, by, diff);
      }
      if (newConsent && (consentChanged || !before)) {
        var parts = [];
        ['phone', 'address'].forEach(function (k) {
          if (!before || newConsent[k] !== oldConsent[k]) {
            parts.push(CONSENT_COLS[k] + ': ' + (before ? yn_(oldConsent[k]) + ' → ' : '') + yn_(newConsent[k]));
          }
        });
        if (parts.length) audit_('Consent', saved.id, email, by, parts.join('; '));
      }
      if (newTerms) audit_('Terms accepted', saved.id, email, by, 'Agreed to the directory terms of use');
    }
    return { saved: saved, created: !before, restored: restoring,
             consent: newConsent || oldConsent };
  });

  // The Yes/No choices (outside the roster lock; groups are a separate system).
  // A failure here doesn't undo the roster save; the person is told and the committee notified.
  var outcome = {}, problem = '';
  active.forEach(function (ch) {
    // The directory only for people on the news: if subscribing to the news didn't go through, don't list them.
    if (ch.requires && choices[ch.key] === true && outcome[ch.requires] !== 'subscribed') {
      outcome[ch.key] = null;
      problem = 'Your information was saved, but we couldn\'t update every choice. The Records Committee has been told and will take care of it.';
      notify_('[MFM Roster] Directory choice skipped for ' + email,
        email + ' said Yes to "' + ch.question + '", but their news subscription didn\'t go through, so the directory was not changed.');
      return;
    }
    try {
      outcome[ch.key] = applyChoice_(ch, email, choices[ch.key], result.saved.id, by);
    } catch (err) {
      outcome[ch.key] = null;
      problem = 'Your information was saved, but we couldn\'t update every choice. The Records Committee has been told and will take care of it.';
      notify_('[MFM Roster] Group change failed for ' + email,
        email + ' answered ' + (choices[ch.key] ? 'Yes' : 'No') + ' to "' + ch.question + '", but updating the group failed:\n\n' + err.message);
    }
  });

  if (result.created || result.restored || outcome.directory === 'requested') {
    var name = (result.saved.first + ' ' + result.saved.last).trim();
    var subject = result.created ? 'New registration: ' : result.restored ? 'Record restored: ' : 'Directory request: ';
    notify_('[MFM Roster] ' + subject + name,
      name + ' (' + email + ') used the member page.\n\n' +
      (result.created ? 'New record created.\n' : '') + (result.restored ? 'Archived record restored.\n' : '') +
      active.map(function (ch) { return ch.key + ': ' + (outcome[ch.key] === null ? 'FAILED' : outcome[ch.key]); }).join('\n') +
      (outcome.directory === 'requested' ? '\n\nThe directory request is in ' + ch_(active, 'directory').pendingGroup +
        ', waiting for review.' + (reviewPageUrl_() ? ' Review it at ' + reviewPageUrl_() : '') : '') +
      '\n\nThe change is in the roster and the audit log.');
  }

  try { sendSavedEmail_(email, result.saved, result.consent, active, outcome); }
  catch (e) { reportError_(e, 'save confirmation email'); }

  return {
    email: email,
    record: pick_(result.saved, MEMBER_FIELDS_),
    consent: result.consent,
    created: result.created,
    restored: result.restored,
    results: active.map(function (ch) {
      var o = outcome[ch.key];
      var text = o === null ? '' : o === 'in' ? ch.doneIn : o === 'listed' ? ch.doneListed
               : (o === 'pending' || o === 'requested') ? (ch.donePending || ch.doneIn)
               : o === 'subscribed' ? ch.doneIn : ch.doneOut;
      return { key: ch.key, value: o, text: text };
    }),
    problem: problem,
    // w25: may they go Home (to the Directory) from the Saved screen?
    access: outcome.directory === 'out' || outcome.directory === 'requested' ? false : directoryAccess_(email)
  };
}

function yn_(b) { return b ? 'Yes' : 'No'; }
function ch_(list, key) { return list.filter(function (c) { return c.key === key; })[0]; }

// ---------------------------------------------------------------- shared checks

var MEMBER_FIELDS_ = ['first', 'last', 'phone', 'address1', 'address2', 'city', 'state', 'zip'];

/** The editor's rules, plus: both names required, and names get the same capitalization fix. */
function cleanMember_(email, rec) {
  var r = pick_(rec, MEMBER_FIELDS_);
  r.email = email;                                   // always the verified address
  r.first = fixCase_(tidySpaces_(r.first));
  r.last = fixCase_(tidySpaces_(r.last));
  if (!r.first || !r.last) throw userError_('Please enter your first and last name.');
  try {
    return cleanRecord_(r);
  } catch (err) {
    err.user = true;                                 // validation messages are meant for the member
    throw err;
  }
}

/**
 * The address as the roster has it, when an equivalent one was typed (jane.v.roberson@ for janevroberson@),
 * so the session, the groups and the log all use the roster's form. Unknown addresses are returned as typed.
 */
function rosterEmail_(email) {
  var found = findByEmail_(email);
  return found && found.record.email ? String(found.record.email).trim().toLowerCase() : email;
}

function findByEmail_(email) {
  var sh = rosterSheet_();
  var cc = ensureConsentColumns_(sh);
  var data = sh.getDataRange().getValues();
  var cols = columns_(data[0]);
  var key = emailKey_(email);   // jane.v.roberson@gmail.com finds janevroberson@gmail.com
  for (var i = 1; i < data.length; i++) {
    if (emailKey_(data[i][cols.email]) === key) {
      var td = termsDate_(data[i], cc);
      return { rowIndex: i, record: rowToRecord_(data[i], cols), consent: readConsent_(data[i], cc),
               termsDate: td ? Utilities.formatDate(td, Session.getScriptTimeZone(), 'MMMM d, yyyy') : '',
               approved: !!dateCell_(data[i][cc.approved]), declined: !!dateCell_(data[i][cc.declined]),
               left: !!dateCell_(data[i][cc.left]) };
    }
  }
  return null;
}

/**
 * Adds the "Show phone", "Show address", "Directory terms", "Directory Approval Date",
 * "Directory Declined Date" and "Directory Left Date" columns at the end of the roster if missing.
 * Returns their indexes as {phone, address, terms, approved, declined, left}.
 */
function ensureConsentColumns_(sh) {
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var want = Object.assign({ terms: TERMS_COL, approved: APPROVED_COL, declined: DECLINED_COL, left: LEFT_COL }, CONSENT_COLS);
  var out = {};
  ['phone', 'address', 'terms', 'approved', 'declined', 'left'].forEach(function (k) {
    var i = head.indexOf(want[k].toLowerCase());
    if (i === -1) {
      lastCol++;
      sh.getRange(1, lastCol).setValue(want[k]).setFontWeight('bold');
      if (k === 'terms' || k === 'approved' || k === 'declined' || k === 'left') sh.getRange(2, lastCol, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd');
      head.push(want[k].toLowerCase());
      i = lastCol - 1;
    }
    out[k] = i;
  });
  return out;
}

/** The date the member agreed to the directory terms, or null. */
function termsDate_(row, cc) { return dateCell_(row[cc.terms]); }

/** A date cell (or a typed date), or null when blank or not a date. */
function dateCell_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  var d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d : null;
}

/** Blank means the default: phone shown, address not shown. */
function readConsent_(row, cc) {
  var out = {};
  Object.keys(CONSENT_COLS).forEach(function (k) {
    var v = String(row[cc[k]] == null ? '' : row[cc[k]]).trim().toLowerCase();
    out[k] = v === 'yes' ? true : v === 'no' ? false : CONSENT_DEFAULTS[k];
  });
  return out;
}

function pick_(o, keys) {
  var r = {};
  keys.forEach(function (k) { r[k] = o && o[k] != null ? o[k] : ''; });
  return r;
}

// ---------------------------------------------------------------- sessions (after Verify)

/** token = base64(email|expiry[|p]) . HMAC signature. Held only in the page's memory. "p": an admin preview. */
function makeToken_(email, preview) {
  var payload = email + '|' + (Date.now() + SESSION_MINUTES * 60 * 1000) + (preview ? '|p' : '');
  return Utilities.base64EncodeWebSafe(payload).replace(/=+$/, '') + '.' + sign_(payload);
}

function verifyToken_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) throw sessionError_('invalid');
  var payload;
  try {
    var b64 = parts[0] + '==='.slice((parts[0].length + 3) % 4);
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString();
  } catch (e) { throw sessionError_('invalid'); }
  if (sign_(payload) !== parts[1]) throw sessionError_('invalid');
  var bits = payload.split('|');
  if (bits.length !== 2 && !(bits.length === 3 && bits[2] === 'p')) throw sessionError_('invalid');
  if (Date.now() > Number(bits[1])) throw sessionError_('expired');
  var tok = { email: bits[0], sig: parts[1], preview: bits.length === 3 };
  if (tokenSpent_(tok)) throw sessionError_('used');
  return tok;
}

function sessionError_(why) {
  var msg = why === 'used' ? 'This session has ended.'
          : why === 'expired' ? 'For your security, this page times out after ' + SESSION_MINUTES + ' minutes.'
          : 'Please start again.';
  var err = userError_(msg + ' To make changes, please sign in again.');
  err.sessionProblem = why;
  return err;
}

function tokenSpent_(tok) {
  return !!CacheService.getScriptCache().get('spent_' + tok.sig.slice(0, 200));
}

function spendToken_(tok) {
  CacheService.getScriptCache().put('spent_' + tok.sig.slice(0, 200), '1', SESSION_MINUTES * 60 + 300);
}

function tokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TOKEN_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', secret);
  }
  return secret;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, tokenSecret_())).replace(/=+$/, '');
}

// ---------------------------------------------------------------- groups (Admin SDK)

/** The choices whose group properties are all set, with their group addresses. */
function activeChoices_() {
  var props = PropertiesService.getScriptProperties();
  var list = CHOICES.map(function (c) {
    var g = c.props.map(function (p) { return (props.getProperty(p) || '').trim(); });
    if (g.some(function (x) { return !x; })) return null;
    return Object.assign({ group: g[0], pendingGroup: g[1] || '' }, c);
  }).filter(Boolean);
  // A choice that requires another (the directory requires news) is offered only when that one is too.
  return list.filter(function (c) { return !c.requires || list.some(function (o) { return o.key === c.requires; }); });
}

/** 'in' (in the group), 'pending' (waiting in the pending group) or 'out'. */
function choiceStatus_(ch, email) {
  if (groupMember_(ch.group, email)) return 'in';
  if (ch.pending && groupMember_(ch.pendingGroup, email)) return 'pending';
  return 'out';
}

function groupMember_(group, email) {
  try {
    AdminDirectory.Members.get(group, email);
    return true;
  } catch (err) {
    if (/not found|404/i.test(err.message)) return false;
    throw err;
  }
}

/**
 * Removes an ordinary member. An owner or manager is left alone (removing them would take away their role,
 * and the groups have only two owners): returns false, logs it and tells the committee.
 */
function removeOrdinary_(group, email, id, by) {
  var info = memberInfo_(group, email);
  if (info && (info.role === 'OWNER' || info.role === 'MANAGER')) {
    audit_('Removal skipped', id, email, by, email + ' is ' + info.role.toLowerCase() + ' of ' + group + '; not removed');
    notify_('[MFM Roster] Not removed: ' + email + ' from ' + group,
      email + ' asked to leave ' + group + ' in Friendly Contacts, but is ' + (info.role === 'OWNER' ? 'an owner' : 'a manager') +
      ' of that group, so it was not removed. Change the role in the Admin console if the removal is wanted.');
    return false;
  }
  removeMember_(group, email);
  return true;
}

function addMember_(group, email) {
  try { AdminDirectory.Members.insert({ email: email, role: 'MEMBER' }, group); }
  catch (err) { if (!/duplicate|already exists|409/i.test(err.message)) throw err; }
}

function removeMember_(group, email) {
  try { AdminDirectory.Members.remove(group, email); }
  catch (err) { if (!/not found|404/i.test(err.message)) throw err; }
}

/**
 * Applies a Yes/No answer and logs any change. Returns the resulting status:
 *  news:      'subscribed' | 'unsubscribed'
 *  directory: 'in' | 'pending' | 'requested' (just added to pending) | 'out'
 * The directory group is never added to here: every request is reviewed (w25). Leaving sets the Left Date.
 */
function applyChoice_(ch, email, want, id, by) {
  if (!ch.pending) {
    var isIn = groupMember_(ch.group, email);
    if (want && !isIn) { addMember_(ch.group, email); audit_('Subscribe', id, email, by, ch.group); }
    if (!want && isIn) {
      if (!removeOrdinary_(ch.group, email, id, by)) return 'subscribed';
      audit_('Unsubscribe', id, email, by, ch.group);
    }
    return want ? 'subscribed' : 'unsubscribed';
  }
  var st = choiceStatus_(ch, email);
  if (want) {
    if (st !== 'out') return st;
    addMember_(ch.pendingGroup, email);
    audit_('Directory request', id, email, by, 'Added to ' + ch.pendingGroup + ' for approval');
    return 'requested';
  }
  if (st === 'in') {
    if (!removeOrdinary_(ch.group, email, id, by)) return 'in';
    audit_('Directory removal', id, email, by, 'Removed from ' + ch.group);
    setDirectoryDates_(email, { left: true });
  }
  if (groupMember_(ch.pendingGroup, email)) {
    removeMember_(ch.pendingGroup, email);
    audit_('Directory request withdrawn', id, email, by, 'Removed from ' + ch.pendingGroup);
  }
  return 'out';
}

// ---------------------------------------------------------------- emails

/**
 * "Sent Thursday, November 19, 2026, 9:41 AM" above the greeting of each sign-in email, the same size as the
 * rest, so an old email is easy to tell from the current one. The pages name the same time.
 */
function sentLine_(at, style) {
  return at ? '<p style="' + style + '">Sent ' + escapeHtml_(sentStamp_(at)) + '</p>' : '';
}
function sentText_(at) { return at ? 'Sent ' + sentStamp_(at) + '\n\n' : ''; }
function sentStamp_(at) { return Utilities.formatDate(new Date(at), Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy, h:mm a'); }

/** dir (w25): the member has directory access, so the email mentions the directory too. */
function sendCodeEmail_(email, code, first, onRoster, dir, at) {
  var greeting = first ? 'Dear ' + first + ',' : 'Dear Friend,';
  var subject = 'Your Midlothian Friends Meeting one-time security code';
  var paras = onRoster ? [
    'You asked to review and update your contact information with Midlothian Friends Meeting' + (dir ? ', or to view or download the Meeting directory' : '') + '. We keep your information confidential, so we only show or change it after confirming that this email address belongs to you. That’s what this one-time security code is for.',
    '<b>What to do:</b> go back to the page where you asked for the code, type the six digits above, and tap <b>Verify</b>. The code works for ' + CODE_MINUTES + ' minutes. If you didn’t ask for a code, simply ignore this email; nothing will change.'
  ] : [
    'You asked to join the Midlothian Friends Meeting roster. We keep your contact information confidential, so before we add it we need to confirm that this email address belongs to you. That’s what this one-time security code is for.',
    '<b>What to do:</b> go back to the page where you asked for the code, type the six digits above, and tap <b>Verify</b>. The code works for ' + CODE_MINUTES + ' minutes. If you’ve changed your mind, simply ignore this email; nothing will be saved.',
    'After you verify, you’ll be able to choose whether to receive our periodic newsletter announcing upcoming events at Midlothian Friends Meeting and in the Richmond area. We will not share your information with any outside groups, and we will not ask you for donations.'
  ];
  paras.push('<b>Please keep this code to yourself.</b> No one from the Meeting will ever ask you for it, by email, phone or in person' +
    '.');
  paras.push('Questions? Just reply to this email.');

  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var top =
    '<div style="font-size:40px;font-weight:700;letter-spacing:8px;text-align:center;margin:0 0 6px;">' + code + '</div>' +
    '<div style="font-size:14px;color:#5f6b78;text-align:center;margin:0 0 22px;">Your one-time security code</div>';
  var html = emailShell_(top + sentLine_(at, p) + '<p style="' + p + '">' + escapeHtml_(greeting) + '</p>' +
    paras.map(function (t) { return '<p style="' + p + '">' + t + '</p>'; }).join('') +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  // Plain-text version: the code comes first so phone notifications show it.
  var text = code + '\nYour one-time security code\n\n' + sentText_(at) + greeting + '\n\n' +
    paras.map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('\n\n') +
    '\n\nIn Friendship,\nMidlothian Friends Meeting\n';

  sendMail_(email, subject, text, html);
}

/**
 * The sign-in link email: the same look as the member page, with a green Sign in button and a black
 * Cancel button (which voids the link). The long address stays behind the buttons.
 */
/** dir (w25): the member has directory access, so the email mentions the directory too. */
function sendLinkEmail_(email, url, first, onRoster, dir, at) {
  var greeting = first ? 'Dear ' + first + ',' : 'Dear Friend,';
  var title = 'Sign in to Friendly Contacts';
  var subject = 'Sign in to Friendly Contacts, Midlothian Friends Meeting';
  var why = (onRoster
    ? 'Tapping the “Sign In” button below allows you to review and update your contact information in the records of the Meeting' +
      (dir ? ', and to view or download the Meeting directory.' : '.')
    : 'Tapping the “Sign In” button below allows you to join the roster of the Meeting.') +
    ' Tap “Cancel” or delete this message if you didn’t ask for this email.';
  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var signIn = url.replace(/#.*$/, '') + '#k=' + url.replace(/^.*#k=/, '');
  var cancel = url.replace(/#.*$/, '') + '#x=' + url.replace(/^.*#k=/, '');
  function button(href, label, color) {
    return '<a href="' + escapeHtml_(href) + '" style="display:block;background:' + color + ';color:#ffffff;' +
      'text-decoration:none;font-size:18px;font-weight:700;text-align:center;padding:15px 10px;border-radius:14px;">' +
      label + '</a>';
  }
  var buttons =
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 10px;"><tr>' +
    '<td width="50%" style="padding-right:6px;">' + button(signIn, 'Sign In', '#1e7b34') + '</td>' +
    '<td width="50%" style="padding-left:6px;">' + button(cancel, 'Cancel', '#111111') + '</td>' +
    '</tr></table>' +
    '<p style="font-size:14px;color:#5f6b78;text-align:center;margin:0 0 22px;">The buttons expire when you tap a button or after ' +
    CODE_MINUTES + ' minutes.</p>';
  var paras = [why];
  if (!onRoster) paras.push('After you sign in, you’ll be able to choose whether to receive our periodic newsletter announcing upcoming events at Midlothian Friends Meeting and in the Richmond area. We will not share your information with any outside groups, and we will not ask you for donations.');
  paras.push('Questions? Just reply to this email.');

  var html = emailShell_(
    '<div style="font-size:24px;font-weight:700;text-align:center;margin:0 0 18px;">' + title + '</div>' +
    sentLine_(at, p) + '<p style="' + p + '">' + escapeHtml_(greeting) + '</p>' +
    '<p style="' + p + '">Thank you for verifying your email address.</p>' +
    '<p style="' + p + '">' + paras[0] + '</p>' + buttons +
    paras.slice(1).map(function (t) { return '<p style="' + p + '">' + t + '</p>'; }).join('') +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  var text = title + '\n\n' + sentText_(at) + greeting + '\n\nThank you for verifying your email address.\n\n' + why + '\n\nSign In:\n' + signIn + '\n\nCancel:\n' + cancel +
    '\n\nThe buttons expire when you tap a button or after ' + CODE_MINUTES + ' minutes.\n\n' +
    paras.slice(1).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('\n\n') +
    '\n\nIn Friendship,\nMidlothian Friends Meeting\n';
  sendMail_(email, subject, text, html);
}

/** After Save: what is now on record, in the same look as the other emails. */
function sendSavedEmail_(email, rec, consent, active, outcome) {
  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var k = 'font-size:13px;color:#5f6b78;margin:10px 0 2px;';
  var star = '<span style="color:#b42318;font-weight:700">*</span>';
  var greeting = rec.first ? 'Dear ' + rec.first + ',' : 'Dear Friend,';
  var addr = [rec.address1, rec.address2,
    [rec.city, [rec.state, rec.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean);
  var rows = [['Name', escapeHtml_((rec.first + ' ' + rec.last).trim())], ['Email', escapeHtml_(email)]];
  if (rec.phone) rows.push(['Phone', escapeHtml_(rec.phone)]);
  if (addr.length) rows.push(['Address', addr.map(escapeHtml_).join('<br>')]);
  var lines = [], textLines = [], waiting = false;
  active.forEach(function (ch) {
    var o = outcome[ch.key];
    if (o === null || o === undefined) return;
    var on = ['in', 'listed', 'subscribed', 'pending', 'requested'].indexOf(o) !== -1;
    var pending = o === 'pending' || o === 'requested';
    waiting = waiting || pending;
    var label = on ? ch.reviewIn : ch.reviewOut;
    lines.push(escapeHtml_(label) + (pending ? ' ' + star : ''));
    textLines.push(label + (pending ? ' *' : ''));
    if (ch.key === 'directory' && on) {
      ['Show phone in directory: ' + yn_(consent.phone), 'Show address in directory: ' + yn_(consent.address)]
        .forEach(function (t) { lines.push(t); textLines.push(t); });
    }
  });
  if (lines.length) rows.push(['Your choices', lines.join('<br>')]);
  var box = '<div style="background:#f5f5f7;border-radius:14px;padding:6px 16px 14px;margin:0 0 16px;font-size:16px;line-height:1.45;">' +
    rows.map(function (r) { return '<div style="' + k + '">' + r[0] + '</div><div>' + r[1] + '</div>'; }).join('') + '</div>';
  var foot = waiting ? '<p style="font-size:14px;color:#5f6b78;margin:0 0 16px;">' + star +
    ' Your request to be listed in the directory is waiting for review. This may take a month or two.</p>' : '';
  var html = emailShell_(
    '<div style="font-size:24px;font-weight:700;text-align:center;margin:0 0 18px;">Your contact information was updated</div>' +
    '<p style="' + p + '">' + escapeHtml_(greeting) + '</p>' +
    '<p style="' + p + '">Thank you for updating your contact information with Midlothian Friends Meeting. This is what we now have on record:</p>' +
    box + foot +
    '<p style="' + p + '"><b>If you didn’t make these changes,</b> reply to this email right away.</p>' +
    '<p style="' + p + '">Questions? Just reply to this email.</p>' +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  var text = 'Your contact information was updated\n\n' + greeting + '\n\nThank you for updating your contact information with ' +
    'Midlothian Friends Meeting. This is what we now have on record:\n\n' +
    rows.slice(0, rows.length - (lines.length ? 1 : 0)).map(function (r) { return r[0] + ': ' + r[1].replace(/<br>/g, ', ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); }).join('\n') +
    (textLines.length ? '\n\nYour choices:\n' + textLines.join('\n') : '') +
    (waiting ? '\n\n* Your request to be listed in the directory is pending. Requests are normally processed weekly.' : '') +
    '\n\nIf you didn’t make these changes, reply to this email right away.\n\nQuestions? Just reply to this email.' +
    '\n\nIn Friendship,\nMidlothian Friends Meeting\n';
  sendMail_(email, 'Your Friendly Contacts update, Midlothian Friends Meeting', text, html);
}

/** After Cancel, only once signed in (so the page can't be used to email strangers). */
function sendCanceledEmail_(email, first) {
  var p = 'font-size:17px;line-height:1.5;margin:0 0 16px;';
  var greeting = first ? 'Dear ' + first + ',' : 'Dear Friend,';
  var page = linkPageUrl_();
  var msg = 'You signed in to Friendly Contacts and then tapped Cancel, so nothing was changed. If you canceled by accident, you can start again at any time.';
  var btn = page ? '<div style="max-width:260px;margin:4px auto 22px;"><a href="' + escapeHtml_(page) + '" style="display:block;' +
    'background:#1e7b34;color:#ffffff;text-decoration:none;font-size:18px;font-weight:700;text-align:center;padding:15px 10px;' +
    'border-radius:14px;">Start again</a></div>' : '';
  var html = emailShell_(
    '<div style="font-size:24px;font-weight:700;text-align:center;margin:0 0 18px;">Your Friendly Contacts session was canceled</div>' +
    '<p style="' + p + '">' + escapeHtml_(greeting) + '</p><p style="' + p + '">' + msg + '</p>' + btn +
    '<p style="' + p + '">Questions? Just reply to this email.</p>' +
    '<p style="' + p + 'margin-top:6px;">In Friendship,<br>Midlothian Friends Meeting</p>');
  var text = 'Your Friendly Contacts session was canceled\n\n' + greeting + '\n\n' + msg + (page ? '\n\nStart again: ' + page : '') +
    '\n\nQuestions? Just reply to this email.\n\nIn Friendship,\nMidlothian Friends Meeting\n';
  sendMail_(email, 'Your Friendly Contacts session was canceled, Midlothian Friends Meeting', text, html);
}

/**
 * Roster IDs of the 138 people whose full address was printed in the April 2025 directory.
 * Used by activateDirectory() and markApril2025Addresses().
 */
var APRIL_2025_ADDRESS_IDS = [
    '013eeb1d', '023df2ec', '027307fb', '0311298e', '03254530', '038e80f7', '05d1b68e', '0902dc4f',
    '09e53187', '0b34e6e0', '0bee490e', '0cd1d4f1', '0e48da89', '106e8e2a', '1482ba35', '15298e0c',
    '16f49f23', '18b48f1c', '19feeab4', '1b98075e', '1db95217', '1e5e78ea', '1ed58b59', '212d6dfd',
    '21cb6b02', '25b9ed03', '2641e930', '27f747d1', '2837ee81', '2a028366', '2bf1cc90', '2c344bbf',
    '2dda6025', '30012460', '379dbf0e', '3950e697', '39b1c1f1', '3a4e8184', '403ff21f', '40b54db7',
    '412299f4', '419c2a34', '4ebf58a2', '5090d8f9', '5195e567', '52aa1ef9', '532c4d7a', '57131b6d',
    '5713debe', '579e0731', '59c2d407', '59f0604e', '5b5e7064', '629dce32', '642257ec', '66f3f2a8',
    '6917054f', '692505f3', '6b32c474', '6f1fa8a7', '70d36efe', '70d780b1', '722d80c1', '73c9ef4d',
    '7420dcc6', '7674fe2d', '77625bb9', '7a70e05c', '84123bb5', '84e14453', '8564f2a7', '8730bdbe',
    '87569f8e', '88d87095', '8c1bd681', '8feb9672', '91cf99b3', '92eacd55', '96f75839', '971f3ccc',
    '972007ec', '9780f286', '982c2f30', '992f68dc', '9e3d7819', '9f5e52f9', 'a094c167', 'a15809df',
    'a3461e5c', 'a35d8b98', 'a612a648', 'a899399c', 'ab68bad0', 'abab60cd', 'af0209d3', 'b046a860',
    'b2010eff', 'b32229a0', 'b8d3514c', 'b8e5a552', 'b993c7e9', 'ba88a081', 'bb38bdeb', 'bbe49a20',
    'bd971754', 'be2ff80b', 'befc57c2', 'bf8f78b6', 'bfa87c9b', 'c05cda60', 'c0e9e9ac', 'c1b7dc68',
    'c390d979', 'c58ebf84', 'c6fcafbe', 'c72247d8', 'c82c6811', 'ca88eaf3', 'ceaacd5d', 'cefad955',
    'cf52968c', 'cfaa406d', 'd08d8f90', 'd1b3540e', 'd381665d', 'd6522385', 'de4caf94', 'dfbcb25f',
    'e41c1e14', 'e4451f41', 'e4c9bd94', 'e53e0fb6', 'e8be196e', 'eac95e0b', 'ee33378f', 'f06457bd',
    'f4f85a28', 'f65accb9'
];

/**
 * Run ONCE from the editor: marks the people above in a roster column "April 2025 address" (Yes).
 * Changes nothing else: "Show address" and the directory are untouched. Safe to run again.
 */
function markApril2025Addresses() {
  var COL = 'April 2025 address';
  var want = {};
  APRIL_2025_ADDRESS_IDS.forEach(function (id) { want[id] = true; });
  var n = withLock_(function () {
    var sh = rosterSheet_();
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var c = head.indexOf(COL);
    if (c === -1) {
      c = head.length;
      sh.getRange(1, c + 1).setValue(COL).setFontWeight('bold');
    }
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var out = [], count = 0;
    for (var i = 1; i < data.length; i++) {
      var yes = !!want[String(data[i][cols.id]).trim()];
      out.push([yes ? 'Yes' : '']);
      if (yes) count++;
    }
    if (out.length) sh.getRange(2, c + 1, out.length, 1).setValues(out);
    return count;
  });
  Logger.log('Marked %s people in the "%s" column (%s on the list).', n, COL, APRIL_2025_ADDRESS_IDS.length);
}

// ---------------------------------------------------------------- carrying the April 2025 directory forward

/**
 * Run ONLY after the Meeting agrees. Everyone now in DIRECTORY_GROUP who is on the roster gets:
 *   Directory Approval Date = today (if blank), Show phone = Yes (if blank), and, for the April 2025
 *   addresses above, Show address = Yes (if blank).
 * Filled cells are never changed, so a choice someone made in Friendly Contacts stands. Every change is in
 * the audit log. Safe to run again. Undo with deactivateDirectory().
 */
function activateDirectory() { activate_(null); }

/** For testing: the same as activateDirectory(), for the DIRECTORY_TESTERS property only (they must be in DIRECTORY_GROUP). */
function activateDirectoryFor() {
  var t = directoryTesters_();
  if (!t.length) throw new Error('Add the test emails to the DIRECTORY_TESTERS script property first.');
  activate_(t);
}

/**
 * Undo: for people with a Directory Approval Date who have NOT saved a directory choice since (no
 * "Directory terms" date), clears Show phone, Show address and Directory Approval Date. Their group
 * membership is left as it is. People who saved have made their own choice, and it stands.
 */
function deactivateDirectory() { deactivate_(null); }

/** For testing: the same as deactivateDirectory(), for the DIRECTORY_TESTERS property only. */
function deactivateDirectoryFor() {
  var t = directoryTesters_();
  if (!t.length) throw new Error('Add the test emails to the DIRECTORY_TESTERS script property first.');
  deactivate_(t);
}

function activate_(only) {
  var group = (PropertiesService.getScriptProperties().getProperty('DIRECTORY_GROUP') || '').trim();
  if (!group) throw new Error('DIRECTORY_GROUP is not set in the script properties.');
  var inGroup = {};
  listMembers_(group).forEach(function (m) { if (m.email) inGroup[m.email] = true; });
  var wanted = only ? onlySet_(only) : null;
  var april = {};
  APRIL_2025_ADDRESS_IDS.forEach(function (id) { april[id] = true; });
  var today = new Date();

  var res = withLock_(function () {
    var sh = rosterSheet_();
    var cc = ensureConsentColumns_(sh);
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var done = [], seen = {};
    for (var i = 1; i < data.length; i++) {
      var email = String(data[i][cols.email]).trim().toLowerCase();
      if (!email || !inGroup[email] || (wanted && !wanted[email])) continue;
      if (String(data[i][cols.status]).trim() === 'Archived') continue;
      seen[email] = true;
      var id = String(data[i][cols.id]).trim(), parts = [];
      function setIfBlank(col, value, label) {
        if (String(data[i][col]).trim() !== '') return;
        sh.getRange(i + 1, col + 1).setValue(value);
        parts.push(label);
      }
      setIfBlank(cc.approved, today, APPROVED_COL);
      setIfBlank(cc.phone, 'Yes', CONSENT_COLS.phone + ': Yes');
      if (april[id]) setIfBlank(cc.address, 'Yes', CONSENT_COLS.address + ': Yes');
      if (parts.length) done.push({ id: id, email: email, parts: parts });
    }
    return { done: done, seen: seen };
  });
  res.done.forEach(function (d) {
    audit_('Directory activated', d.id, d.email, 'activateDirectory', 'April 2025 directory carried forward: ' + d.parts.join('; '));
  });
  var missing = Object.keys(wanted || inGroup).filter(function (e) { return !res.seen[e]; });
  Logger.log('Activated %s people (%s in %s%s).', res.done.length, Object.keys(inGroup).length, group,
    wanted ? ', ' + Object.keys(wanted).length + ' asked for' : '');
  if (missing.length) {
    Logger.log('Skipped (%s): %s', missing.length,
      wanted ? 'not in ' + group + ', not on the roster, or archived: ' + missing.join(', ')
             : 'in the group but not on the roster, or archived: ' + missing.join(', '));
  }
}

function deactivate_(only) {
  var wanted = only ? onlySet_(only) : null;
  var done = withLock_(function () {
    var sh = rosterSheet_();
    var cc = ensureConsentColumns_(sh);
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var email = String(data[i][cols.email]).trim().toLowerCase();
      if (wanted && !wanted[email]) continue;
      if (!dateCell_(data[i][cc.approved]) || termsDate_(data[i], cc)) continue;
      [cc.approved, cc.phone, cc.address].forEach(function (c) { sh.getRange(i + 1, c + 1).clearContent(); });
      out.push({ id: String(data[i][cols.id]).trim(), email: email });
    }
    return out;
  });
  done.forEach(function (d) {
    audit_('Directory deactivated', d.id, d.email, 'deactivateDirectory',
      'Cleared ' + [APPROVED_COL, CONSENT_COLS.phone, CONSENT_COLS.address].join(', '));
  });
  Logger.log('Deactivated %s people.', done.length);
}

function onlySet_(list) {
  var set = {};
  [].concat(list).forEach(function (e) { e = String(e || '').trim().toLowerCase(); if (e) set[e] = true; });
  return set;
}

// ---------------------------------------------------------------- admin preview

/**
 * /update/?preview: the admin's password (PREVIEW_ADMIN's row in the PINs tab; same lockout as the editor),
 * then any member's email. Returns a preview session: load works as usual; save refuses; cancel sends nothing.
 */
function adminPreview_(req) {
  var admin = (PropertiesService.getScriptProperties().getProperty('PREVIEW_ADMIN') || PREVIEW_ADMIN_DEFAULT)
    .trim().toLowerCase();
  try {
    checkPassword_(admin, req.password);
  } catch (e) {
    if (e.user && /don.t match/i.test(e.message)) throw userError_('The admin password isn\u2019t right.');
    throw e;   // empty fields, or the lockout message
  }
  var email = cleanEmail_(req.email);
  var found = findByEmail_(email);
  if (found && found.record.email) email = String(found.record.email).trim().toLowerCase();
  audit_('Preview', found ? found.record.id : '', email, admin, 'Previewed Friendly Contacts as this member; nothing saved');
  return { token: makeToken_(email, true), email: email };
}

/** The card both emails share: soft grey background, white rounded card, the Meeting's logo on top. */
function emailShell_(inner) {
  var logo = logoBlob_()
    ? '<div style="text-align:center;margin:0 0 14px;"><img src="cid:mfmlogo" alt="" height="72" ' +
      'style="height:72px;width:auto;max-width:240px;border:0;display:inline-block;"></div>'
    : '';
  return '<div style="background:#f5f5f7;padding:20px 10px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px 22px;color:#1f2933;">' +
    logo + inner + '</div></div>';
}

/** Run from the editor to check the email logo: approves the permission it needs and logs the result. */
function checkLogo() {
  CacheService.getScriptCache().remove('logo64');
  var b = logoBlob_();
  Logger.log(b ? 'Logo OK: ' + b.getBytes().length + ' bytes' : 'No logo: check LOGO_URL / the file on the website');
}

/** The logo image for emails, fetched from LOGO_URL and kept for 6 hours; null if it can't be had. */
function logoBlob_() {
  var url = mfmLogoUrl_();
  if (!/^https:\/\//.test(url)) return null;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('logo64');
  if (hit === 'none') return null;
  try {
    if (hit) return Utilities.newBlob(Utilities.base64Decode(hit), 'image/png', 'logo.png');
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var type = String(r.getHeaders()['Content-Type'] || r.getHeaders()['content-type'] || '');
    if (r.getResponseCode() !== 200 || !/^image\//.test(type)) throw new Error('Logo not found at ' + url);
    var blob = r.getBlob().setName('logo.png');
    var b64 = Utilities.base64Encode(blob.getBytes());
    if (b64.length < 95000) cache.put('logo64', b64, 21600);   // cache values are limited to 100 KB
    return blob;
  } catch (e) {
    cache.put('logo64', 'none', 600);   // try again in 10 minutes; send without the logo meanwhile
    return null;
  }
}

/** Sends from FROM_EMAIL when Gmail offers it as a "Send mail as" address; otherwise from the owner. */
function sendMail_(to, subject, text, html) {
  var from = (PropertiesService.getScriptProperties().getProperty('FROM_EMAIL') || '').trim().toLowerCase();
  var opts = { htmlBody: html };
  if (from && GmailApp.getAliases().map(function (a) { return a.toLowerCase(); }).indexOf(from) !== -1) {
    opts.from = from;
  }
  opts.name = senderName_(opts.from);
  if (html.indexOf('cid:mfmlogo') !== -1) {
    var logo = logoBlob_();
    if (logo) opts.inlineImages = { mfmlogo: logo };
  }
  GmailApp.sendEmail(to, subject, text, opts);
}

/**
 * The display name set for the sender in Gmail's "Send mail as" settings (needs the Gmail API
 * service). Remembered for 6 hours; falls back to FROM_NAME if it can't be read.
 */
function senderName_(from) {
  var cache = CacheService.getScriptCache();
  var key = 'sendername_' + (from || 'owner');
  var name = cache.get(key);
  if (name) return name;
  try {
    var addr = from || Session.getEffectiveUser().getEmail();
    name = Gmail.Users.Settings.SendAs.get('me', addr).displayName;
  } catch (err) { name = ''; }   // Gmail API service not added, or no name set
  name = name || FROM_NAME;
  cache.put(key, name, 6 * 3600);
  return name;
}

function notify_(subject, body) {
  try {
    MailApp.sendEmail({ to: notifyEmail_(), subject: subject, body: body, name: senderName_('') });
  } catch (err) {
    console.error('Could not send notice: ' + err.message);
  }
}

function notifyEmail_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('NOTIFY_EMAIL') || props.getProperty('CLERK_EMAIL') || Session.getEffectiveUser().getEmail();
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

// ---------------------------------------------------------------- nightly check

/**
 * Removes from DIRECTORY_GROUP and DIRECTORY_PENDING_GROUP every ordinary member who isn't in NEWS_GROUP
 * (the directory is only for people who receive the news). Never adds anyone, never touches NEWS_GROUP,
 * and leaves group owners and managers alone. Silent: each removal is recorded in the audit log only.
 * Safety stop: if the news list comes back empty, or more than a quarter of the directory would be
 * removed at once, nothing is removed and the committee gets one notice.
 */
function scrubDirectory() {
  scrubGroups_();
  try { removeArchived_(false); } catch (e) { reportError_(e, 'nightly check: archived records'); }
  try { markLeftDates_(); } catch (e) { reportError_(e, 'nightly check: Left Dates'); }
}

/** Archived removals each night above this many stop with a notice; scrubDirectoryNow() then applies them. */
var ARCHIVED_REMOVALS_PER_NIGHT = 10;

/**
 * Part of the nightly check (w25): anyone whose roster record is Archived (and who has no Active record) is removed
 * from NEWS_GROUP, DIRECTORY_GROUP and DIRECTORY_PENDING_GROUP. Matched the Gmail-equivalent way (emailKey_).
 * Owners, managers and nested groups are left alone. Leaving the directory group sets the Directory Left Date.
 * noLimit: run from scrubDirectoryNow() after a "check stopped" notice.
 */
function removeArchived_(noLimit) {
  var props = PropertiesService.getScriptProperties();
  var groups = ['NEWS_GROUP', 'DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP']
    .map(function (k) { return (props.getProperty(k) || '').trim(); }).filter(Boolean);
  if (!groups.length) return 0;
  var data = rosterSheet_().getDataRange().getValues(), cols = columns_(data[0]);
  var archived = {}, active = {};
  for (var i = 1; i < data.length; i++) {
    var em = String(data[i][cols.email]).trim().toLowerCase();
    if (!em) continue;
    if (isArchived_(data[i], cols)) archived[emailKey_(em)] = String(data[i][cols.id]).trim();
    else active[emailKey_(em)] = true;
  }
  Object.keys(active).forEach(function (k) { delete archived[k]; });
  if (!Object.keys(archived).length) return 0;

  var dirGroup = (props.getProperty('DIRECTORY_GROUP') || '').trim().toLowerCase();
  var plan = [];
  groups.forEach(function (g) {
    listMembers_(g).forEach(function (m) {
      if (m.role !== 'MEMBER' || !isPerson_(m)) return;   // owners, managers, nested groups: leave alone
      var k = emailKey_(m.email);
      if (archived.hasOwnProperty(k)) plan.push({ group: g, email: m.email, id: archived[k] });
    });
  });
  if (!plan.length) return 0;
  if (!noLimit && plan.length > ARCHIVED_REMOVALS_PER_NIGHT) {
    notify_('[MFM Roster] Nightly check: archived removals stopped',
      plan.length + ' group entries belong to archived roster records. That is more than ' + ARCHIVED_REMOVALS_PER_NIGHT +
      ', so nothing was removed for archived records tonight. If it is correct, run scrubDirectoryNow() in the editor.\n\n' +
      plan.map(function (p) { return p.email + ' from ' + p.group; }).join('\n'));
    return 0;
  }
  plan.forEach(function (p) {
    removeMember_(p.group, p.email);
    audit_(p.group.toLowerCase() === dirGroup || p.group === (props.getProperty('DIRECTORY_PENDING_GROUP') || '').trim()
             ? 'Directory removal' : 'Unsubscribe',
           p.id, p.email, 'nightly check', 'Removed from ' + p.group + ': archived on the roster');
    if (p.group.toLowerCase() === dirGroup) {
      try { setDirectoryDates_(p.email, { left: true }); } catch (e) { reportError_(e, 'nightly check: Left Date'); }
    }
  });
  return plan.length;
}

function scrubGroups_() {
  var props = PropertiesService.getScriptProperties();
  var news = (props.getProperty('NEWS_GROUP') || '').trim();
  var groups = ['DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP']
    .map(function (k) { return (props.getProperty(k) || '').trim(); }).filter(Boolean);
  if (!news || !groups.length) return;

  var onNews = {};
  listMembers_(news).forEach(function (m) { onNews[m.email] = true; });
  if (!Object.keys(onNews).length) {
    notify_('[MFM Roster] Nightly directory check stopped',
      'The news group ' + news + ' looked empty, so nothing was removed from the directory groups.');
    return;
  }

  var plan = [], total = 0;
  groups.forEach(function (g) {
    listMembers_(g).forEach(function (m) {
      if (m.role !== 'MEMBER' || !isPerson_(m)) return;   // owners, managers, nested groups: leave alone
      total++;
      if (!onNews[m.email]) plan.push({ group: g, email: m.email });
    });
  });
  if (!plan.length) return;
  if (plan.length > Math.max(5, total / 4)) {
    notify_('[MFM Roster] Nightly directory check stopped',
      plan.length + ' of ' + total + ' directory entries are not in ' + news + '. That is more than expected, ' +
      'so nothing was removed. If it is correct, run scrubDirectoryNow() in the editor.');
    return;
  }
  removeNotOnNews_(plan);
}

/** Run by hand to apply the check without the safety limit (after a "check stopped" notice). */
function scrubDirectoryNow() {
  var props = PropertiesService.getScriptProperties();
  var news = (props.getProperty('NEWS_GROUP') || '').trim();
  var onNews = {};
  listMembers_(news).forEach(function (m) { onNews[m.email] = true; });
  if (!Object.keys(onNews).length) throw new Error('The news group looks empty; nothing removed.');
  var plan = [];
  ['DIRECTORY_GROUP', 'DIRECTORY_PENDING_GROUP'].forEach(function (k) {
    var g = (props.getProperty(k) || '').trim();
    if (g) listMembers_(g).forEach(function (m) {
      if (m.role === 'MEMBER' && isPerson_(m) && !onNews[m.email]) plan.push({ group: g, email: m.email });
    });
  });
  removeNotOnNews_(plan);
  Logger.log('Removed %s entries.', plan.length);
  Logger.log('Removed %s entries for archived records.', removeArchived_(true));
  markLeftDates_();
}

/**
 * Part of the nightly check (w25): anyone approved who is no longer in DIRECTORY_GROUP and has no Directory Left
 * Date gets tonight's date, however they left (the unsubscribe link in a directory email, the Admin console, ...).
 * Dates already there are never changed; people never approved (pending, declined) get none. Writes dates only and
 * changes no group. Skipped if the group comes back empty, in case the lookup failed.
 */
function markLeftDates_() {
  var group = (PropertiesService.getScriptProperties().getProperty('DIRECTORY_GROUP') || '').trim();
  if (!group) return;
  var inDir = peopleIn_(group);
  if (!Object.keys(inDir).length) return;
  var done = withLock_(function () {
    var sh = rosterSheet_();
    var cc = ensureConsentColumns_(sh);
    var data = sh.getDataRange().getValues();
    var cols = columns_(data[0]);
    var today = new Date(), out = [];
    for (var i = 1; i < data.length; i++) {
      var email = String(data[i][cols.email]).trim().toLowerCase();
      if (!email || !dateCell_(data[i][cc.approved]) || dateCell_(data[i][cc.left]) || inDir[emailKey_(email)]) continue;
      sh.getRange(i + 1, cc.left + 1).setValue(today);
      out.push({ id: String(data[i][cols.id]).trim(), email: email });
    }
    return out;
  });
  done.forEach(function (d) {
    audit_('Directory left', d.id, d.email, 'nightly check', 'Not in ' + group + '; ' + LEFT_COL + ' set');
  });
}

function removeNotOnNews_(plan) {
  var ids = {};
  try {
    var data = rosterSheet_().getDataRange().getValues(), cols = columns_(data[0]);
    for (var i = 1; i < data.length; i++) ids[String(data[i][cols.email]).trim().toLowerCase()] = data[i][cols.id];
  } catch (e) { /* the audit entries just won't have record IDs */ }
  var dirGroup = (PropertiesService.getScriptProperties().getProperty('DIRECTORY_GROUP') || '').trim().toLowerCase();
  plan.forEach(function (p) {
    removeMember_(p.group, p.email);
    audit_('Directory removal', ids[p.email] || '', p.email, 'nightly check', 'Removed from ' + p.group + ': not on the news list');
    if (p.group.toLowerCase() === dirGroup) {
      try { setDirectoryDates_(p.email, { left: true }); } catch (e) { reportError_(e, 'nightly check: Left Date'); }
    }
  });
}

/** All members of a group: [{email (lowercase), role, type}]. */
function listMembers_(group) {
  var out = [], token;
  do {
    var page = AdminDirectory.Members.list(group, { maxResults: 200, pageToken: token });
    (page.members || []).forEach(function (m) {
      out.push({ email: String(m.email || '').toLowerCase(), role: m.role, type: m.type });
    });
    token = page.nextPageToken;
  } while (token);
  return out;
}

/** Run once from the editor: runs scrubDirectory() every night around 2 a.m. (the project's time zone). */
function installNightlyScrub() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scrubDirectory') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scrubDirectory').timeBased().everyDays(1).atHour(2).create();
  Logger.log('Nightly directory check scheduled for about 2 a.m. %s.', Session.getScriptTimeZone());
}

/**
 * Logo for emails. A LOGO_URL script property wins if set; otherwise use whichever site
 * actually serves the image, so it moves to midlothianfriends.org by itself once that
 * name points at the droplet (re-checked every 6 hours).
 */
function mfmLogoUrl_() {
  var prop = (PropertiesService.getScriptProperties().getProperty('LOGO_URL') || '').trim();
  if (prop) return prop;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('logo_url');
  if (hit) return hit;
  var candidates = ['https://midlothianfriends.org/logo.png',
                    'https://midlothianfriends.freeddns.org/logo.png'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      var r = UrlFetchApp.fetch(candidates[i], { muteHttpExceptions: true, followRedirects: false });
      var h = r.getHeaders();
      var type = String(h['Content-Type'] || h['content-type'] || '');
      if (r.getResponseCode() === 200 && type.indexOf('image/') === 0) {
        cache.put('logo_url', candidates[i], 21600);
        return candidates[i];
      }
    } catch (e) { /* bad certificate or no answer: try the next */ }
  }
  return candidates[candidates.length - 1];
}
