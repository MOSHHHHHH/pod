/**
 * podcast_processor_v2.js
 * ========================
 * כל לוגיקת המערכת — נטען דרך eval() מתוך podcast_v2.gs.
 * אין להריץ קובץ זה ישירות.
 *
 * ארכיטקטורה: סריקה-ואז-הורדה (scan-then-download).
 * תור הורדות נשמר ב-status_queue.json בתיקיית קבצי המערכת בין ריצות.
 */

// =====================================================================
// קבועים גלובליים
// =====================================================================

var TIME_LIMIT_MS    = 5.5 * 60 * 1000;     // עצירה ב-5.5 דקות (מגבלת GAS: 6)
var ITUNES_NS_URL    = "http://www.itunes.com/dtds/podcast-1.0.dtd";
var MAX_DIRECT_BYTES = 45 * 1024 * 1024;    // 45MB — מתחת למגבלת UrlFetchApp
var CHUNK_SIZE_BYTES = 15 * 1024 * 1024;    // 15MB לכל chunk (60 × 256KB)
var MAX_RETRIES          = 3;
var STATUS_FILE_NAME     = "status_queue.json";
var HISTORY_FILE_NAME    = "download_history.json";
var EMAILS_FILE_NAME     = "emails.json";
var RSS_FILE_NAME        = "podcasts.txt";
var STORAGE_MIN_BYTES    = 2 * 1024 * 1024 * 1024;  // 2GB מינימום פנוי
var STORAGE_EMAIL_DAYS   = 2;
var CATALOG_PER_EMAIL    = 50;                        // פרקים מקסימום לאימייל קטלוג
var CTRL_SUBSCRIBE       = "subscribe.wrinkly124@simplelogin.com";
var CTRL_UNSUBSCRIBE     = "unsubscribe.supper574@simplelogin.com";
var CTRL_GET_EPISODE     = "get-episode.cahoots527@simplelogin.com";
var APPLE_API_MAX_RETRY  = 4;      // נסיונות מקסימום לחיפוש iTunes לפני מייל שגיאה
var PRIVACY_NOTE         = "שים לב: מיילים הנשלחים לכתובות אלו נאספים ומעובדים אוטומטית בהתאם למדיניות השירות.";
var DOWNLOAD_BUFFER_MS   = 40 * 1000;                // buffer לעצירת הורדות לפני תום הזמן
var EMAIL_TIME_BUFFER_MS = 90 * 1000;                // זמן שמור לבניית ושליחת מיילים


// =====================================================================
// משתנים גלובליים (חולקים מידע בתוך ריצה אחת)
// =====================================================================
var _downloadHistory = [];
var _emailsData      = null;
var _rssList         = [];
var _sysFolder       = null;  // reference לשימוש בפונקציות עזר


// =====================================================================
// נקודת כניסה ראשית — נקראת מ-podcast_v2.gs
// מחזירה true אם נותרו הורדות בתור לריצה הבאה, אחרת false.
// =====================================================================
function main(sysFolder, mainFolder) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('⏸️ ריצה אחרת פעילה; ממשיכים בשעה הבאה.'); return true; }
  try { return runPodcastMain(sysFolder, mainFolder); }
  finally { lock.releaseLock(); }
}

function runPodcastMain(sysFolder, mainFolder) {
  var startTime = new Date();
  Logger.log("🚀 פודקאסטים v2 — " + formatDate(startTime));

  // ── 1. מיזוג קבצי RSS (אם יש כפולים) + אתחול ──
  mergePodcastsFiles(sysFolder);
  _sysFolder       = sysFolder;
  _downloadHistory = purgeExpiredHistory(loadDownloadHistory(sysFolder));
  _emailsData      = loadEmailsData(sysFolder);
  initEmailsStructure(_emailsData);
  ensureRssFileExists(sysFolder, _emailsData);

  // ── 2. טעינת תור ועיבוד מיילי בקרה ──
  var queue = loadStatusQueue(sysFolder);
  Logger.log("📦 " + queue.length + " פריטים בתור.");
  var seenUrls = {};
  for (var q = 0; q < queue.length; q++) seenUrls[queue[q].url] = true;

  var rssList = loadRssList(sysFolder);
  _rssList = rssList;
  var processedEmails = checkSentMailbox(sysFolder, mainFolder, queue, rssList, startTime);
  // reload rssList — unsubscribe/subscribe may have changed it
  rssList = loadRssList(sysFolder);

  _rssList = rssList;
  reconcileAutomaticQueue(queue, rssList, _emailsData);
  repairSavedFeedUrls(queue, _emailsData, rssList);
  seenUrls = {};
  for (var qi = 0; qi < queue.length; qi++) seenUrls[queue[qi].url] = true;

  // ── 3. בדיקה: רשימת ערוצים ריקה ──
  if (rssList.length === 0) {
    if (!_emailsData.emptySubsEmailSent) {
      sendEmptySubscriptionsEmail(_emailsData);
      _emailsData.emptySubsEmailSent = true;
    }
    if (queue.length) saveStatusQueue(sysFolder, queue);
    else deleteStatusQueue(sysFolder);
    saveEmailsData(sysFolder, _emailsData);
    saveDownloadHistory(sysFolder, _downloadHistory);
    Logger.log("⚠️  רשימת ערוצים ריקה.");

  }
  if (rssList.length) _emailsData.emptySubsEmailSent = false;

  // ── 4. סריקת פידים ──
  var folderCache = {};
  Logger.log("📋 נטענו " + rssList.length + " כתובות RSS.");
  for (var f = 0; f < rssList.length; f++) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן בסריקה."); break;
    }
    try {
      scanFeed(rssList[f].url, rssList[f].days, mainFolder, queue, seenUrls, folderCache, rssList[f].notifyOnly);
    } catch(e) {
      Logger.log("❌ סריקה " + rssList[f].url + ": " + e.message);
    }
  }
  Logger.log("📊 " + queue.length + " פרקים בתור.");

  reconcileAutomaticQueue(queue, rssList, _emailsData);

  // ── 5. הורדה ──
  var downloaded = 0, idx = 0;
  while (idx < queue.length) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן — עוצר הורדות."); break;
    }
    var item         = queue[idx];
    if (item.source !== 'manual' && !item.rssUrl && hasNotifyOnlySubscriptions(rssList)) {
      Logger.log('⏸️ פריט ישן ללא זיהוי ערוץ ודאי ממתין לסריקה: '+item.episodeTitle); idx++; continue;
    }
    var targetFolder = getOrCreateFolder(mainFolder, item.folderName);
    if (fileExistsInFolder(targetFolder, item.fileName)) {
      Logger.log("🔁 קיים: " + item.fileName); queue.splice(idx, 1); continue;
    }
    var freeBytes = getFreeStorageBytes();
    if (freeBytes < STORAGE_MIN_BYTES) {
      Logger.log("💾 נפח נמוך — דוחה: " + item.episodeTitle);
      addToStoragePending(_emailsData, item); idx++; continue;
    }
    Logger.log("⬇️  " + item.episodeTitle + (item.chunkState ? " (ממשיך)" : ""));
    var result;
    if (item.chunkState) {
      result = downloadChunked(item.url, item.fileName, item.mimeType, targetFolder,
                               item.chunkState.contentLength, startTime, item.chunkState);
    } else {
      result = downloadAndSaveAudio(item.url, item.fileName, item.mimeType, targetFolder, startTime);
    }
    if (result.success) {
      downloaded++;
      item.chunkState = null;
      item.fileId  = result.fileId || null;
      item.fileUrl = item.fileId ? "https://drive.google.com/file/d/" + item.fileId + "/view" : null;
      Logger.log("✅ " + item.fileName + (item.fileId ? " 🔗" : ""));
      createLrcFile(targetFolder, item.fileName.substring(0, item.fileName.lastIndexOf(".")), item);
      addToHistory(_downloadHistory, item);
      addToWeeklyPending(_emailsData, item, "success", null);
      queue.splice(idx, 1);
    } else if (result.paused) {
      Logger.log("⏸️  הושהה: " + item.episodeTitle);
      item.chunkState = result.chunkState; idx++;
    } else {
      item.chunkState = null;
      item.retryCount = (item.retryCount || 0) + 1;
      Logger.log("❌ ניסיון " + item.retryCount + "/" + MAX_RETRIES + ": " + result.error);
      if (item.retryCount >= MAX_RETRIES) {
        addToWeeklyPending(_emailsData, item, "failed", result.error);
        sendFailureEmail(item, result.error);
        queue.splice(idx, 1);
      } else { idx++; }
    }
  }
  Logger.log("📥 הורדו בריצה זו: " + downloaded);

  // ── 6. שמירת מצב ──
  submitUserDataToForm();
  saveDownloadHistory(sysFolder, _downloadHistory);
  saveEmailsData(sysFolder, _emailsData);
  if (queue.length === 0) deleteStatusQueue(sysFolder);
  else { saveStatusQueue(sysFolder, queue); Logger.log("💾 " + queue.length + " פרקים בתור."); }

  // ── 7. שליחת מיילים ──
  var needStorage = shouldSendStorageEmail(_emailsData);
  var needWeekly  = shouldSendWeeklyEmail(_emailsData);
  var needSubs    = checkSubscriptionChanges(rssList, _emailsData);
  if ((needStorage || needWeekly || needSubs) && hasEnoughTimeForEmails(startTime)) {
    if (needStorage) { needStorage = !sendStorageEmail(sysFolder, _emailsData, mainFolder); }
    if (needWeekly)  { needWeekly = !sendWeeklyEmail(sysFolder, _emailsData, rssList, mainFolder); }
    if (needSubs)    { needSubs = !sendSubscriptionEmail(rssList, sysFolder, _emailsData, startTime, mainFolder); }
    saveEmailsData(sysFolder, _emailsData);
  } else if (needStorage || needWeekly || needSubs) {
    Logger.log("⏰ אין מספיק זמן לשליחת מיילים — יטופלו בריצה הבאה.");
  }

  // ── 8. סיכום פרקים שהתקבלו בבקשה ספציפית ──
  // הוסף לרשימה המצטברת ב-emails.json
  if (_emailsData.pendingEpisodeSummary.length > 0 && hasEnoughTimeForEmails(startTime)) {
    if (sendProcessedEmailsSummary(_emailsData.pendingEpisodeSummary)) _emailsData.pendingEpisodeSummary = [];
    saveEmailsData(sysFolder, _emailsData);
  } else if (_emailsData.pendingEpisodeSummary.length > 0) {
    Logger.log("⏰ סיכום פרקים ידחה לריצה הבאה (" + _emailsData.pendingEpisodeSummary.length + " פרקים).");
    saveEmailsData(sysFolder, _emailsData);
  }

  return queue.length > 0 || needStorage || needWeekly || needSubs;
}


