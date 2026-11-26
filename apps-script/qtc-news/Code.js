/**
 * QTC → News: publishes each Quaker Town Crier issue on the website.
 *
 * Every hour it looks in admin@'s Gmail for issues sent to the
 * quaker-town-crier@ Google Group by an allowed sender, and publishes each
 * one as a post in the website's News category through the WordPress REST
 * API. Pasted pictures and attached files are uploaded to the Media Library.
 * A re-sent issue with the same date (a correction) updates the existing post.
 *
 * Runs in admin@midlothianfriends.org's Apps Script (it reads admin@'s mail).
 * Needs the Gmail advanced service (enabled in appsscript.json).
 *
 * Script properties (Project Settings → Script properties):
 *   WP_URL           https://midlothianfriends.org
 *   WP_USER          qtc-publisher           (a WordPress user with the Author role)
 *   WP_APP_PASSWORD  its application password (Users → qtc-publisher → Application Passwords)
 *   NEWS_CATEGORY    optional, the News category's slug (default "news")
 *   DRY_RUN          optional, "true" to log what would be published without posting
 *   DONE_IDS, FAILED_IDS   kept by the script: Gmail messages already handled
 *
 * Functions to run by hand from the editor:
 *   testConnection   checks the WordPress user, password and News category
 *   dryRunAll        shows what every issue in the mailbox would become; posts nothing
 *   backfill         publishes every issue in the mailbox not yet handled
 *   installTrigger   runs checkForIssues every hour from now on
 */

var VERSION = '2026-11-26';

var LIST_ID = 'quaker-town-crier.midlothianfriends.org';
var GROUP = 'quaker-town-crier@midlothianfriends.org';
var SENDERS = ['clerk@midlothianfriends.org', 'admin@midlothianfriends.org', 'records@midlothianfriends.org'];
var TITLE_PREFIX = 'Quaker Town Crier - ';
var LABEL_NAME = 'QTC Published';
var RECENT = 'newer_than:14d';   // how far back the hourly check looks
var KEEP_IDS = 500;              // handled message IDs remembered

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------ entry points */

/** The hourly job: issues from the last two weeks not yet handled. */
function checkForIssues() {
  run_(RECENT, false);
}

/** Every issue in the mailbox not yet handled (first run). */
function backfill() {
  run_('', false);
}

/** Like backfill, but only logs what it would do. */
function dryRunAll() {
  run_('', true);
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'checkForIssues'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkForIssues').timeBased().everyHours(1).create();
  console.log('checkForIssues will run every hour.');
}

function testConnection() {
  var cfg = config_();
  var me = wp_(cfg, 'get', '/wp/v2/users/me?context=edit');
  console.log('Signed in to ' + cfg.url + ' as ' + me.username + ' (' + (me.roles || []).join(', ') + ')');
  console.log('News category "' + cfg.category + '" has id ' + categoryId_(cfg));
  console.log('Issues in the mailbox: ' + search_('').length);
}

/* ------------------------------------------------------------- main loop */

function run_(extra, forceDry) {
  var cfg = config_();
  if (forceDry) cfg.dryRun = true;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;   // a previous run is still going
  try {
    var done = loadIds_('DONE_IDS');
    var failed = loadIds_('FAILED_IDS');
    var ids = search_(extra).filter(function (id) { return done.indexOf(id) < 0; });
    ids.reverse();                   // oldest first, so posts are made in order
    var problems = [];

    ids.forEach(function (id) {
      try {
        var result = processMessage_(id, cfg);
        if (!cfg.dryRun) {
          done.push(id);
          if (result === 'published') label_(id);
        }
      } catch (e) {
        console.error('Message ' + id + ': ' + (e.stack || e));
        if (failed.indexOf(id) < 0) {  // report each failure once; it is retried every hour
          failed.push(id);
          problems.push('Message ' + id + ': ' + e.message);
        }
      }
    });

    if (!cfg.dryRun) {
      saveIds_('DONE_IDS', done);
      saveIds_('FAILED_IDS', failed.filter(function (id) { return done.indexOf(id) < 0; }));
    }
    if (problems.length) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'QTC → News: an issue was not published',
        'The QTC → News script could not publish:\n\n' + problems.join('\n') +
        '\n\nIt will keep trying every hour. Details are in the script\'s Executions log.');
    }
  } finally {
    lock.releaseLock();
  }
}

/** Gmail message IDs of candidate issues, newest first. */
function search_(extra) {
  var q = '(list:' + LIST_ID + ' OR (in:sent to:' + GROUP + ')) from:(' + SENDERS.join(' OR ') + ')' +
    (extra ? ' ' + extra : '');
  var ids = [];
  var token;
  do {
    var r = Gmail.Users.Messages.list('me', { q: q, maxResults: 100, pageToken: token });
    (r.messages || []).forEach(function (m) { ids.push(m.id); });
    token = r.nextPageToken;
  } while (token);
  return ids;
}

