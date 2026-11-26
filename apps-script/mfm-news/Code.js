/**
 * MFM News: approve once, send to the group and post on the website.
 *
 * A manager or owner of the Quaker Town Crier group emails a finished message
 * to mfm-news@ (an alias of admin@). Within 10 minutes the sender gets
 * "Approval required for <subject>": Approve and Deny buttons, then the
 * message as subscribers will see it. Approve sends it to the group from
 * "Midlothian Friends Meeting News" <mfm-news@> (replies to mfm-news-reply@
 * and the author) and posts it in the website's News category. Deny discards
 * it. Each Monday admin@ gets a list of anything waiting more than 48 hours.
 *
 * Runs as admin@midlothianfriends.org: reads admin@'s mail, sends as the
 * mfm-news@ alias, and is deployed as a web app for the Approve/Deny pages
 * (Execute as: Me, Who has access: Anyone).
 *
 * Script properties (Project Settings → Script properties):
 *   WEBAPP_URL       the web app's /exec URL (Deploy → Manage deployments)
 *   WP_URL           https://midlothianfriends.org
 *   WP_USER          qtc-publisher            (WordPress user, Author role)
 *   WP_APP_PASSWORD  its application password
 *   GROUP            optional, default quaker-town-crier@midlothianfriends.org;
 *                    a test group while testing. Its managers and owners may submit.
 *   WEBSITE          optional: publish (default) | draft | off
 *   NEWS_CATEGORY    optional, default "news"
 *   SUBMIT, REPLY, FROM_NAME   optional overrides of the addresses and name below
 *   LINK_SECRET, SEEN_IDS, FAILED_IDS, R_<id>   kept by the script
 *
 * Run by hand from the editor:
 *   testSetup        checks every setting and prints what it found
 *   installTriggers  checks mail every 10 minutes; Monday list at 8 AM
 */

var VERSION = '2026-11-26';

var DEFAULTS = {
  GROUP: 'quaker-town-crier@midlothianfriends.org',
  SUBMIT: 'mfm-news@midlothianfriends.org',
  REPLY: 'mfm-news-reply@midlothianfriends.org',
  FROM_NAME: 'Midlothian Friends Meeting News',
  WEBSITE: 'publish',
  NEWS_CATEGORY: 'news'
};
var LOOK_BACK = 'newer_than:7d';   // how far back each check looks
var STALE_HOURS = 48;              // Monday list: waiting longer than this
var KEEP_DAYS = 90;                // decided records are forgotten after this
var KEEP_IDS = 500;
var TZ = 'America/New_York';
var LOGO = 'https://midlothianfriends.org/logo.png';

/* ------------------------------------------------------------ entry points */

/** Every 10 minutes: new messages to mfm-news@ get a review email. */
function checkMail() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var seen = loadList_('SEEN_IDS');
    var failed = loadList_('FAILED_IDS');
    var submit = prop_('SUBMIT');
    var ids = listMessages_('(to:' + submit + ' OR deliveredto:' + submit + ') ' + LOOK_BACK)
      .filter(function (id) { return seen.indexOf(id) < 0 && !props.getProperty('R_' + id); });
    if (!ids.length) return;

    var allowed = allowedSenders_();
    ids.reverse().forEach(function (id) {   // oldest first
      try {
        intake_(id, allowed);
        seen.push(id);
      } catch (e) {
        console.error('Message ' + id + ': ' + (e.stack || e));
        if (failed.indexOf(id) < 0) {      // tell admin@ once; retried every 10 minutes
          failed.push(id);
          notifyAdmin_('MFM News: a message could not be handled',
            'Gmail message ' + id + ' sent to ' + submit + ' could not be handled:\n\n' + e.message +
            '\n\nThe script keeps trying every 10 minutes. Details are in its Executions log.');
        }
      }
    });
    saveList_('SEEN_IDS', seen);
    saveList_('FAILED_IDS', failed.filter(function (id) { return seen.indexOf(id) < 0; }));
  } finally {
    lock.releaseLock();
  }
}