// =====================================================================
// סריקת פיד בודד — מוסיף פרקים חדשים לתור (queue מתעדכן by reference)
// =====================================================================
function scanFeed(rssUrl, days, mainFolder, queue, seenUrls, folderCache, notifyOnly) {
  Logger.log("\n──────────────────────────────────────");
  Logger.log("🔍 סורק: " + rssUrl);

  var response = UrlFetchApp.fetch(rssUrl, { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() !== 200) {
    throw new Error("קוד תגובה " + response.getResponseCode());
  }

  var xmlText = response.getContentText("UTF-8");
  var doc     = XmlService.parse(xmlText);
  var channel = doc.getRootElement().getChild("channel");
  if (!channel) throw new Error("לא נמצא אלמנט <channel>");

  var itunesNs      = XmlService.getNamespace(ITUNES_NS_URL);
  var channelTitle  = channel.getChildText("title") || "פודקאסט_ללא_שם";
  var channelAuthor = channel.getChildText("author", itunesNs) || channel.getChildText("author") || "";
  var folderName    = sanitizeFolderName(channelTitle);
  var cutoffDate    = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  var channelImageUrl = getChannelCoverArtUrl(channel, itunesNs);

  Logger.log("🎙️  ערוץ: " + channelTitle + " (מ-" + days + " הימים האחרונים)");
  // עדכון details לשימוש במיילים (שמות ערוצים לא פעילים)
  if (_emailsData && _emailsData.subscriptions) {
    if (!_emailsData.subscriptions.details) _emailsData.subscriptions.details = {};
    _emailsData.subscriptions.details[rssUrl] = {
      title: channelTitle, image: channelImageUrl || null
    };
  }

  var items   = channel.getChildren("item");
  var newOnes = 0;

  for (var j = 0; j < items.length; j++) {
    var item = items[j];

    var pubDateStr = item.getChildText("pubDate") || "";
    var pubDate    = pubDateStr ? new Date(pubDateStr) : null;
    if (pubDate && !isNaN(pubDate) && pubDate < cutoffDate) break;  // RSS חדש→ישן

    var title         = item.getChildText("title") || ("פרק_" + (j + 1));
    var enclosureInfo = getEnclosureInfo(item);
    if (!enclosureInfo) continue;

    for (var queued = 0; queued < queue.length; queued++) {
      if (queue[queued].url === enclosureInfo.url && !queue[queued].rssUrl) queue[queued].rssUrl = rssUrl;
    }
    if (notifyOnly) {
      var notificationGuid = item.getChildText("guid") || enclosureInfo.url;
      var notificationKey = JSON.stringify([rssUrl, notificationGuid]);
      if (!_emailsData.notificationSeen[notificationKey]) {
        addToWeeklyPending(_emailsData, {
          rssUrl: rssUrl, url: enclosureInfo.url, guid: notificationGuid,
          channelTitle: channelTitle, channelImageUrl: channelImageUrl,
          episodeTitle: title, pubDate: pubDateStr,
          duration: item.getChildText("duration", itunesNs) || ""
        }, "notification", null);
        // Persisted separately from download_history; survives successful digest sends.
        _emailsData.notificationSeen[notificationKey] = true;
        newOnes++;
      }
      continue;
    }

    if (seenUrls[enclosureInfo.url]) continue;  // כבר בתור (מריצה קודמת/פיד אחר)

    // בדיקת היסטוריית הורדות — לא מוריד פרק שכבר הורד בעבר
    if (isInHistory(_downloadHistory, enclosureInfo.url)) continue;

    var episodeNum = item.getChildText("episode", itunesNs) || "";
    var fileExt    = getFileExtension(enclosureInfo.url, enclosureInfo.type);
    var fileName   = buildFileName(title, episodeNum, fileExt);

    // בדיקת תיקייה קיימת — בלי ליצור אותה אם היא לא קיימת (טרם נמצא פרק חדש)
    var existingFolderIt = mainFolder.getFoldersByName(folderName);
    if (existingFolderIt.hasNext()) {
      if (fileExistsInFolder(existingFolderIt.next(), fileName)) continue;  // כבר הורד
    }

    // ── פרק חדש אמיתי — מוסיפים לתור ──
    seenUrls[enclosureInfo.url] = true;
    newOnes++;

    // יצירת תיקייה + תמונת כריכה רק כעת (פרק חדש ראשון לערוץ זה בריצה זו)
    if (!folderCache[channelTitle]) {
      var folder = getOrCreateFolder(mainFolder, folderName);
      savePodcastCoverArt(channel, folder, itunesNs);
      folderCache[channelTitle] = true;
    }

    queue.push({
      rssUrl          : rssUrl,
      source          : "automatic",
      url             : enclosureInfo.url,
      mimeType        : enclosureInfo.type || "audio/mpeg",
      fileName        : fileName,
      folderName      : folderName,
      channelTitle    : channelTitle,
      channelImageUrl : channelImageUrl,
      feedDays        : days,
      episodeTitle    : title,
      pubDate         : pubDateStr,
      author          : item.getChildText("author", itunesNs) || item.getChildText("author") || channelAuthor,
      duration        : item.getChildText("duration", itunesNs) || "",
      episodeNumber   : episodeNum,
      season          : item.getChildText("season", itunesNs) || "",
      subtitle        : item.getChildText("subtitle", itunesNs) || "",
      guid            : item.getChildText("guid") || enclosureInfo.url,
      description     : item.getChildText("description") || "",
      retryCount      : 0,
      chunkState      : null
    });
  }

  Logger.log("📋 " + newOnes + " פרקים חדשים נוספו לתור מערוץ זה.");
}


// =====================================================================
// ניהול קובץ התור (status_queue.json)
// =====================================================================

function loadStatusQueue(sysFolder) {
  var it = sysFolder.getFilesByName(STATUS_FILE_NAME);
  if (!it.hasNext()) return [];
  try {
    var content = it.next().getBlob().getDataAsString("UTF-8");
    var parsed  = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    Logger.log("⚠️  קובץ תור פגום, מתעלם: " + e.message);
    return [];
  }
}

function saveStatusQueue(sysFolder, queue) {
  deleteStatusQueue(sysFolder);
  sysFolder.createFile(STATUS_FILE_NAME, JSON.stringify(queue), MimeType.PLAIN_TEXT);
}

function deleteStatusQueue(sysFolder) {
  var it = sysFolder.getFilesByName(STATUS_FILE_NAME);
  while (it.hasNext()) { it.next().setTrashed(true); }
}

/**
 * שולח מייל למשתמש כשפרק נכשל MAX_RETRIES פעמים ומוסר מהתור.
 */
function sendFailureEmail(item, lastError) {
  try {
    MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'⚠️ פרק לא הורד אחרי '+MAX_RETRIES+' נסיונות — '+item.channelTitle,
      htmlBody:_emailWrap('הורדת פרק נכשלה',channelCard(item.channelTitle,item.rssUrl,item.channelImageUrl,
      '<p dir="auto">'+escapeHtml(item.episodeTitle)+'</p><p>שגיאה אחרונה: '+escapeHtml(lastError)+'</p>',null))});
  } catch(e) { Logger.log('⚠️ שליחת מייל כשלון נכשלה: '+e.message); }
}


// =====================================================================
// טעינת רשימת RSS מ-Drive (כולל תמיכה ב-N ימים אופציונלי לכל פיד)
// =====================================================================

// =====================================================================
// ניהול קובץ podcasts.txt — תמיכה במספר קבצים ומיזוג
// =====================================================================

/**
 * קורא את כל קבצי podcasts.txt מהתיקייה, מאחד לאובייקט אחד.
 * מחזיר { byUrl: {url: {comment, days}}, order: [urls in appearance order] }
 * עבור כפולי URL — שומר את ה-comment הראשון שנמצא, ואת הימים המרביים.
 */
function parsePodcastsFiles(sysFolder) {
  var byUrl = {}, order = [], it = sysFolder.getFilesByName(RSS_FILE_NAME);
  while (it.hasNext()) {
    var file = it.next(), raw;
    try {
      raw = file.getMimeType() === MimeType.GOOGLE_DOCS
        ? file.getAs('text/plain').getDataAsString('UTF-8')
        : file.getBlob().getDataAsString('UTF-8');
    } catch(e) { throw new Error('לא ניתן לקרוא קובץ מינויים: ' + e.message); }
    var lines = raw.split(/\r?\n/), comment = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { comment = null; continue; }
      if (line.charAt(0) === '#') { comment = line.slice(1).trim(); continue; }
      var parsed = parseSubscriptionInput(line), days = 7, next = i + 1;
      if (parsed.error) throw new Error(parsed.error + ': ' + line);
      if (!parsed.url) { comment = null; continue; }
      while (next < lines.length && (!lines[next].trim() || lines[next].trim().charAt(0) === '#')) next++;
      if (next < lines.length && /^\d+$/.test(lines[next].trim())) {
        days = Math.max(1, parseInt(lines[next].trim(), 10)); i = next;
      }
      if (!byUrl[parsed.url]) {
        byUrl[parsed.url] = {comment: comment, days: days, notifyOnly: parsed.notifyOnly};
        order.push(parsed.url);
      } else {
        byUrl[parsed.url].days = Math.max(byUrl[parsed.url].days, days);
        // Conflicting copies must not enable unintended automatic downloads.
        byUrl[parsed.url].notifyOnly = byUrl[parsed.url].notifyOnly || parsed.notifyOnly;
      }
      comment = null;
    }
  }
  return {byUrl: byUrl, order: order};
}

/**
 * מוחק את כל קבצי podcasts.txt הקיימים וכותב קובץ אחד ממוזג.
 */
function writeMergedPodcastsFile(sysFolder, merged) {
  var lines = ['# רשימת פודקאסטים'];
  merged.order.forEach(function(url) {
    var entry = merged.byUrl[url];
    if (!entry) return;
    lines.push('');
    if (entry.comment) lines.push('# ' + entry.comment);
    lines.push(url + (entry.notifyOnly ? ' --notify-only' : ''));
    if (entry.days && entry.days !== 7) lines.push(String(entry.days));
  });
  var it = sysFolder.getFilesByName(RSS_FILE_NAME), old = [];
  while (it.hasNext()) old.push(it.next());
  // Create successfully before retiring the old files.
  sysFolder.createFile(RSS_FILE_NAME, lines.join('\n'), MimeType.PLAIN_TEXT);
  old.forEach(function(file) { file.setTrashed(true); });
}

/**
 * ממוזג ומנקה כפולים — רץ בתחילת כל ריצה.
 * מדפיס ללוג רק אם בוצעה פעולה (יותר מקובץ אחד, או כפולי URL).
 */
function mergePodcastsFiles(sysFolder) {
  var it = sysFolder.getFilesByName(RSS_FILE_NAME);
  var files = [];
  while (it.hasNext()) files.push(it.next());

  if (files.length <= 1) return;  // אין מה למזג

  Logger.log("🔀 נמצאו " + files.length + " קבצי " + RSS_FILE_NAME + " — ממזג...");
  var merged = parsePodcastsFiles(sysFolder);
  writeMergedPodcastsFile(sysFolder, merged);
  Logger.log("✅ מיזוג הושלם: " + merged.order.length + " ערוצים ייחודיים בקובץ אחד.");
}

function loadRssList(sysFolder) {
  var merged = parsePodcastsFiles(sysFolder);
  return merged.order.map(function(url) {
    var entry = merged.byUrl[url];
    return {url: url, days: entry.days, notifyOnly: !!entry.notifyOnly};
  });
}

/**
 * בודק אם קובץ podcasts.txt קיים בתיקיית קבצי המערכת.
 * אם הקובץ חסר לחלוטין (לא רק ריק) — יוצר קובץ ריק חדש, ושולח מייל
 * חד-פעמי למשתמש עם כפתור "הוסף ערוץ". קובע emptySubsEmailSent=true כדי
 * שהבדיקה הנפרדת על "רשימת ערוצים ריקה" (main, סעיף 3) לא תשלח מייל כפול
 * באותה ריצה עצמה.
 */