/** Publishes one message. Returns 'published', 'updated', 'skipped' or 'dry-run'. */
function processMessage_(id, cfg) {
  var msg = Gmail.Users.Messages.get('me', id, { format: 'full' });
  var h = headers_(msg.payload);
  var from = address_(h['from'] || '');
  var listed = (h['list-id'] || '').indexOf(LIST_ID) >= 0 ||
    ((h['to'] || '') + ' ' + (h['cc'] || '')).toLowerCase().indexOf(GROUP) >= 0;
  if (SENDERS.indexOf(from) < 0 || !listed) {
    console.log('Skipped ' + id + ' (from ' + from + ', ' + (h['subject'] || '') + ')');
    return 'skipped';
  }

  var sent = new Date(Number(msg.internalDate));
  var title = title_(h['subject'] || '', sent);
  var stamp = Utilities.formatDate(sent, 'America/New_York', 'yyyy-MM-dd');
  var parts = leaves_(msg.payload);
  var html = clean_(bodyHtml_(id, parts));

  var catId = categoryId_(cfg);
  var existing = findPost_(cfg, title, catId);

  // Pictures pasted into the email (cid:) and Google-hosted pictures.
  var used = {};
  var images = 0;
  parts.forEach(function (p) {
    var cid = (partHeader_(p, 'content-id') || '').replace(/^<|>$/g, '');
    if (!cid || html.indexOf('cid:' + cid) < 0) return;
    used[p.partId] = true;
    images++;
    if (cfg.dryRun) return;
    var url = upload_(cfg, partBytes_(id, p), 'qtc-' + stamp + '-' + (p.filename || 'image'), p.mimeType);
    html = html.split('cid:' + cid).join(url);
  });
  html = html.replace(/src="(https:\/\/[^"]*\.googleusercontent\.com\/[^"]*)"/g, function (all, src) {
    images++;
    if (cfg.dryRun) return all;
    try {
      var r = UrlFetchApp.fetch(src.replace(/&amp;/g, '&'), { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return all;
      var type = r.getBlob().getContentType() || 'image/jpeg';
      var name = 'qtc-' + stamp + '-image-' + images + '.' + (type.split('/')[1] || 'jpg');
      return 'src="' + upload_(cfg, r.getContent(), name, type) + '"';
    } catch (e) {
      console.warn('Could not copy ' + src + ': ' + e.message);
      return all;
    }
  });

  // Attached files: uploaded and listed at the end.
  var files = parts.filter(function (p) { return p.filename && !used[p.partId]; });
  if (files.length) {
    var items = files.map(function (p) {
      var url = cfg.dryRun ? '#' : upload_(cfg, partBytes_(id, p), p.filename, p.mimeType);
      return '<li><a href="' + url + '">' + escape_(p.filename) + '</a></li>';
    });
    html += '\n<h3>Attachments</h3>\n<ul>\n' + items.join('\n') + '\n</ul>';
  }

  if (cfg.dryRun) {
    console.log([
      'DRY RUN: ' + title,
      '  sent ' + sent + ' by ' + from,
      '  ' + (existing ? 'would update post ' + existing.id : 'would create a new post'),
      '  pictures: ' + images + ', attachments: ' + files.map(function (p) { return p.filename; }).join(', '),
      '  content (' + html.length + ' characters) begins:',
      html.slice(0, 1500)
    ].join('\n'));
    return 'dry-run';
  }

  if (existing) {
    wp_(cfg, 'post', '/wp/v2/posts/' + existing.id, { title: title, content: html });
    console.log('Updated post ' + existing.id + ': ' + title);
    return 'published';
  }
  var post = wp_(cfg, 'post', '/wp/v2/posts', {
    title: title,
    content: html,
    status: 'publish',
    categories: [catId],
    date_gmt: sent.toISOString().slice(0, 19)
  });
  console.log('Created post ' + post.id + ': ' + title + ' ' + post.link);
  return 'published';
}

/* ---------------------------------------------------------------- titles */

/** "QTC updates for November 13, 2026" → "Quaker Town Crier - November 13, 2026". */
function title_(subject, sent) {
  var s = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
  var d = dateIn_(s, sent);
  return d ? TITLE_PREFIX + MONTHS[d.m - 1] + ' ' + d.d + ', ' + d.y : (s || 'Quaker Town Crier');
}

function dateIn_(s, sent) {
  var mon = '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  var m;
  var make = function (y, mo, d) {
    return (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) ? { y: y, m: mo, d: d } : null;
  };
  var month = function (name) {
    return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(name.slice(0, 3).toLowerCase()) + 1;
  };
  // November 13, 2026 / Nov. 13th 2026 / November 13
  if ((m = s.match(new RegExp(mon + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+((?:19|20)\\d\\d))?', 'i')))) {
    return make(m[3] ? +m[3] : sent.getFullYear(), month(m[1]), +m[2]);
  }
  // 13 November 2026
  if ((m = s.match(new RegExp('\\b(\\d{1,2})\\s+' + mon + '\\s+((?:19|20)\\d\\d)', 'i')))) {
    return make(+m[3], month(m[2]), +m[1]);
  }
  // 11/13/2026
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d\d)\b/))) {
    return make(+m[3], +m[1], +m[2]);
  }
  // 2026-11-13
  if ((m = s.match(/\b((?:19|20)\d\d)-(\d{1,2})-(\d{1,2})\b/))) {
    return make(+m[1], +m[2], +m[3]);
  }
  return null;
}