/** Mondays: list messages waiting more than 48 hours; forget old decided ones. */
function mondayDigest() {
  var now = Date.now();
  var props = PropertiesService.getScriptProperties();
  var stale = [];
  records_().forEach(function (r) {
    if (r.status === 'pending') {
      if (now - r.received > STALE_HOURS * 3600e3) stale.push(r);
    } else if (now - (r.decidedAt || r.received) > KEEP_DAYS * 86400e3) {
      props.deleteProperty('R_' + r.id);
    }
  });
  if (!stale.length) return;

  var admin = me_();
  var rows = stale.map(function (r) {
    return '<tr><td style="padding:10px 0;border-top:1px solid #cfd8e3">' +
      '<div style="font-weight:bold">' + esc_(r.subject) + '</div>' +
      '<div style="color:#5f6b78;font-size:14px">From ' + esc_(r.name || r.from) + ', ' + when_(r.received) + '</div>' +
      '<div style="margin-top:8px">' + button_(link_(r, 'approve', admin), 'Approve', '#1E7B34') + ' ' +
      button_(link_(r, 'deny', admin), 'Deny', '#111111') + '</div></td></tr>';
  }).join('');
  GmailApp.sendEmail(admin, 'MFM News: ' + stale.length + ' message' + (stale.length > 1 ? 's' : '') +
    ' waiting for approval', stale.map(function (r) { return r.subject; }).join('\n'), {
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:16px;color:#1f2933">' +
      '<p>These messages to ' + esc_(prop_('SUBMIT')) + ' have been waiting more than ' + STALE_HOURS +
      ' hours. You can approve or deny them here, or remind the sender.</p>' +
      '<table style="border-collapse:collapse;width:100%">' + rows + '</table></div>'
  });
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['checkMail', 'mondayDigest'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('mondayDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  console.log('checkMail every 10 minutes; mondayDigest Mondays around 8 AM.');
}

function testSetup() {
  console.log('MFM News ' + VERSION + ', running as ' + me_());
  console.log('Group: ' + prop_('GROUP') + '   Website: ' + prop_('WEBSITE'));
  console.log('May submit: ' + allowedSenders_().join(', '));
  var sendAs = (Gmail.Users.Settings.SendAs.list('me').sendAs || []).map(function (s) { return s.sendAsEmail.toLowerCase(); });
  console.log(prop_('SUBMIT') + (sendAs.indexOf(prop_('SUBMIT')) >= 0 ? ' is' : ' is NOT') + ' under Send mail as');
  console.log('Web app: ' + webUrl_());
  if (prop_('WEBSITE') !== 'off') {
    var cfg = wpConfig_();
    var u = wp_(cfg, 'get', '/wp/v2/users/me?context=edit');
    console.log('WordPress: ' + u.username + ' (' + (u.roles || []).join(', ') + '), News category id ' + categoryId_(cfg));
  }
  var waiting = records_().filter(function (r) { return r.status === 'pending'; });
  console.log('Waiting for approval: ' + waiting.length);
}

/* ---------------------------------------------------------------- intake */

function intake_(id, allowed) {
  var m = Gmail.Users.Messages.get('me', id, {
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'In-Reply-To', 'Auto-Submitted', 'Authentication-Results']
  });
  var h = headers_(m.payload);
  var from = address_(h['from'] || '');
  var subject = (h['subject'] || '').trim() || '(no subject)';
  var skip = function (why) { console.log('Skipped ' + id + ' from ' + from + ' (' + why + '): ' + subject); };

  if (h['in-reply-to'] || /^\s*(re|aw|sv)\s*:/i.test(subject)) return skip('a reply');
  if (h['auto-submitted'] && h['auto-submitted'].toLowerCase() !== 'no') return skip('automatic');
  if (allowed.indexOf(from) < 0) return skip('not a manager of ' + prop_('GROUP'));
  if (/dmarc=fail/i.test(h['authentication-results'] || '')) return skip('failed sender check');

  var rec = { id: id, from: from, name: name_(h['from'] || ''), subject: subject,
    received: Number(m.internalDate), status: 'pending' };
  saveRecord_(rec);
  sendReview_(rec);
  console.log('Review email sent to ' + from + ': ' + subject);
}

/** "Approval required for <subject>": buttons, notes, then the message itself. */
function sendReview_(rec) {
  var msg = load_(rec.id);
  var site = prop_('WEBSITE');
  var does = 'Approve sends it to ' + esc_(prop_('GROUP')) +
    (site === 'publish' ? ' and posts it on the website\'s News page.' :
      site === 'draft' ? ' and saves it as a draft on the website.' : '.');
  var top =
    '<div style="font-family:Arial,sans-serif;font-size:16px;color:#1f2933;background:#f5f5f7;' +
    'border-radius:14px;padding:16px 18px;margin-bottom:18px">' +
    '<div style="margin-bottom:14px">' + button_(link_(rec, 'approve', rec.from), 'Approve', '#1E7B34') +
    '&nbsp;&nbsp;' + button_(link_(rec, 'deny', rec.from), 'Deny', '#111111') + '</div>' +
    '<div>' + does + ' Deny discards it.</div>' +
    '<div style="margin-top:8px;color:#5f6b78;font-size:14px">If you sent a corrected version of this ' +
    'message, deny this one and approve only the corrected one. If an earlier version is already on the ' +
    'website, approve this one and let admin@midlothianfriends.org know.</div>' +
    '</div>' +
    '<div style="color:#5f6b78;font-size:13px;font-family:Arial,sans-serif;margin-bottom:10px">' +
    'Below is the message as subscribers will see it.</div>' +
    '<hr style="border:0;border-top:1px solid #cfd8e3;margin:0 0 18px">';
  GmailApp.sendEmail(rec.from, 'Approval required for ' + rec.subject,
    'Approve: ' + link_(rec, 'approve', rec.from) + '\nDeny: ' + link_(rec, 'deny', rec.from) + '\n\n' + plain_(msg.html), {
      name: 'MFM News',
      htmlBody: top + msg.html,
      inlineImages: msg.inline,
      attachments: msg.attachments
    });
}

/* -------------------------------------------------------------- decisions */

/** Called from the confirmation page. Returns {ok, message}. */
function decide(id, action, r, s) {
  if (['approve', 'deny'].indexOf(action) < 0 || !id || !r || s !== sign_(id, action, r)) {
    return { ok: false, message: 'This link is not valid.' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rec = loadRecord_(id);
    if (!rec) return { ok: false, message: 'This message is no longer waiting for approval.' };
    if (rec.status !== 'pending') return { ok: true, message: already_(rec) };

    rec.decidedBy = r.toLowerCase();
    rec.decidedAt = Date.now();
    if (action === 'deny') {
      rec.status = 'denied';
      saveRecord_(rec);
      return { ok: true, message: 'Denied. Nothing was sent or posted.' };
    }

    var msg = load_(id);
    GmailApp.sendEmail(prop_('GROUP'), rec.subject, plain_(msg.html), {
      from: prop_('SUBMIT'),
      name: prop_('FROM_NAME'),
      replyTo: prop_('REPLY') + ', ' + rec.from,
      htmlBody: msg.html,
      inlineImages: msg.inline,
      attachments: msg.attachments
    });
    rec.status = 'approved';
    saveRecord_(rec);

    var done = 'Approved and sent to ' + prop_('GROUP') + '.';
    var site = prop_('WEBSITE');
    if (site !== 'off') {
      try {
        var post = publish_(msg, rec, site);
        rec.postId = post.id;
        rec.postLink = post.link;
        done = site === 'draft' ? 'Approved, sent to ' + prop_('GROUP') + ' and saved as a website draft.'
          : 'Approved, sent to ' + prop_('GROUP') + ' and posted on the website.';
      } catch (e) {
        rec.websiteError = e.message;
        console.error('Website post for ' + id + ': ' + (e.stack || e));
        notifyAdmin_('MFM News: sent but not posted on the website',
          '"' + rec.subject + '" was approved and sent to the group, but posting it on the website failed:\n\n' +
          e.message + '\n\nAdd it to News by hand in wp-admin (the email itself went out normally).');
        done = 'Approved and sent to ' + prop_('GROUP') + '. Posting it on the website failed; admin@ has been told.';
      }
      saveRecord_(rec);
    }
    return { ok: true, message: done, link: rec.postId && site === 'publish' ? rec.postLink : '' };
  } finally {
    lock.releaseLock();
  }
}

function already_(rec) {
  var by = rec.decidedBy ? ' by ' + rec.decidedBy : '';
  return 'Already ' + rec.status + by + ' on ' + when_(rec.decidedAt) + '.';
}

/* ------------------------------------------------------------- web pages */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var view = { state: 'invalid', message: 'This link is not valid.' };
  if (['approve', 'deny'].indexOf(p.a) >= 0 && p.id && p.r && p.s === sign_(p.id, p.a, p.r)) {
    var rec = loadRecord_(p.id);
    if (!rec) {
      view.message = 'This message is no longer waiting for approval.';
    } else if (rec.status !== 'pending') {
      view = { state: 'done', message: already_(rec) };
    } else {
      view = {
        state: 'ask', action: p.a, id: p.id, r: p.r, s: p.s,
        subject: rec.subject, from: rec.name ? rec.name + ' <' + rec.from + '>' : rec.from,
        received: when_(rec.received),
        question: p.a === 'approve'
          ? 'Send this message to ' + prop_('GROUP') + (prop_('WEBSITE') === 'publish' ? ' and post it on the website?' : '?')
          : 'Discard this message? Nothing will be sent or posted.'
      };
    }
  }
  var t = HtmlService.createTemplateFromFile('Confirm');
  t.view = view;
  t.logo = LOGO;
  return t.evaluate().setTitle('Confirm News Email').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function link_(rec, action, to) {
  return webUrl_() + '?a=' + action + '&id=' + encodeURIComponent(rec.id) + '&r=' + encodeURIComponent(to) +
    '&s=' + sign_(rec.id, action, to);
}

function button_(href, label, color) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;padding:12px 30px;border-radius:12px;' +
    'background:' + color + ';color:#ffffff;font-weight:bold;font-size:17px;text-decoration:none">' + label + '</a>';
}

function sign_(id, action, to) {
  var p = PropertiesService.getScriptProperties();
  var key = p.getProperty('LINK_SECRET');
  if (!key) {
    key = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty('LINK_SECRET', key);
  }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    id + '|' + action + '|' + String(to).toLowerCase(), key)).replace(/=+$/, '');
}