function ensureRssFileExists(sysFolder, emailsData) {
  var it = sysFolder.getFilesByName(RSS_FILE_NAME);
  if (it.hasNext()) return false; // הקובץ קיים — אין מה לעשות

  Logger.log("⏳ קובץ " + RSS_FILE_NAME + " חסר בתיקייה 'קבצי מערכת'.");
  sysFolder.createFile(RSS_FILE_NAME, '# רשימת פודקאסטים\n', MimeType.PLAIN_TEXT);
  Logger.log("📄 נוצר קובץ " + RSS_FILE_NAME + " ריק.");
  sendMissingRssFileEmail();
  if (emailsData) emailsData.emptySubsEmailSent = true;
  return true;
}

/**
 * מייל ברוך הבא מפורט — נשלח פעם אחת כשקובץ podcasts.txt לא נמצא כלל ונוצר מאפס
 * (כולל ריצה ראשונה-ראשונה, כשגם התיקייה הראשית לא קיימת עדיין).
 * כולל: אישור התקנה תקינה, הסבר כללי על פעולת המערכת, הוראות הוספה/הסרה
 * של ערוצים, טיפ על הרצה ידנית, ופתרון בעיות נפוצות.
 */
function sendMissingRssFileEmail() {
  var example = '# הרשמה רגילה — הורדה אוטומטית\nhttps://example.com/regular/feed.xml\n\n' +
    '# התראות בלבד — ללא הורדה אוטומטית\nhttps://example.com/alerts/feed.xml --notify-only\n\n' +
    '# התראות בלבד, עם סריקה של 30 ימים לאחור\nhttps://example.com/month/feed.xml --notify-only\n30';
  var body = '<p><strong>ברוכים הבאים לפודקאסטים 2.0!</strong></p>' +
    '<p>המערכת פעילה בחשבון שלך ופועלת אוטומטית פעם בשעה. אפשר להתחיל בהוספת ערוץ באמצעות הכפתור הבא. בנושא המייל שייפתח יש להזין כתובת RSS או שם פודקאסט לחיפוש, ולשלוח.</p>' +
    buildAddChannelBtn() +
    '<h2 style="font-size:18px;">איך רוצים לעקוב אחר הערוצים?</h2>' +
    '<p><strong>הירשם</strong> — פרקים חדשים יורדו אוטומטית לתיקיית הערוץ בדרייב.</p>' +
    '<p><strong>הירשם להתראות בלבד</strong> — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית. ליד כל פרק יופיע <strong>קבל פרק</strong>, כדי לבקש רק את הפרקים הרצויים לך.</p>' +
    '<p>אפשר לשנות את סוג ההרשמה או להסיר ערוץ באמצעות הכפתורים שלידו במיילים. הכפתור קבל פרק אינו משנה את סוג ההרשמה.</p>' +
    '<h2 style="font-size:18px;">רוצים לבחור מתוך פרקים קודמים?</h2>' +
    '<p>הכפתור <strong>קבל פרקים</strong> שליד כל ערוץ שולח קטלוג פרקים במייל. משם אפשר לבקש פרק בודד, גם בלי להירשם לערוץ.</p>' +
    '<h2 style="font-size:18px;">ניהול ידני בדרייב</h2>' +
    '<p>אפשר לערוך את הקובץ <span dir="ltr">podcasts.txt</span> בתיקיית פודקאסטים 2.0, בתוך תיקיית קבצי מערכת.</p>' +
    '<p>להרשמה רגילה מוסיפים כתובת RSS בשורה נפרדת. להתראות בלבד מוסיפים בסוף אותה שורה רווח ואת הדגל <span dir="ltr">--notify-only</span>. אפשר להשתמש באותו דגל גם בסוף נושא מייל ההרשמה.</p>' +
    '<p>בשורה שאחרי כתובת הערוץ אפשר להוסיף מספר ימים לסריקה לאחור. ברירת המחדל היא שבעה ימים. שורות שמתחילות בסימן # הן הערות.</p>' +
    '<p><strong>דוגמת קובץ TXT תקינה מבחינת התחביר:</strong></p>' +
    '<pre dir="ltr" style="direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:12px;font-family:monospace;">'+escapeHtml(example)+'</pre>' +
    '<p>הכתובות בדוגמה הן להמחשה בלבד. יש להחליף אותן בכתובות RSS אמיתיות של הערוצים שלך.</p>' +
    '<h2 style="font-size:18px;">הדיווח השבועי</h2>' +
    '<p>המייל השבועי יכלול דוח הורדות ופרקים חדשים מערוצי התראות בלבד, עם הבחנה ברורה ביניהם. לאחר הרשמה, הסריקה הראשונה כוללת את טווח הימים המוגדר לערוץ.</p>' +
    '<h2 style="font-size:18px;">כדאי לדעת</h2>' +
    '<p>הטיפול בבקשות מתבצע בריצות האוטומטיות, ולכן עשוי להימשך מספר שעות. אפשר לשלוח כמה בקשות בלי להמתין לטיפול בקודמת. ניתן להריץ ידנית את הפונקציה <span dir="ltr">setUp</span> בפרויקט Apps Script.</p>' +
    '<p>אפשר למחוק קובצי פרקים שכבר הורדת. חשוב לשמור את תיקיית <strong>קבצי מערכת</strong>, שבה נמצאים המינויים, ההיסטוריה וההתקדמות.</p>' +
    '<p>לא קיבלת מייל? בדוק ספאם וקידומים ואת הרשאות הפרויקט. ביומן הרצות בפרויקט אפשר לבדוק אם התרחשה שגיאה.</p>' +
    '<h2 style="font-size:18px;">פרטיות</h2>' +
    '<p>פקודות המייל מעובדות מתוך תיבת נשלח. מיילים לכתובות הבקרה הייעודיות גלויים למנהל השירות ונאספים בהתאם למדיניות הפרטיות. עריכה ידנית של קובץ המינויים אינה שולחת פקודת מייל; איסוף כתובת המייל בכל ריצה, כפי שמתואר במדיניות הקיימת, ממשיך לחול.</p>';
  try {
    MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'🎉 פודקאסטים 2.0 — המערכת מוכנה לשימוש',htmlBody:_emailWrap('ברוכים הבאים למערכת',body)});
  } catch(e) { Logger.log('⚠️ מייל ברוך הבא נכשל: '+e.message); }
}


// =====================================================================
// הורדת קובץ אודיו ושמירה ישירה ב-Drive
// תומכת בקבצים גדולים מ-45MB דרך Chunked Download + Resumable Upload
// מחזירה {success: boolean, error: string|null}
// =====================================================================

function downloadAndSaveAudio(url, fileName, mimeType, folder, startTime) {
  var contentLength = 0;
  var supportsRange  = false;

  try {
    var headResp = UrlFetchApp.fetch(url, {
      headers            : { "Range": "bytes=0-0" },
      muteHttpExceptions : true,
      followRedirects    : true
    });
    var hdrs    = headResp.getHeaders();
    var cr      = hdrs["Content-Range"] || hdrs["content-range"] || "";
    var crMatch = cr.match(/\/(\d+)$/);
    contentLength = crMatch ? parseInt(crMatch[1], 10) : 0;
    supportsRange = (headResp.getResponseCode() === 206);
  } catch (e) {
    Logger.log("⚠️  בדיקת גודל נכשלה, מנסה הורדה רגילה: " + e.message);
  }

  if (contentLength === 0 || contentLength <= MAX_DIRECT_BYTES) {
    return downloadDirect(url, fileName, folder);
  }

  Logger.log("📦 קובץ גדול: " + Math.round(contentLength / 1024 / 1024) + "MB");
  if (!supportsRange) {
    Logger.log("⚠️  השרת לא תומך ב-Range. מנסה הורדה רגילה בכל זאת...");
    return downloadDirect(url, fileName, folder);
  }

  return downloadChunked(url, fileName, mimeType, folder, contentLength, startTime,
    null  // no saved state on first attempt
  );
}

function downloadDirect(url, fileName, folder) {
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) {
      return { success: false, error: "HTTP " + resp.getResponseCode(), fileId: null };
    }
    var file = folder.createFile(resp.getBlob().setName(fileName));
    return { success: true, error: null, fileId: file.getId() };
  } catch (e) {
    return { success: false, error: e.message, fileId: null };
  }
}

/**
 * downloadChunked — תומכת בהמשך הורדה בין ריצות (אם פג הזמן).
 * savedState: {uploadUrl, offset} נשמר בפריט התור כ-item.chunkState.
 * session ה-resumable upload של Drive תקף 7 ימים.
 */
function downloadChunked(url, fileName, mimeType, folder, contentLength, startTime, savedState) {
  var token     = ScriptApp.getOAuthToken();
  var uploadUrl = savedState && savedState.uploadUrl ? savedState.uploadUrl : null;
  var offset    = savedState && savedState.offset    ? savedState.offset    : 0;

  // ── פתיחת session חדש אם אין saved state ──
  if (!uploadUrl) {
    var initResp = UrlFetchApp.fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method  : "POST",
        headers : {
          "Authorization"           : "Bearer " + token,
          "Content-Type"            : "application/json",
          "X-Upload-Content-Type"   : mimeType,
          "X-Upload-Content-Length" : String(contentLength)
        },
        payload            : JSON.stringify({ name: fileName, parents: [folder.getId()] }),
        muteHttpExceptions : true
      }
    );
    if (initResp.getResponseCode() !== 200) {
      return { success: false, error: "פתיחת Resumable Upload נכשלה: HTTP " + initResp.getResponseCode() };
    }
    uploadUrl = initResp.getHeaders()["Location"] || initResp.getHeaders()["location"];
    if (!uploadUrl) return { success: false, error: "חסר Location header" };
  }

  var totalChunks = Math.ceil(contentLength / CHUNK_SIZE_BYTES);
  Logger.log("📡 chunks: " + totalChunks + " | התחלה מ-" + Math.round(offset/1048576) + "MB");

  while (offset < contentLength) {
    // ── Time guard: אם הזמן אוזל — שומר מצב ומחזיר PAUSED, לא כישלון ──
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן — משהה chunked download ב-" + Math.round(offset/1048576) + "MB.");
      return {
        success  : false,
        paused   : true,
        error    : "time_limit",
        chunkState: { uploadUrl: uploadUrl, offset: offset, contentLength: contentLength }
      };
    }

    var end = Math.min(offset + CHUNK_SIZE_BYTES - 1, contentLength - 1);

    var chunkResp = UrlFetchApp.fetch(url, {
      headers            : { "Range": "bytes=" + offset + "-" + end },
      muteHttpExceptions : true,
      followRedirects    : true
    });
    var chunkCode = chunkResp.getResponseCode();
    if (chunkCode !== 206 && chunkCode !== 200) {
      // שגיאת הורדה — מבטל session
      try { UrlFetchApp.fetch(uploadUrl, { method: "delete", muteHttpExceptions: true }); } catch(e) {}
      return { success: false, error: "הורדת chunk נכשלה: HTTP " + chunkCode };
    }

    var uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method  : "PUT",
      headers : {
        "Content-Range" : "bytes " + offset + "-" + end + "/" + contentLength,
        "Content-Type"  : mimeType
      },
      payload            : chunkResp.getContent(),
      muteHttpExceptions : true
    });
    var uploadCode = uploadResp.getResponseCode();

    if (uploadCode === 308) {
      offset = end + 1;
      Logger.log("  ✔ " + Math.round(offset/1048576) + "/" + Math.round(contentLength/1048576) + "MB");
    } else if (uploadCode === 200 || uploadCode === 201) {
      var fid = null;
      try { fid = JSON.parse(uploadResp.getContentText()).id || null; } catch(pe) {}
      return { success: true, error: null, fileId: fid };
    } else {
      return { success: false, error: "העלאת chunk נכשלה: HTTP " + uploadCode, fileId: null };
    }
  }

  return { success: true, error: null, fileId: null };
}