/* ------------------------------------------------------------- the email */

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

/** All leaf parts of a MIME tree. */
function leaves_(part) {
  if (part.parts && part.parts.length) {
    return part.parts.reduce(function (all, p) { return all.concat(leaves_(p)); }, []);
  }
  return [part];
}

/** A part's bytes (inline data or a separate attachment). */
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
    var t = escape_(para.trim()).replace(/\r?\n/g, '<br>\n')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    return t ? '<p>' + t + '</p>' : '';
  }).join('\n');
}

/** Keeps the body, drops the Google Groups footer, closes any open tags. */
function clean_(html) {
  var body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) html = body[1];
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(html|meta|link)\b[^>]*>/gi, '');

  var at = html.search(/You received this message because you are subscribed to the Google Groups/i);
  if (at >= 0) {
    var dash = html.lastIndexOf('--', at);
    html = html.slice(0, (dash >= 0 && at - dash < 300) ? dash : at);
  }
  html = balance_(html);
  // trailing empty lines and paragraphs
  var prev;
  do {
    prev = html;
    html = html.replace(/(\s|<br\s*\/?>|<p>\s*<\/p>|<div>\s*(<br\s*\/?>)?\s*<\/div>)+$/i, '');
  } while (html !== prev);
  return html.trim();
}

/** Closes tags left open (for example by cutting off the footer). */
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

function escape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------- WordPress */

function config_() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty('WP_URL') || '').replace(/\/+$/, '');
  var user = p.getProperty('WP_USER');
  var pass = p.getProperty('WP_APP_PASSWORD');
  if (!url || !user || !pass) {
    throw new Error('Set WP_URL, WP_USER and WP_APP_PASSWORD in Project Settings → Script properties.');
  }
  return {
    url: url,
    auth: 'Basic ' + Utilities.base64Encode(user + ':' + pass),
    category: p.getProperty('NEWS_CATEGORY') || 'news',
    dryRun: /^(1|true|yes)$/i.test(p.getProperty('DRY_RUN') || '')
  };
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
  var code = r.getResponseCode();
  if (code >= 300) {
    throw new Error('WordPress ' + method.toUpperCase() + ' ' + path + ' → ' + code + ': ' +
      r.getContentText().slice(0, 300));
  }
  return JSON.parse(r.getContentText());
}

var categoryCache_ = null;
function categoryId_(cfg) {
  if (categoryCache_ === null) {
    var r = wp_(cfg, 'get', '/wp/v2/categories?slug=' + encodeURIComponent(cfg.category));
    if (!r.length) throw new Error('No category with slug "' + cfg.category + '" on ' + cfg.url);
    categoryCache_ = r[0].id;
  }
  return categoryCache_;
}

/** The News post with this title, if there is one. */
function findPost_(cfg, title, catId) {
  var words = title.indexOf(TITLE_PREFIX) === 0 ? title.slice(TITLE_PREFIX.length) : title;
  var r = wp_(cfg, 'get', '/wp/v2/posts?categories=' + catId + '&per_page=20&search=' +
    encodeURIComponent(words));
  var want = norm_(title);
  return r.filter(function (p) { return norm_(p.title.rendered) === want; })[0] || null;
}

/** Titles as WordPress shows them ("&#8211;" for " - " and so on) → plain, for comparing. */
function norm_(s) {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;|[–—]/g, '-')
    .replace(/&#8216;|&#8217;|&rsquo;|&lsquo;|[‘’]/g, "'")
    .replace(/&#038;|&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Uploads a file to the Media Library; returns its URL. */
function upload_(cfg, bytes, filename, mime) {
  var name = String(filename).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-');
  var media = wp_(cfg, 'post', '/wp/v2/media', bytes, mime || 'application/octet-stream',
    { 'Content-Disposition': 'attachment; filename="' + name + '"' });
  return media.source_url;
}

/* ----------------------------------------------------------- bookkeeping */

function loadIds_(key) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '[]');
  } catch (e) {
    return [];
  }
}

function saveIds_(key, ids) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(ids.slice(-KEEP_IDS)));
}

function label_(id) {
  var labels = Gmail.Users.Labels.list('me').labels || [];
  var label = labels.filter(function (l) { return l.name === LABEL_NAME; })[0] ||
    Gmail.Users.Labels.create({ name: LABEL_NAME }, 'me');
  Gmail.Users.Messages.modify({ addLabelIds: [label.id] }, 'me', id);
}