/* ------------------------------------------------------------ the message */

/** The message's HTML with pictures as cid:img1…, plus its attachments. */
function load_(id) {
  var m = Gmail.Users.Messages.get('me', id, { format: 'full' });
  var parts = leaves_(m.payload);
  var html = clean_(bodyHtml_(id, parts));
  var inline = {};
  var attachments = [];
  var used = {};
  var n = 0;
  parts.forEach(function (p) {
    var cid = partHeader_(p, 'content-id').replace(/^<|>$/g, '');
    if (!cid || html.indexOf('cid:' + cid) < 0) return;
    var key = 'img' + (++n);
    html = html.split('cid:' + cid).join('cid:' + key);
    inline[key] = Utilities.newBlob(partBytes_(id, p), p.mimeType, p.filename || key);
    used[p.partId] = true;
  });
  parts.forEach(function (p) {
    if (p.filename && !used[p.partId]) attachments.push(Utilities.newBlob(partBytes_(id, p), p.mimeType, p.filename));
  });
  return { html: html, inline: inline, attachments: attachments };
}

function headers_(part) {
  var h = {};
  (part.headers || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value; });
  return h;
}

function partHeader_(part, name) {
  return headers_(part)[name] || '';
}

function address_(s) {
  var m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

function name_(s) {
  var m = s.match(/^\s*"?([^"<]*?)"?\s*</);
  return m ? m[1].trim() : '';
}