// =====================================================================
// פונקציות עזר
// =====================================================================

function getOrCreateFolder(parentFolder, folderName) {
  var it = parentFolder.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  Logger.log("📂 יוצר תיקייה חדשה: " + folderName);
  return parentFolder.createFolder(folderName);
}

function fileExistsInFolder(folder, fileName) {
  return folder.getFilesByName(fileName).hasNext();
}

function getEnclosureInfo(item) {
  var enclosure = item.getChild("enclosure");
  if (!enclosure) return null;
  var urlAttr = enclosure.getAttribute("url");
  if (!urlAttr) return null;
  var typeAttr = enclosure.getAttribute("type");
  return { url: urlAttr.getValue(), type: typeAttr ? typeAttr.getValue() : "" };
}

function getFileExtension(url, mimeType) {
  var knownExts = ["mp3", "m4a", "mp4", "ogg", "wav", "flac", "aac", "opus"];
  var cleanUrl  = url.split("?")[0].split("#")[0];
  var lastDot   = cleanUrl.lastIndexOf(".");
  if (lastDot > -1) {
    var ext = cleanUrl.substring(lastDot + 1).toLowerCase();
    if (knownExts.indexOf(ext) > -1) return "." + ext;
  }
  var mimeMap = {
    "audio/mpeg" : ".mp3", "audio/mp3" : ".mp3", "audio/x-m4a" : ".m4a",
    "audio/mp4"  : ".m4a", "audio/ogg" : ".ogg", "audio/aac"   : ".aac", "audio/opus" : ".opus"
  };
  return mimeMap[mimeType] || ".mp3";
}

/**
 * בונה שם קובץ עם מספר פרק כתחילית, אלא אם המספר כבר מופיע בכותרת.
 */
function buildFileName(title, episodeNum, fileExt) {
  if (!episodeNum) return sanitizeFileName(title) + fileExt;
  var numStr  = String(episodeNum);
  var pattern = new RegExp("(?:^|\\D)" + numStr + "(?:\\D|$)");
  if (pattern.test(title)) return sanitizeFileName(title) + fileExt;
  return sanitizeFileName("[" + numStr + "] " + title) + fileExt;
}

/**
 * ממיר את כל חותמות הזמן בטקסט (בכל פורמט נפוץ) לתגיות LRC [MM:SS.00],
 * תוך שמירה על שאר הטקסט סביבן ללא שינוי.
 * תומך ב: H:MM:SS , HH:MM:SS , M:SS , MM:SS
 */
function convertTimestampsToLrc(text) {
  // (?<!\/) מונע התאמה בתוך URL (אחרי "//")
  var pattern = /(?<!\/)\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b/g;

  return text.replace(pattern, function(match, g1, g2, g3, offset, fullStr) {
    var totalSeconds;
    if (g3 !== undefined) {
      // H:MM:SS או HH:MM:SS
      totalSeconds = parseInt(g1, 10) * 3600 + parseInt(g2, 10) * 60 + parseInt(g3, 10);
    } else {
      // M:SS או MM:SS
      totalSeconds = parseInt(g1, 10) * 60 + parseInt(g2, 10);
    }
    var mm = Math.floor(totalSeconds / 60);
    var ss = totalSeconds % 60;
    var pad = function(n) { return (n < 10 ? "0" : "") + n; };
    var tag = "[" + pad(mm) + ":" + pad(ss) + ".00]";

    // אם יש תוכן לפני התגית על אותה שורה — מוסיפים שורה חדשה לפניה
    var lastNl      = fullStr.lastIndexOf("\n", offset - 1);
    var beforeOnLine = fullStr.substring(lastNl + 1, offset).trim();
    var prefix = beforeOnLine.length > 0 ? "\n" : "";

    // אם יש תוכן מיד אחרי התגית (לא שורה חדשה, לא סוף מחרוזת) — מוסיפים רווח
    var charAfter = fullStr.charAt(offset + match.length);
    var suffix = (charAfter && charAfter !== "\n" && charAfter !== "\r") ? " " : "";

    return prefix + tag + suffix;
  });
}

/**
 * יוצר קובץ .lrc לצד קובץ האודיו עם כל פרטי הפרק.
 * חותמות זמן בתיאור מומרות לפורמט LRC; שאר הטקסט נשמר כפי שהוא.
 */
function createLrcFile(folder, baseName, meta) {
  var lrcName = baseName + ".lrc";
  if (folder.getFilesByName(lrcName).hasNext()) return;

  var pd = meta.pubDate ? formatDate(new Date(meta.pubDate)) : "";

  var lines = [
    "פודקאסט: " + meta.channelTitle,
    "פרק: " + meta.episodeTitle,
    "תאריך פרסום: " + pd,
    "מגיש: " + (meta.author || ""),
    "משך: " + (meta.duration || "")
  ];
  if (meta.season)        lines.push("עונה: " + meta.season);
  if (meta.episodeNumber) lines.push("מספר פרק: " + meta.episodeNumber);
  if (meta.subtitle)      lines.push("כותרת משנה: " + meta.subtitle);

  lines.push("");
  lines.push("תיאור:");

  var cleanDescription = (meta.description || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
  lines.push(convertTimestampsToLrc(cleanDescription));

  folder.createFile(lrcName, lines.join("\n"), MimeType.PLAIN_TEXT);
  Logger.log("📄 LRC: " + lrcName);
}

/**
 * מוריד ושומר את תמונת הכריכה של הפודקאסט כ-folder.[סיומת].
 * אם קובץ folder.* כבר קיים בתיקייה — לא פועל.
 */
function savePodcastCoverArt(channel, podcastFolder, itunesNs) {
  var files = podcastFolder.getFiles();
  while (files.hasNext()) {
    if (files.next().getName().indexOf("folder.") === 0) return;
  }

  var imageUrl = null;
  var itunesImage = channel.getChild("image", itunesNs);
  if (itunesImage) {
    var href = itunesImage.getAttribute("href");
    if (href) imageUrl = href.getValue();
  }
  if (!imageUrl) {
    var rssImage = channel.getChild("image");
    if (rssImage) imageUrl = rssImage.getChildText("url") || null;
  }
  if (!imageUrl) {
    Logger.log("⚠️  לא נמצאה תמונת כריכה בפיד.");
    return;
  }

  try {
    var resp = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log("⚠️  שגיאת HTTP " + resp.getResponseCode() + " בהורדת תמונת כריכה.");
      return;
    }

    var urlPart = imageUrl.split("?")[0].split(".").pop().toLowerCase();
    var ct      = (resp.getHeaders()["Content-Type"] || resp.getHeaders()["content-type"] || "").split(";")[0].trim();
    var ctMap   = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    var ext     = (["jpg", "jpeg", "png", "webp", "gif"].indexOf(urlPart) > -1)
                  ? (urlPart === "jpeg" ? "jpg" : urlPart)
                  : (ctMap[ct] || "jpg");

    podcastFolder.createFile(resp.getBlob().setName("folder." + ext));
    Logger.log("🖼️  תמונת כריכה נשמרה: folder." + ext);
  } catch (e) {
    Logger.log("⚠️  שגיאה בשמירת תמונת כריכה: " + e.message);
  }
}

function sanitizeFolderName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().substring(0, 100);
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().substring(0, 150);
}


// =====================================================================
// היסטוריית הורדות (download_history.json)
// מונעת הורדה כפולה גם אם הקובץ נמחק מהדרייב.
// כל רשומה: { url, expiresAt }  — expiresAt = pubDate + feedDays ימים.
// =====================================================================

function loadDownloadHistory(sysFolder) {
  var it = sysFolder.getFilesByName(HISTORY_FILE_NAME);
  if (!it.hasNext()) return [];
  try {
    return JSON.parse(it.next().getBlob().getDataAsString("UTF-8")) || [];
  } catch(e) { return []; }
}

function saveDownloadHistory(sysFolder, history) {
  var it = sysFolder.getFilesByName(HISTORY_FILE_NAME);
  while (it.hasNext()) it.next().setTrashed(true);
  sysFolder.createFile(HISTORY_FILE_NAME, JSON.stringify(history), MimeType.PLAIN_TEXT);
}

/** מוחק רשומות שתאריך התפוגה שלהן עבר — כדי לא לצבור ג'אנק לאורך זמן */
function purgeExpiredHistory(history) {
  var now = Date.now();
  return history.filter(function(r) {
    return !r.expiresAt || new Date(r.expiresAt).getTime() > now;
  });
}

function isInHistory(history, url) {
  for (var i = 0; i < history.length; i++) {
    if (history[i].url === url) return true;
  }
  return false;
}

/** תאריך תפוגה = תאריך שידור + feedDays ימים (או 7 ברירת מחדל) */
function addToHistory(history, item) {
  var pubMs   = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
  var days    = item.feedDays || 7;
  var expMs   = isNaN(pubMs) ? Date.now() + days * 86400000 : pubMs + days * 86400000;
  history.push({ url: item.url, expiresAt: new Date(expMs).toISOString() });
}


// =====================================================================
// ניהול emails.json
// מבנה: { storage:{nextSendAt, pending[]},
//          weekly:{nextSendAt, channels:{title:{image,items[]}}},
//          subscriptions:{list:[{url,days}]} }
// =====================================================================

function loadEmailsData(sysFolder) {
  var it = sysFolder.getFilesByName(EMAILS_FILE_NAME);
  if (!it.hasNext()) return null;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString("UTF-8"));
  } catch(e) { return null; }
}

function saveEmailsData(sysFolder, data) {
  var it = sysFolder.getFilesByName(EMAILS_FILE_NAME);
  while (it.hasNext()) it.next().setTrashed(true);
  sysFolder.createFile(EMAILS_FILE_NAME, JSON.stringify(data), MimeType.PLAIN_TEXT);
}

/** מאתחל מבנה emails.json אם לא קיים או חסרים שדות */
function initEmailsStructure(data) {
  if (!_emailsData) _emailsData = {};
  if (!_emailsData.storage)  {
    _emailsData.storage = { nextSendAt: _daysFromNow(STORAGE_EMAIL_DAYS), pending: [] };
  }
  if (!_emailsData.weekly) {
    _emailsData.weekly = { nextSendAt: _nextThursday(), channels: {} };
  }
  if (!_emailsData.weekly.channels) _emailsData.weekly.channels = {};
  if (!_emailsData.subscriptions) {
    _emailsData.subscriptions = { list: [], details: {} };
  }
  if (!_emailsData.subscriptions.details) _emailsData.subscriptions.details = {};
  if (_emailsData.emptySubsEmailSent === undefined) _emailsData.emptySubsEmailSent = false;
  if (!_emailsData.notificationSeen) _emailsData.notificationSeen = {};
  if (!_emailsData.processedEmailIds) _emailsData.processedEmailIds = [];
  if (!_emailsData.pendingSearches)     _emailsData.pendingSearches = {};
  if (!_emailsData.pendingEpisodeSummary) _emailsData.pendingEpisodeSummary = [];
}

function _daysFromNow(d) {
  return new Date(Date.now() + d * 86400000).toISOString();
}

function _nextThursday() {
  var d = new Date();
  var day = d.getDay(); // 0=Sun
  var daysUntilThur = (4 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilThur);
  d.setHours(2, 0, 0, 0);
  return d.toISOString();
}


// ── STORAGE pending ──

function addToStoragePending(emailsData, item) {
  var pending = emailsData.storage.pending;
  // מניעת כפילויות
  for (var i = 0; i < pending.length; i++) {
    if (pending[i].url === item.url) return;
  }
  pending.push({
    channelTitle    : item.channelTitle,
    channelImageUrl : item.channelImageUrl || null,
    episodeTitle    : item.episodeTitle,
    pubDate         : item.pubDate ? formatDate(new Date(item.pubDate)) : '',
    duration        : item.duration,
    rssUrl          : item.rssUrl || null,
    source          : item.source || (item.fromSubscription === false ? "manual" : "automatic"),
    url             : item.url,
    skippedAt       : new Date().toISOString()
  });
}

function shouldSendStorageEmail(emailsData) {
  return emailsData &&
         emailsData.storage &&
         emailsData.storage.pending.length > 1 &&
         new Date(emailsData.storage.nextSendAt).getTime() <= Date.now();
}


// ── WEEKLY pending ──

function addToWeeklyPending(emailsData, item, status, error) {
  var ch = emailsData.weekly.channels;
  var key = item.rssUrl || item.channelTitle;
  if (!ch[key]) ch[key] = {title: item.channelTitle, image: item.channelImageUrl || null,
    rssUrl: item.rssUrl || null, items: []};
  var group = ch[key];
  if (group.items.some(function(x) { return x.url === item.url && x.status === status; })) return;
  group.items.push({episodeTitle: item.episodeTitle,
    pubDate: item.pubDate ? formatDate(new Date(item.pubDate)) : '', duration: item.duration,
    status: status, error: error || null, fileUrl: item.fileUrl || null,
    url: item.url, guid: item.guid || item.url, rssUrl: item.rssUrl || null});
}

function shouldSendWeeklyEmail(emailsData) {
  return emailsData &&
         emailsData.weekly &&
         new Date(emailsData.weekly.nextSendAt).getTime() <= Date.now();
}


// ── SUBSCRIPTIONS ──

/**
 * משווה רשימת RSS נוכחית לרשימה ב-JSON.
 * מחזיר true אם יש שינוי (ויעדכן _emailsData.subscriptions.list).
 */
function checkSubscriptionChanges(rssList, emailsData) {
  function normalized(list) {
    return list.map(function(r) { return {url:r.url, days:r.days, notifyOnly:!!r.notifyOnly}; })
      .sort(function(a,b) { return a.url < b.url ? -1 : a.url > b.url ? 1 : 0; });
  }
  var current = normalized(rssList), stored = normalized(emailsData.subscriptions.list || []);
  // Only record an acknowledged snapshot after the email has actually been sent.
  return JSON.stringify(current) !== JSON.stringify(stored);
}


// =====================================================================
// בדיקת נפח אחסון Drive
// משתמשת ב-Drive v3 API (scope כבר מאושר ע"י DriveApp).
// =====================================================================

function getFreeStorageBytes() {
  try {
    var token = ScriptApp.getOAuthToken();
    var resp  = UrlFetchApp.fetch(
      "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
      { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return Number.MAX_VALUE;
    var data  = JSON.parse(resp.getContentText());
    var quota = data.storageQuota;
    var limit = parseInt(quota.limit || "0", 10);
    var used  = parseInt(quota.usage || "0", 10);
    if (!limit) return Number.MAX_VALUE;  // unlimited (Workspace)
    return limit - used;
  } catch(e) {
    Logger.log("⚠️  בדיקת נפח נכשלה: " + e.message);
    return Number.MAX_VALUE;
  }
}


// =====================================================================
// ניהול זמן ושליחת מיילים
// =====================================================================

function hasEnoughTimeForEmails(startTime) {
  return (new Date() - startTime) < (TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS);
}

// ── image helper ──
/** מוריד תמונה ומחזירה כ-data URI (base64). כישלון → null */
function fetchImageAsDataUri(url) {
  if (!url) return null;
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return null;
    var ct   = (resp.getHeaders()["Content-Type"] || resp.getHeaders()["content-type"] || "image/jpeg")
                 .split(";")[0].trim();
    var b64  = Utilities.base64Encode(resp.getContent());
    return "data:" + ct + ";base64," + b64;
  } catch(e) { return null; }
}

/** מחלץ URL תמונת ערוץ מ-XML channel element */
function getChannelCoverArtUrl(channel, itunesNs) {
  var itunesImg = channel.getChild("image", itunesNs);
  if (itunesImg) {
    var href = itunesImg.getAttribute("href");
    if (href) return href.getValue();
  }
  var rssImg = channel.getChild("image");
  if (rssImg) return rssImg.getChildText("url") || null;
  return null;
}

// ── HTML email builder ──
function _channelImgTag(dataUri, title) {
  if (!dataUri) return '<div style="width:48px;height:48px;background:#e0e7ff;border-radius:8px;display:inline-block;vertical-align:middle;text-align:center;line-height:48px;font-size:20px;">🎙️</div>';
  return '<img src="' + dataUri + '" width="48" height="48" style="border-radius:8px;vertical-align:middle;object-fit:cover;" alt="' + title + '">';
}

function _emailWrap(title, body) {
  return '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"></head>' +
    '<body dir="rtl" style="direction:rtl;text-align:right;margin:0;padding:12px;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;">' +
    '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="direction:rtl;"><tr><td align="center">' +
    '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="direction:rtl;text-align:right;max-width:600px;background:#fff;border-radius:16px;">' +
    '<tr><td dir="rtl" style="direction:rtl;text-align:right;background:#6366f1;color:#fff;padding:24px;">' +
    '<h1 style="margin:0;font-size:24px;">🎙️ פודקאסטים 2.0</h1><p>' + escapeHtml(title) + '</p></td></tr>' +
    '<tr><td dir="rtl" style="direction:rtl;text-align:right;padding:20px;line-height:1.7;">' + body + '</td></tr>' +
    '<tr><td dir="rtl" style="direction:rtl;text-align:center;padding:16px;color:#64748b;font-size:12px;">פודקאסטים 2.0 | ' +
    escapeHtml(formatDate(new Date())) + '</td></tr></table></td></tr></table></body></html>';
}




// ── sendSubscriptionEmail ──
/**
 * שולח מייל עדכון מינויים עם פרטי כל הערוצים.
 * אוסף פרטי ערוץ (כותרת, תיאור, תמונה) ישירות מהפיד.
 */



// =====================================================================
// Google Forms — שליחת פרטי משתמש
// =====================================================================
//
// איך לאתר את הפרטים הנדרשים:
//   1. פתח את הטופס ב-Google Forms → לחץ "שלח" → "קישור" → "URL ישיר"
//   2. הורד את עמוד HTML של הטופס (Ctrl+S בדפדפן)
//   3. חפש בHTML את:
//      • action של ה-form → לדוגמה:
//        "https://docs.google.com/forms/d/e/1FAIpQLSc.../formResponse"
//        (החלף FORMS_URL_PLACEHOLDER בכתובת זו)
//      • name של כל שדה קלט → לדוגמה: name="entry.123456789"
//        (החלף ENTRY_EMAIL_PLACEHOLDER ו-ENTRY_NAME_PLACEHOLDER)
//
// ─────────────────────────────────────────────────────────────────────

var GITHUB_CHANGELOG    = "https://raw.githubusercontent.com/MOSHHHHHH/pod/refs/heads/main/CHANGELOG.md";
var FORMS_SUBMISSION_URL = "https://docs.google.com/forms/d/e/1FAIpQLSefjtfAs3Tsp_0sg9kD9Ntnw511quYFndxZDTdqi__wGp3BMw/formResponse";
var FORMS_ENTRY_NAME     = "entry.601965156";    // שדה "שם"
var FORMS_ENTRY_EMAIL    = "entry.1965782261";   // שדה "כתובת אימייל"

/**
 * שולח את פרטי המשתמש לטופס Google Forms.
 * אינה מדפיסה ללוג ואינה זורקת שגיאות — נכשלת בשקט.
 * נקראת פעם אחת בכל ריצה. משתמשת בכתובת המייל עבור שני השדות
 * (שם וכתובת מייל) — אין אפשרות לאחזר שם תצוגה ב-GAS ללא scope נוסף.
 */
function submitUserDataToForm() {
  try {
    var email   = Session.getEffectiveUser().getEmail();
    var payload = FORMS_ENTRY_NAME  + "=" + encodeURIComponent(email) +
                  "&" + FORMS_ENTRY_EMAIL + "=" + encodeURIComponent(email) +
                  "&submit=Submit";
    UrlFetchApp.fetch(FORMS_SUBMISSION_URL, {
      method             : "POST",
      contentType        : "application/x-www-form-urlencoded",
      payload            : payload,
      muteHttpExceptions : true,
      followRedirects    : true
    });
  } catch(e) { /* נכשל בשקט */ }
}


// =====================================================================
// פורמט תאריך אחיד: dd/mm/yyyy hh:mm
// =====================================================================
function formatDate(d) {
  if (!d) return '';
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return String(d);
  var p = function(n){ return n < 10 ? '0'+n : ''+n; };
  return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}


// =====================================================================
// כלי עזר לאימיילים
// =====================================================================

/** כפתור mailto מעוצב */
function buildMailtoBtn(label, to, subject, body, color) {
  color = color || '#6366f1';
  // to לא מקודד (@ חייב להישאר כפשוטו בכתובת הנמען)
  var uri = 'mailto:'+to+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  return '<a dir="rtl" href="'+escapeHtml(uri)+'" style="display:inline-block;padding:5px 13px;background:'+color+
         ';direction:rtl;text-align:center;color:#fff;border-radius:20px;text-decoration:none;font-size:.78rem;font-weight:600;margin:2px 3px;">'+escapeHtml(label)+'</a>';
}

/** שני כפתורי הרשמה לפי מצב נוכחי, ובנוסף קבל פרקים (קטלוג). */
function buildChannelControlButtons(channelTitle, rssUrl) {
  if (!rssUrl) return '<span style="color:#64748b;">פרטי הערוץ יעודכנו בסריקה הבאה</span>';
  var sub = _rssList.filter(function(r) { return r.url === rssUrl; })[0];
  var buttons = '';
  if (!sub || sub.notifyOnly) buttons += buildSubscriptionButton(channelTitle, rssUrl, false);
  if (sub) buttons += buildMailtoBtn('הסר', CTRL_UNSUBSCRIBE, rssUrl,
    'שלח מייל זה להסרת הערוץ ' + channelTitle + '.\n\n' + PRIVACY_NOTE, '#ef4444');
  if (!sub || !sub.notifyOnly) buttons += buildSubscriptionButton(channelTitle, rssUrl, true);
  return buttons + buildMailtoBtn('קבל פרקים', CTRL_GET_EPISODE, rssUrl,
    'שלח מייל זה לקבלת קטלוג הפרקים של ' + channelTitle + '.\n\n' + PRIVACY_NOTE);
}

/** כפתור הוסף ערוץ */
function buildAddChannelBtn() {
  return buildMailtoBtn('+ הוסף ערוץ', CTRL_SUBSCRIBE,
    '[כתובת RSS או מחרוזת חיפוש]',
    'אם אתה יודע את כתובת הפיד RSS של הפודקאסט, מלא אותה בכותרת. אחרת מלא את שם הפודקאסט/נושא/מגיש לחיפוש. לאחר מכן שלח מייל זה. הבקשה תטופל תוך מספר שעות.\n\n'+PRIVACY_NOTE,
    '#10b981');
}

/** קישור לתיקיית ערוץ ב-Drive (null אם לא קיימת) */
function getFolderLink(channelTitle, mainFolder) {
  if (!channelTitle || !mainFolder) return null;
  try {
    var it = mainFolder.getFoldersByName(sanitizeFolderName(channelTitle));
    if (it.hasNext()) return 'https://drive.google.com/drive/folders/'+it.next().getId();
  } catch(e) { /* ויתור בשקט — הטקסט יוצג ללא קישור */ }
  return null;
}

/** כפתור הירשם (לערוץ שאינו ברשימת המינויים) */
function buildSubscribeButton(channelTitle, rssUrl) {
  return buildChannelControlButtons(channelTitle, rssUrl);
}

/** שם ערוץ עם קישור לתיקייה (או ללא קישור אם לא קיימת) */
function channelNameTag(channelTitle, mainFolder, extra) {
  var link = getFolderLink(channelTitle, mainFolder);
  var text = '<span dir="auto">' + escapeHtml(channelTitle) + '</span>';
  return (link ? '<a href="'+escapeHtml(link)+'" style="color:#1e293b;font-weight:700;text-decoration:none;">'+text+'</a>' : '<strong>'+text+'</strong>') + (extra || '');
}

/** תמונת ערוץ עם src ישיר (לא base64) */
function channelImgTag(imgUrl) {
  return imgUrl
    ? '<img src="'+escapeHtml(imgUrl)+'" width="44" height="44" style="border-radius:8px;object-fit:cover;vertical-align:middle;flex-shrink:0;" alt="">'
    : '<div style="width:44px;height:44px;background:#e0e7ff;border-radius:8px;display:inline-block;text-align:center;line-height:44px;font-size:18px;flex-shrink:0;">🎙️</div>';
}


// =====================================================================
// sendWeeklyEmail — עם ערוצים לא פעילים, קישורים, כפתורים
// =====================================================================
function sendWeeklyEmail(sysFolder, emailsData, rssList, mainFolder) {
  _rssList = rssList;
  var channels = emailsData.weekly.channels, success = 0, failed = 0, alerts = 0, body = '';
  Object.keys(channels).forEach(function(key) {
    channels[key].items.forEach(function(it) {
      if (it.status === 'success') success++;
      if (it.status === 'failed') failed++;
      if (it.status === 'notification') alerts++;
    });
  });
  body += '<p>✅ ' + success + ' פרקים הורדו' + (failed ? ' · ❌ ' + failed + ' נכשלו' : '') +
    (alerts ? ' · 🔔 ' + alerts + ' פרקים חדשים להתראות בלבד' : '') + '</p>';
  var activeFeeds = {};
  ['downloads', 'notifications'].forEach(function(section) {
    var heading = false;
    Object.keys(channels).forEach(function(key) {
      var d = channels[key], title = d.title || key;
      var items = d.items.filter(function(it) {
        return section === 'notifications' ? it.status === 'notification' : it.status !== 'notification';
      });
      if (!items.length) return;
      if (!heading) { body += '<h2 style="font-size:18px;">' + (section === 'notifications' ? 'פרקים חדשים — התראות בלבד' : 'דוח הורדות') + '</h2>'; heading = true; }
      if (d.rssUrl) activeFeeds[d.rssUrl] = true;
      var content = '';
      items.forEach(function(it) {
        var text = '<span dir="auto">' + escapeHtml(it.episodeTitle) + '</span>';
        if (it.fileUrl) text = '<a href="' + escapeHtml(it.fileUrl) + '">' + text + '</a>';
        content += '<div dir="rtl" style="direction:rtl;text-align:right;padding:8px 0;border-bottom:1px solid #e2e8f0;">' +
          (it.status === 'success' ? '✅ ' : it.status === 'failed' ? '❌ ' : '🔔 ') + text +
          '<div style="color:#64748b;font-size:12px;">' + escapeHtml(it.pubDate) +
          (it.duration ? ' · <span dir="ltr">' + escapeHtml(it.duration) + '</span>' : '') +
          (it.error ? ' · ' + escapeHtml(it.error) : '') + '</div>' +
          (it.status === 'notification' ? buildGetEpisodeButton(title, it.episodeTitle, d.rssUrl, it.guid) : '') + '</div>';
      });
      body += channelCard(title, d.rssUrl, d.image, content, mainFolder);
    });
  });
  var details = emailsData.subscriptions.details || {};
  var inactive = rssList.filter(function(r) { return !activeFeeds[r.url]; });
  if (inactive.length) body += '<h2 style="font-size:18px;">ערוצים ללא פעילות בדוח השבוע</h2>';
  inactive.forEach(function(r) {
    var info = details[r.url] || {};
    body += channelCard(info.title || r.url, r.url, info.image,
      '<p>' + (r.notifyOnly ? 'התראות בלבד — אין פרקים חדשים בדוח.' : 'הרשמה רגילה — אין הורדות בדוח.') + '</p>', mainFolder);
  });
  body += buildAddChannelBtn();
  try {
    MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),
      subject:'📊 פודקאסטים 2.0 — סיכום שבועי | '+success+' פרקים הורדו'+(alerts?' | '+alerts+' פרקים להתראות':''),
      htmlBody:_emailWrap('סיכום שבועי',body)});
    emailsData.weekly.nextSendAt = _nextThursday();
    emailsData.weekly.channels = {};
    return true;
  } catch(e) { Logger.log('⚠️ סיכום שבועי נכשל: '+e.message); return false; }
}