function leaves_(part) {
  if (part.parts && part.parts.length) {
    return part.parts.reduce(function (all, p) { return all.concat(leaves_(p)); }, []);
  }
  return [part];
}

function partBytes_(id, part) {
  var data = part.body && part.body.data;
  if (!data && part.body && part.body.attachmentId) {
    data = Gmail.Users.Messages.Attachments.get('me', id, part.body.attachmentId).data;
  }
  if (!data) return [];
  return typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
}

function bodyHtml_(id, parts) {
  var text = function (p) {
    var cs = (partHeader_(p, 'content-type').match(/charset="?([^";\s]+)/i) || [])[1] || 'UTF-8';
    return Utilities.newBlob(partBytes_(id, p)).getDataAsString(cs);
  };
  var html = parts.filter(function (p) { return p.mimeType === 'text/html' && !p.filename; })[0];
  if (html) return text(html);
  var plain = parts.filter(function (p) { return p.mimeType === 'text/plain' && !p.filename; })[0];
  if (!plain) return '';
  return text(plain).split(/\r?\n\s*\r?\n/).map(function (para) {
    var t = esc_(para.trim()).replace(/\r?\n/g, '<br>\n').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    return t ? '<p>' + t + '</p>' : '';
  }).join('\n');
}

/** The body only, without comments or scripts, with every tag closed. */
function clean_(html) {
  var body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) html = body[1];
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|script|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(html|meta|link)\b[^>]*>/gi, '');
  return balance_(html).trim();
}