// =====================================================================
// sendStorageEmail — עם קישורים וכפתורים
// =====================================================================
function sendStorageEmail(sysFolder, emailsData, mainFolder) {
  var pending = emailsData.storage.pending;
  if (!pending.length) return true;
  var groups = {};
  pending.forEach(function(p) {
    var key = p.rssUrl || p.channelTitle;
    if (!groups[key]) groups[key] = {title:p.channelTitle, rssUrl:p.rssUrl, image:p.channelImageUrl, items:[]};
    groups[key].items.push(p);
  });
  var body = '<p>⚠️ נפח האחסון ב־Drive נמוך מ־2GB. הפרקים הבאים ממתינים להורדה:</p>';
  Object.keys(groups).forEach(function(key) {
    var d = groups[key], content = '';
    d.items.forEach(function(it) { content += '<p dir="auto">'+escapeHtml(it.episodeTitle)+'</p>'; });
    body += channelCard(d.title,d.rssUrl,d.image,content,mainFolder);
  });
  body += '<p>לאחר פינוי מקום, ההורדות הממתינות יוכלו להמשיך אוטומטית.</p>'+buildAddChannelBtn();
  try {
    MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'💾 פודקאסטים 2.0 — נפח אחסון נמוך',htmlBody:_emailWrap('פרקים ממתינים לאחסון',body)});
    emailsData.storage.nextSendAt = _daysFromNow(STORAGE_EMAIL_DAYS);
    return true;
  } catch(e) { Logger.log('⚠️ מייל אחסון נכשל: '+e.message); return false; }
}


// =====================================================================
// sendSubscriptionEmail — עם קישורים וכפתורים
// =====================================================================
function sendSubscriptionEmail(rssList, sysFolder, emailsData, startTime, mainFolder) {
  _rssList = rssList;
  var body = '<p>רשימת הערוצים וסוגי ההרשמה עודכנו:</p>', details = emailsData.subscriptions.details;
  rssList.forEach(function(rss) {
    var info = details[rss.url] || {}, reason = '';
    if (new Date() - startTime < TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) {
      try {
        var resp = UrlFetchApp.fetch(rss.url,{muteHttpExceptions:true,followRedirects:true});
        if (resp.getResponseCode() !== 200) throw new Error('HTTP '+resp.getResponseCode());
        var ch = XmlService.parse(resp.getContentText('UTF-8')).getRootElement().getChild('channel');
        if (!ch) throw new Error('RSS לא תקין');
        info = {title:ch.getChildText('title') || rss.url,image:getChannelCoverArtUrl(ch,XmlService.getNamespace(ITUNES_NS_URL))};
        details[rss.url] = info;
      } catch(e) { reason = e.message; }
    }
    var content = '<p>'+ (rss.notifyOnly ? '🔔 התראות בלבד — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית.' : '⬇️ הרשמה רגילה — פרקים חדשים יורדו אוטומטית לדרייב.') +
      '</p><p>טווח סריקה: '+rss.days+' ימים</p>' +
      (reason ? '<p>לא ניתן היה לעדכן פרטי ערוץ: '+escapeHtml(reason)+'</p>' : '');
    body += channelCard(info.title || rss.url,rss.url,info.image,content,mainFolder);
  });
  if (!rssList.length) body += '<p>אין כרגע ערוצים ברשימת ההרשמה.</p>';
  body += buildAddChannelBtn();
  try {
    MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'📋 פודקאסטים 2.0 — רשימת מינויים עודכנה',htmlBody:_emailWrap('עדכון רשימת מינויים',body)});
    emailsData.subscriptions.list = rssList.map(function(r) { return {url:r.url,days:r.days,notifyOnly:!!r.notifyOnly}; });
    return true;
  } catch(e) { Logger.log('⚠️ מייל מינויים נכשל: '+e.message); return false; }
}

// update initEmailsStructure to include subscriptions.details and emptySubsEmailSent
// (patched inline by checking in the function below)


// =====================================================================
// sendEmptySubscriptionsEmail — נשלח פעם אחת כשאין ערוצים
// (מאוחד עם sendMissingRssFileEmail: אותו מייל עשיר, בין אם הקובץ חסר
// לגמרי ובין אם הוא קיים אך ריק — כך שהמשתמש תמיד מקבל את אותה חוויה.)
// =====================================================================
function sendEmptySubscriptionsEmail(emailsData) {
  sendMissingRssFileEmail();
}


// =====================================================================
// checkSentMailbox — סורק תיבת הדואר היוצא לכתובות הבקרה
// =====================================================================
function checkSentMailbox(sysFolder, mainFolder, queue, rssList, startTime) {
  var processed = [], ids = _emailsData.processedEmailIds || [], messages = [], found = {};
  [CTRL_UNSUBSCRIBE, CTRL_SUBSCRIBE, CTRL_GET_EPISODE].forEach(function(addr) {
    if (!hasEnoughTimeForEmails(startTime)) return;
    GmailApp.search('in:sent to:'+addr,0,10).forEach(function(thread) {
      thread.getMessages().forEach(function(message) {
        var id = 'message:'+message.getId();
        if (found[id] || ids.indexOf(id) >= 0 || message.isInTrash()) return;
        var from = message.getFrom().toLowerCase(), own = Session.getEffectiveUser().getEmail().toLowerCase();
        if (from !== own && from.indexOf('<'+own+'>') < 0) return;
        // A thread may include replies unrelated to this control address.
        if (message.getTo().toLowerCase().indexOf(addr.toLowerCase()) < 0) return;
        found[id] = true;
        messages.push({message:message,id:id,addr:addr});
      });
    });
  });
  // Apply commands in the order they were sent, including changes within one Gmail thread.
  messages.sort(function(a,b) { return a.message.getDate() - b.message.getDate(); });
  messages.forEach(function(entry) {
    if (!hasEnoughTimeForEmails(startTime)) return;
    var one = {getMessages:function() { return [entry.message]; }}, result;
    try {
      if (entry.addr === CTRL_UNSUBSCRIBE) result = processUnsubscribeEmail(one,sysFolder,rssList);
      else if (entry.addr === CTRL_SUBSCRIBE) result = processSubscribeEmail(one,sysFolder,rssList,mainFolder,startTime);
      else result = processGetEpisodeEmail(one,queue,rssList,mainFolder,startTime);
      if (!result || result.type === 'subscribe_search_pending') return;
      if (result.type === 'subscribe_invalid') sendInvalidSubscriptionEmail(result.error);
      // Save requests and dedup state before moving just this message to Trash.
      if (result.type === 'episode_queued' && result.ok) _emailsData.pendingEpisodeSummary.push(result);
      ids.push(entry.id);
      _emailsData.processedEmailIds = ids.slice(-200);
      saveStatusQueue(sysFolder,queue);
      saveEmailsData(sysFolder,_emailsData);
      entry.message.moveToTrash();
      processed.push(result);
    } catch(e) { Logger.log('⚠️ עיבוד מייל בקרה נכשל: '+e.message); }
  });
  return processed;
}


// ── unsubscribe ──
function processUnsubscribeEmail(thread, sysFolder, rssList) {
  var subject = thread.getMessages()[0].getSubject().trim();
  if (!subject.startsWith('http')) return null;
  var removed = removeFromPodcastsFile(sysFolder, subject);
  if (!removed) return { type: 'unsubscribe_notfound', url: subject };
  for (var i = rssList.length-1; i >= 0; i--) {
    if (rssList[i].url === subject) rssList.splice(i, 1);
  }
  return { type: 'unsubscribe', url: subject };
}

function removeFromPodcastsFile(sysFolder, urlToRemove) {
  var merged = parsePodcastsFiles(sysFolder);
  if (!merged.byUrl[urlToRemove]) return false;
  delete merged.byUrl[urlToRemove];
  for (var i = merged.order.length - 1; i >= 0; i--) {
    if (merged.order[i] === urlToRemove) { merged.order.splice(i, 1); break; }
  }
  writeMergedPodcastsFile(sysFolder, merged);
  Logger.log("🗑️  ערוץ הוסר מהרשימה: " + urlToRemove);
  return true;
}


// ── subscribe ──
function processSubscribeEmail(thread, sysFolder, rssList, mainFolder, startTime) {
  var parsed = parseSubscriptionInput(thread.getMessages()[0].getSubject().trim());
  if (parsed.error) return {type:'subscribe_invalid',error:parsed.error};
  if (parsed.url) {
    var current = rssList.filter(function(r) { return r.url === parsed.url; })[0];
    if (current && !!current.notifyOnly === parsed.notifyOnly) return {type:'subscribe_duplicate',url:parsed.url};
    addToPodcastsFile(sysFolder,parsed.url,null,current ? current.days : 7,parsed.notifyOnly);
    if (current) current.notifyOnly = parsed.notifyOnly;
    else rssList.push({url:parsed.url,days:7,notifyOnly:parsed.notifyOnly});
    return {type:current?'subscribe_changed':'subscribe_added',url:parsed.url,notifyOnly:parsed.notifyOnly};
  }
  if (!parsed.query) return null;
  var results = handleITunesRetry(parsed.query,sysFolder,startTime);
  if (results === null) return {type:'subscribe_search_pending',query:parsed.query};
  if (!results.length) { sendNoResultsEmail(parsed.query); return {type:'subscribe_no_results',query:parsed.query}; }
  sendPodcastSearchResultsEmail(parsed.query,results,mainFolder);
  return {type:'subscribe_search',query:parsed.query,count:results.length};
}

function addToPodcastsFile(sysFolder, url, comment, days, notifyOnly) {
  var merged = parsePodcastsFiles(sysFolder);
  if (!merged.byUrl[url]) {
    merged.byUrl[url] = {comment:comment || null,days:days || 7,notifyOnly:!!notifyOnly};
    merged.order.push(url);
  } else {
    merged.byUrl[url].notifyOnly = !!notifyOnly;
  }
  writeMergedPodcastsFile(sysFolder,merged);
}


// ── iTunes search ──
/**
 * מחזיר מערך תוצאות, null אם שגיאת שרת (יש לנסות שוב), [] אם אין תוצאות (שלח מייל)
 */
function searchITunesPodcasts(query) {
  var url  = 'https://itunes.apple.com/search?term='+encodeURIComponent(query)+'&entity=podcast&limit=15&country=IL';
  var resp;
  try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch(e) { Logger.log('⚠️  iTunes fetch error: '+e.message); return null; }
  if (resp.getResponseCode() !== 200) {
    Logger.log('⚠️  iTunes HTTP '+resp.getResponseCode());
    return null;  // שגיאת שרת — ניסיון חוזר
  }
  var data;
  try { data = JSON.parse(resp.getContentText()).results || []; }
  catch(e) { Logger.log('⚠️  iTunes parse error: '+e.message); return null; }
  return data.filter(function(p){ return !!p.feedUrl; }).map(function(p){
    return {
      title:        p.trackName || p.collectionName || '',
      author:       p.artistName || '',
      rssUrl:       p.feedUrl,
      image:        p.artworkUrl100 || null,
      episodeCount: p.trackCount || 0,
      lastDate:     p.releaseDate ? formatDate(new Date(p.releaseDate)) : ''
    };
  });
}

/** מחזיר אמת אם צריך לשלוח מייל שגיאת iTunes */
function handleITunesRetry(query, sysFolder, startTime) {
  // pending searches נשמרים ב-emails.json
  if (!_emailsData.pendingSearches) _emailsData.pendingSearches = {};
  var entry = _emailsData.pendingSearches[query] || { retries: 0 };
  var results = searchITunesPodcasts(query);
  if (results === null) {
    // שגיאת שרת
    entry.retries++;
    _emailsData.pendingSearches[query] = entry;
    if (entry.retries >= APPLE_API_MAX_RETRY) {
      delete _emailsData.pendingSearches[query];
      sendITunesErrorEmail(query, entry.retries);
    }
    return null;  // טיפול נדחה
  }
  delete _emailsData.pendingSearches[query];
  return results;  // [] אם ריק, מערך אחרת
}

function sendITunesErrorEmail(query, attempts) {
  var body = '<p>לא ניתן היה לחפש פודקאסטים עבור: <strong>'+query+'</strong></p>'
    +'<p>שגיאת תקשורת עם Apple Podcasts API לאחר '+attempts+' נסיונות.</p>'
    +'<p>נסה לחפש שוב מאוחר יותר או הכנס כתובת RSS ישירות.</p>'
    +'<div style="margin-top:16px;">'+buildAddChannelBtn()+'</div>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '⚠️ פודקאסטים 2.0 — חיפוש נכשל: '+query,
      htmlBody: _emailWrap('שגיאת חיפוש', body) });
  } catch(e) { Logger.log('⚠️  iTunes error email: '+e.message); }
}

function sendPodcastSearchResultsEmail(query, results, mainFolder) {
  var body = '<p>תוצאות חיפוש עבור: <span dir="auto">'+escapeHtml(query)+'</span></p>';
  results.forEach(function(r) {
    body += channelCard(r.title,r.rssUrl,r.image,'<p dir="auto">'+escapeHtml(r.author)+
      (r.episodeCount?' · '+r.episodeCount+' פרקים':'')+'</p>',mainFolder);
  });
  body += buildAddChannelBtn();
  try { MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'🔍 תוצאות חיפוש: '+query,htmlBody:_emailWrap('תוצאות חיפוש פודקאסטים',body)}); }
  catch(e) { Logger.log('⚠️ מייל חיפוש: '+e.message); }
}


// ── get episode ──
function sendNoResultsEmail(query) {
  var body = '<p style="color:#64748b;margin-bottom:16px;">לא נמצאו תוצאות עבור: <strong>'+query+'</strong></p>'
    +'<p>נסה לחפש עם מילות מפתח שונות (שם מגיש, נושא, שם תוכנית), או הכנס כתובת RSS ישירות.</p>'
    +'<div style="margin-top:20px;text-align:center;">'+buildAddChannelBtn()+'</div>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '🔍 פודקאסטים 2.0 — לא נמצאו תוצאות: '+query,
      htmlBody: _emailWrap('אין תוצאות חיפוש', body) });
  } catch(e) { Logger.log('⚠️  sendNoResultsEmail: '+e.message); }
}

function processGetEpisodeEmail(thread, queue, rssList, mainFolder, startTime) {
  var subject = thread.getMessages()[0].getSubject().trim();
  // אפשרות ב: JSON עם episodeGuid
  try {
    var parsed = JSON.parse(subject);
    if (parsed.channelUrl && parsed.episodeGuid) {
      var epInfo = addSpecificEpisodeToQueueEx(parsed.channelUrl, parsed.episodeGuid, queue, mainFolder);
      return { type: 'episode_queued', channelUrl: parsed.channelUrl, episodeGuid: parsed.episodeGuid,
               ok: epInfo.ok, channelTitle: epInfo.channelTitle, episodeTitle: epInfo.episodeTitle };
    }
  } catch(e) {}
  // אפשרות א: URL ערוץ — שלח קטלוג
  if (subject.startsWith('http')) {
    sendEpisodeCatalogEmail(subject, startTime);
    return { type: 'catalog_sent', url: subject };
  }
  return null;
}

/** הוספת פרק ספציפי לתור — גם אם הורד בעבר, גם אם הערוץ לא נמצא ברשימת המינויים */
function addSpecificEpisodeToQueueEx(channelUrl, episodeGuid, queue, mainFolder) {
  var RET = { ok: false, channelTitle: '', episodeTitle: '' };
  try {
    var resp = UrlFetchApp.fetch(channelUrl, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return RET;
    var doc     = XmlService.parse(resp.getContentText('UTF-8'));
    var channel = doc.getRootElement().getChild('channel');
    if (!channel) return RET;
    var ns      = XmlService.getNamespace(ITUNES_NS_URL);
    var chanTitle = channel.getChildText('title') || channelUrl;
    var chanImg   = getChannelCoverArtUrl(channel, ns);
    var chanAuthor= channel.getChildText('author', ns) || channel.getChildText('author') || '';
    var folderName= sanitizeFolderName(chanTitle);

    // וודא שתיקייה ותמונה קיימות (גם אם ערוץ לא ברשימה)
    var folder = getOrCreateFolder(mainFolder, folderName);
    savePodcastCoverArt(channel, folder, ns);

    var items = channel.getChildren('item');
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var candidateEnclosure = getEnclosureInfo(item);
      var guid = item.getChildText('guid') || (candidateEnclosure && candidateEnclosure.url) || '';
      if (guid !== episodeGuid) continue;
      var encl = getEnclosureInfo(item);
      if (!encl) return RET;
      var title  = item.getChildText('title') || 'פרק';
      var epNum  = item.getChildText('episode', ns) || '';
      var fileExt= getFileExtension(encl.url, encl.type);
      var existingRequest = queue.filter(function(q) { return q.url === encl.url; })[0];
      if (existingRequest) { existingRequest.source = 'manual'; existingRequest.rssUrl = channelUrl; RET.ok = true; RET.channelTitle = chanTitle; RET.episodeTitle = title; return RET; }
      queue.push({
        rssUrl:         channelUrl,
        source:         "manual",
        url:            encl.url,
        mimeType:       encl.type || 'audio/mpeg',
        fileName:       buildFileName(title, epNum, fileExt),
        folderName:     folderName,
        channelTitle:   chanTitle,
        channelImageUrl: chanImg,
        feedDays:       7,
        episodeTitle:   title,
        pubDate:        item.getChildText('pubDate') || '',
        author:         item.getChildText('author', ns) || chanAuthor,
        duration:       item.getChildText('duration', ns) || '',
        episodeNumber:  epNum,
        season:         item.getChildText('season', ns) || '',
        subtitle:       item.getChildText('subtitle', ns) || '',
        guid:           guid,
        description:    item.getChildText('description') || '',
        retryCount:     0,
        chunkState:     null,
        skipHistory:    true,   // הורד גם אם הורד בעבר
        fromSubscription: false  // ערוץ לא ברשימת המינויים
      });
      RET.ok = true; RET.channelTitle = chanTitle; RET.episodeTitle = title;
      Logger.log('📌 פרק ספציפי נוסף: '+title);
      return RET;
    }
  } catch(e) { Logger.log('⚠️  addSpecificEpisode: '+e.message); }
  return RET;
}