function balance_(html) {
  var VOID = ['area', 'base', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr'];
  var stack = [];
  var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  var m;
  while ((m = re.exec(html))) {
    var tag = m[2].toLowerCase();
    if (VOID.indexOf(tag) >= 0 || m[3]) continue;
    if (!m[1]) {
      stack.push(tag);
    } else {
      var i = stack.lastIndexOf(tag);
      if (i >= 0) stack.length = i;
    }
  }
  return html + stack.reverse().map(function (t) { return '</' + t + '>'; }).join('');
}

function plain_(html) {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------- WordPress */

function publish_(msg, rec, mode) {
  var cfg = wpConfig_();
  var stamp = Utilities.formatDate(new Date(rec.received), TZ, 'yyyy-MM-dd');
  var html = msg.html;
  Object.keys(msg.inline).forEach(function (key) {
    var blob = msg.inline[key];
    html = html.split('cid:' + key).join(upload_(cfg, blob, 'news-' + stamp + '-' + blob.getName()));
  });
  if (msg.attachments.length) {
    html += '\n<h3>Attachments</h3>\n<ul>\n' + msg.attachments.map(function (b) {
      return '<li><a href="' + upload_(cfg, b, b.getName()) + '">' + esc_(b.getName()) + '</a></li>';
    }).join('\n') + '\n</ul>';
  }
  return wp_(cfg, 'post', '/wp/v2/posts', {
    title: rec.subject,
    content: html,
    status: mode === 'draft' ? 'draft' : 'publish',
    categories: [categoryId_(cfg)]
  });
}

function wpConfig_() {
  var url = (prop_('WP_URL')).replace(/\/+$/, '');
  var user = prop_('WP_USER');
  var pass = prop_('WP_APP_PASSWORD');
  if (!url || !user || !pass) throw new Error('Set WP_URL, WP_USER and WP_APP_PASSWORD in Script properties.');
  return { url: url, auth: 'Basic ' + Utilities.base64Encode(user + ':' + pass) };
}

function wp_(cfg, method, path, payload, contentType, headers) {
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: Object.assign({ Authorization: cfg.auth }, headers || {})
  };
  if (payload !== undefined) {
    opts.contentType = contentType || 'application/json';
    opts.payload = contentType ? payload : JSON.stringify(payload);
  }
  var r = UrlFetchApp.fetch(cfg.url + '/wp-json' + path, opts);
  if (r.getResponseCode() >= 300) {
    throw new Error('WordPress ' + method.toUpperCase() + ' ' + path + ' → ' + r.getResponseCode() + ': ' +
      r.getContentText().slice(0, 300));
  }
  return JSON.parse(r.getContentText());
}

var categoryCache_ = null;
function categoryId_(cfg) {
  if (categoryCache_ === null) {
    var r = wp_(cfg, 'get', '/wp/v2/categories?slug=' + encodeURIComponent(prop_('NEWS_CATEGORY')));
    if (!r.length) throw new Error('No category with slug "' + prop_('NEWS_CATEGORY') + '" on ' + cfg.url);
    categoryCache_ = r[0].id;
  }
  return categoryCache_;
}

function upload_(cfg, blob, filename) {
  var name = String(filename).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-');
  var media = wp_(cfg, 'post', '/wp/v2/media', blob.getBytes(), blob.getContentType() || 'application/octet-stream',
    { 'Content-Disposition': 'attachment; filename="' + name + '"' });
  return media.source_url;
}

/* ------------------------------------------------------------ bookkeeping */

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || DEFAULTS[name] || '';
}