/** שליחת קטלוג פרקים לערוץ (מפוצל ל-50 פרקים למייל) */
function sendEpisodeCatalogEmail(channelUrl, startTime) {
  try {
    var resp = UrlFetchApp.fetch(channelUrl, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return;
    var doc     = XmlService.parse(resp.getContentText('UTF-8'));
    var channel = doc.getRootElement().getChild('channel');
    if (!channel) return;
    var ns      = XmlService.getNamespace(ITUNES_NS_URL);
    var chanTitle = channel.getChildText('title') || channelUrl;
    var chanImg   = getChannelCoverArtUrl(channel, ns);
    var items   = channel.getChildren('item');
    var total   = items.length;
    var pages   = Math.ceil(total / CATALOG_PER_EMAIL);

    for (var page = 0; page < pages; page++) {
      if (new Date() - startTime > TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) break;
      var start = page * CATALOG_PER_EMAIL;
      var end   = Math.min(start + CATALOG_PER_EMAIL, total);
      var body  = (pages > 1 ? '<p style="color:#64748b;margin-bottom:12px;">חלק '+(page+1)+' מתוך '+pages+'</p>' : '');

      for (var j = start; j < end; j++) {
        var item  = items[j];
        var title = item.getChildText('title') || 'פרק '+(j+1);
        var enc = getEnclosureInfo(item);
        var guid = item.getChildText('guid') || (enc && enc.url);
        if (!guid) continue;
        var pd    = item.getChildText('pubDate') || '';
        var pdFmt = pd ? formatDate(new Date(pd)) : '';
        var dur   = item.getChildText('duration', ns) || '';
        var desc  = (item.getChildText('description') || '').replace(/<[^>]*>/g,'').substring(0,150);
        var getBtn = buildMailtoBtn('קבל פרק זה', CTRL_GET_EPISODE,
          JSON.stringify({ channelUrl: channelUrl, episodeGuid: guid }),
          'שלח מייל זה על מנת להוסיף את הפרק \''+title+'\' מערוץ \''+chanTitle+'\' לרשימת ההורדות. הבקשה תטופל תוך מספר שעות.\n\n'+PRIVACY_NOTE);
        body += '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">'
          +'<div dir="auto" style="font-weight:600;margin-bottom:3px;">'+escapeHtml(title)+'</div>'
          +'<div style="color:#94a3b8;font-size:.8rem;margin-bottom:4px;">'+pdFmt+(dur?' | '+dur:'')+'</div>'
          +(desc?'<div style="color:#64748b;font-size:.82rem;margin-bottom:6px;">'+escapeHtml(desc)+'</div>':'')
          +getBtn+'</div>';
      }

      MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
        subject: '📻 '+chanTitle+' — קטלוג פרקים'+(pages>1?' ('+( page+1)+'/'+pages+')':''),
        htmlBody: _emailWrap('קטלוג: '+chanTitle, '<div dir="rtl" style="direction:rtl;text-align:right;margin-bottom:12px;">'+channelImgTag(chanImg)+'<strong dir="auto">'+escapeHtml(chanTitle)+'</strong></div>'+buildChannelControlButtons(chanTitle,channelUrl)+body) });
    }
  } catch(e) { Logger.log('⚠️  sendEpisodeCatalogEmail: '+e.message); }
}


// =====================================================================
// sendProcessedEmailsSummary — סיכום מיילי בקרה שטופלו
// =====================================================================
function sendProcessedEmailsSummary(items) {
  // שולח מייל רק עבור פרקים ספציפיים שנוספו לתור — שאר הפעולות כבר מקבלות מייל ייעודי
  var episodeItems = (items || []).filter(function(it){ return it.type === 'episode_queued' && it.ok; });
  if (!episodeItems.length) return true;
  var body = '<p style="color:#64748b;margin-bottom:14px;">הפרקים הבאים נוספו לתור ההורדות לפי בקשתך:</p>';
  episodeItems.forEach(function(it){
    body += '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:.9rem;">'
      +'<span style="font-weight:600;">'+escapeHtml(it.episodeTitle||'פרק')+'</span>'
      +(it.channelTitle?'<span dir="auto" style="color:#64748b;font-size:.82rem;margin-right:8px;"> — '+escapeHtml(it.channelTitle)+'</span>':'')
      +buildChannelControlButtons(it.channelTitle,it.channelUrl)
      +'</div>';
  });
  body += '<p style="color:#94a3b8;font-size:.82rem;margin-top:12px;">הפרקים יורדו בריצה הקרובה.</p>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '📥 פודקאסטים 2.0 — '+episodeItems.length+' פרקים נוספו לתור',
      htmlBody: _emailWrap('פרקים בתור הורדה', body) });
    return true;
  } catch(e) { Logger.log('⚠️  סיכום פרקים: '+e.message); return false; }
}

// Subscription parsing is shared by TXT imports and control email subjects.
function parseSubscriptionInput(input) {
  var text = String(input || '').trim(), notifyOnly = false;
  if (/(?:^|\s)--notify-only$/.test(text)) {
    notifyOnly = true;
    text = text.replace(/(?:^|\s)--notify-only$/, '').trim();
  }
  if (/(?:^|\s)--\S+/.test(text)) return {error:'דגל הרשמה לא מוכר; השתמש ב־--notify-only'};
  if (/^https?:\/\//i.test(text)) {
    if (/\s/.test(text)) return {error:'כתובת RSS אינה יכולה להכיל רווחים'};
    return {url:text,notifyOnly:notifyOnly};
  }
  return {query:text,notifyOnly:notifyOnly};
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildSubscriptionButton(title, rssUrl, notifyOnly) {
  return buildMailtoBtn(notifyOnly ? 'הירשם להתראות בלבד' : 'הירשם', CTRL_SUBSCRIBE,
    rssUrl + (notifyOnly ? ' --notify-only' : ''),
    'שלח מייל זה '+(notifyOnly?'לקבלת התראות שבועיות בלבד, ללא הורדה אוטומטית':'להפעלת הורדה אוטומטית')+
    ' עבור הערוץ '+title+'.\n\n'+PRIVACY_NOTE,notifyOnly?'#b45309':'#059669');
}

function buildGetEpisodeButton(channelTitle, episodeTitle, rssUrl, guid) {
  if (!rssUrl || !guid) return '';
  return buildMailtoBtn('קבל פרק', CTRL_GET_EPISODE,
    JSON.stringify({channelUrl:rssUrl,episodeGuid:guid}),
    'שלח מייל זה לבקשת הפרק '+episodeTitle+' מהערוץ '+channelTitle+
    '. סוג ההרשמה לערוץ לא ישתנה.\n\n'+PRIVACY_NOTE);
}

function channelCard(title, rssUrl, image, content, mainFolder) {
  return '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="direction:rtl;text-align:right;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:14px;">'+
    '<tr><td dir="rtl" style="direction:rtl;text-align:right;padding:12px;background:#f8fafc;">'+
    channelImgTag(image)+' <span style="margin-right:8px;">'+channelNameTag(title,mainFolder)+'</span>'+
    '<div dir="rtl" style="direction:rtl;text-align:right;margin-top:8px;">'+buildChannelControlButtons(title,rssUrl)+'</div></td></tr>'+
    '<tr><td dir="rtl" style="direction:rtl;text-align:right;padding:12px;">'+content+'</td></tr></table>';
}

function hasNotifyOnlySubscriptions(rssList) {
  return rssList.some(function(r) { return r.notifyOnly; });
}

// Resolve old records only when exactly one known feed matches the channel title.
function knownFeedUrl(item, rssList, emailsData) {
  if (item.rssUrl && item.rssUrl !== item.url && rssList.some(function(r) { return r.url === item.rssUrl; })) return item.rssUrl;
  var details = emailsData.subscriptions.details || {};
  var candidates = Object.keys(details).filter(function(url) {
    return details[url].title === item.channelTitle;
  });
  (emailsData.subscriptions.list || []).concat(rssList).forEach(function(r) {
    if (r.url === item.rssUrl && candidates.indexOf(r.url) < 0) candidates.push(r.url);
  });
  if (candidates.length === 1) return candidates[0];
  return null;
}

function repairSavedFeedUrls(queue, emailsData, rssList) {
  queue.forEach(function(it) {
    if (!it.source) it.source = it.fromSubscription === false ? 'manual' : 'automatic';
    if (!it.rssUrl) it.rssUrl = knownFeedUrl(it,rssList,emailsData);
  });
  emailsData.storage.pending.forEach(function(it) {
    it.rssUrl = knownFeedUrl(it,rssList,emailsData);
  });
  Object.keys(emailsData.weekly.channels).forEach(function(key) {
    var d = emailsData.weekly.channels[key];
    if (!d.title) d.title = key;
    // Old weekly.rssUrl actually held an audio URL.
    if (!d.items.some(function(it) { return it.rssUrl === d.rssUrl; })) {
      d.rssUrl = knownFeedUrl({channelTitle:d.title},rssList,emailsData);
    }
  });
}

function reconcileAutomaticQueue(queue, rssList, emailsData) {
  repairSavedFeedUrls(queue,emailsData,rssList);
  var notify = {};
  rssList.forEach(function(r) { if (r.notifyOnly) notify[r.url] = true; });
  for (var i = queue.length - 1; i >= 0; i--) {
    if (queue[i].source !== 'manual' && notify[queue[i].rssUrl]) queue.splice(i,1);
  }
  emailsData.storage.pending = emailsData.storage.pending.filter(function(it) {
    return it.source === 'manual' || !notify[it.rssUrl];
  });
}

function sendInvalidSubscriptionEmail(error) {
  MailApp.sendEmail({to:Session.getEffectiveUser().getEmail(),subject:'⚠️ פודקאסטים 2.0 — בקשת הרשמה לא תקינה',
    htmlBody:_emailWrap('לא שינינו את ההרשמה','<p>'+escapeHtml(error)+'</p><p>דוגמה לנושא תקין:</p><pre dir="ltr" style="direction:ltr;text-align:left;">https://example.com/feed.xml --notify-only</pre>')});
}