function me_() {
  return Session.getEffectiveUser().getEmail().toLowerCase();
}

function webUrl_() {
  var url = prop_('WEBAPP_URL') || ScriptApp.getService().getUrl();
  if (!url) throw new Error('Deploy the script as a web app and put its /exec URL in the WEBAPP_URL property.');
  return url;
}

/** The group's managers and owners; admin@'s aliases count when admin@ is one. */
function allowedSenders_() {
  var out = [];
  var token;
  do {
    var r = AdminDirectory.Members.list(prop_('GROUP'), { roles: 'OWNER,MANAGER', pageToken: token });
    (r.members || []).forEach(function (m) { if (m.email) out.push(m.email.toLowerCase()); });
    token = r.nextPageToken;
  } while (token);
  if (out.indexOf(me_()) >= 0) {
    (Gmail.Users.Settings.SendAs.list('me').sendAs || []).forEach(function (s) { out.push(s.sendAsEmail.toLowerCase()); });
  }
  var never = [prop_('SUBMIT').toLowerCase(), prop_('REPLY').toLowerCase()];
  return out.filter(function (a, i) { return never.indexOf(a) < 0 && out.indexOf(a) === i; });
}

function listMessages_(q) {
  var ids = [];
  var token;
  do {
    var r = Gmail.Users.Messages.list('me', { q: q, maxResults: 100, pageToken: token });
    (r.messages || []).forEach(function (m) { ids.push(m.id); });
    token = r.nextPageToken;
  } while (token);
  return ids;
}

function saveRecord_(rec) {
  PropertiesService.getScriptProperties().setProperty('R_' + rec.id, JSON.stringify(rec));
}

function loadRecord_(id) {
  var v = PropertiesService.getScriptProperties().getProperty('R_' + id);
  return v ? JSON.parse(v) : null;
}

function records_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function (k) { return k.indexOf('R_') === 0; })
    .map(function (k) { return JSON.parse(all[k]); });
}

function loadList_(key) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '[]');
  } catch (e) {
    return [];
  }
}

function saveList_(key, ids) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(ids.slice(-KEEP_IDS)));
}

function when_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, "EEE, MMM d 'at' h:mm a");
}

function notifyAdmin_(subject, body) {
  GmailApp.sendEmail(me_(), subject, body);
}
