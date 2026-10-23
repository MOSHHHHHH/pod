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
var CATALOG_PER_EMAIL    = 50; // Legacy setting retained; catalogs now use byte limits.
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
var _podkiRunStart = null;
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
  _podkiRunStart = startTime;
  _podkiFeedCache = {};
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
  podkiPumpJobs(sysFolder, queue, mainFolder, startTime);
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

  return queue.length > 0 || needStorage || needWeekly || needSubs || podkiState().jobs.length > 0;
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
  podkiWriteStateFile(sysFolder, STATUS_FILE_NAME, queue);
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
    podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'⚠️ פרק לא הורד אחרי '+MAX_RETRIES+' נסיונות — '+item.channelTitle,
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
  var body = '<p><strong>היי, נעים להכיר — אני פודקי 🎧</strong></p>' +
    '<p>אני בוט הפודקאסטים שלך, ופועל בחשבון Google שלך בריצות אוטומטיות פעם בשעה. אפשר להתחיל בהוספת ערוץ באמצעות הכפתור הבא. בנושא המייל שייפתח יש להזין כתובת RSS או שם פודקאסט לחיפוש, ולשלוח.</p>' +
    buildAddChannelBtn() +
    '<h2 style="font-size:18px;">איך רוצים לעקוב אחר הערוצים?</h2>' +
    '<p><strong>הירשם</strong> — פרקים חדשים יורדו אוטומטית לתיקיית הערוץ בדרייב.</p>' +
    '<p><strong>הירשם להתראות בלבד</strong> — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית. ליד כל פרק יופיע <strong>קבל פרק</strong>, כדי לבקש רק את הפרקים הרצויים לך.</p>' +
    '<p>אפשר לשנות את סוג ההרשמה או להסיר ערוץ באמצעות הכפתורים שלידו במיילים. הכפתור קבל פרק אינו משנה את סוג ההרשמה.</p>' +
    '<h2 style="font-size:18px;">רוצים לבחור מתוך פרקים קודמים?</h2>' +
    '<p>הכפתור <strong>קבל פרקים</strong> שליד כל ערוץ שולח קטלוג של הפרקים הזמינים כרגע בפיד. בקטלוג קצר אפשר לבקש פרק בודד ישירות מהמייל. בכל קטלוג מצורף גם קובץ HTML לחיפוש בכותרות ובתיאורים, מיון ובחירת כמה פרקים יחד. קטלוג גדול במיוחד נשמר בדרייב שלך ונשלח קישור פרטי להורדתו.</p>' +
    '<p><strong>בקשה של כמה פרקים:</strong> הורד את קובץ ה-HTML ופתח אותו בדפדפן, סמן פרקים והורד את קובץ הבחירה JSON. פתח מייל לכתובת קבלת הפרקים באמצעות הכפתור בקטלוג, צרף אליו את ה-JSON ושלח. אין צורך בנושא מיוחד, ואפשר להשאירו ריק. פתיחת מייל אינה מצרפת את הקובץ אוטומטית. ניתן לבחור עד 1,000 פרקים בקובץ אחד; בקשות גדולות יטופלו בהדרגה בין ריצות.</p>' +
    '<p>יש לפתוח את ה-HTML בדפדפן ולא בתצוגה המקדימה של Gmail. באנדרואיד יש להשתמש בדפדפן שתומך בקובצי HTML מקומיים. התיאורים עשויים להיות מקוצרים, והקטלוג אינו מבטיח לכלול פרקים ישנים שהמפרסם הסיר מהפיד.</p>' +
    '<h2 style="font-size:18px;">חיפוש פרק מסוים</h2>' +
    '<p>לחץ על <strong>חפש פרק</strong> בתחתית כל הודעה, כתוב בנושא שם פרק, שם מגיש או מילות חיפוש ושלח. אחפש פרקים באפל פודקאסטים ואשלח תוצאות עם כפתור קבל פרק. הזמינות תלויה בקטלוג של אפל ובמפרסם. לחיפוש ערוץ שלם השתמש בהוסף ערוץ.</p>' +
    '<p>קובצי JSON מזוהים אוטומטית. נושא ההודעה נבדק בנפרד גם כשמצורף קובץ: טקסט חופשי יבצע בנוסף חיפוש, כתובת RSS תבקש בנוסף קטלוג, ובקשת JSON בנושא תמשיך לפעול כבעבר. בחירת פרקים אינה משנה את המינוי לערוץ.</p>' +
    '<h2 style="font-size:18px;">ניהול ידני בדרייב</h2>' +
    '<p>אפשר לערוך את הקובץ <span dir="ltr">podcasts.txt</span> בתיקיית פודקאסטים 2.0, בתוך תיקיית קבצי מערכת.</p>' +
    '<p>להרשמה רגילה מוסיפים כתובת RSS בשורה נפרדת. להתראות בלבד מוסיפים בסוף אותה שורה רווח ואת הדגל <span dir="ltr">--notify-only</span>. אפשר להשתמש באותו דגל גם בסוף נושא מייל ההרשמה.</p>' +
    '<p>בשורה שאחרי כתובת הערוץ אפשר להוסיף מספר ימים לסריקה לאחור. ברירת המחדל היא שבעה ימים. שורות שמתחילות בסימן # הן הערות.</p>' +
    '<p><strong>דוגמת קובץ TXT תקינה מבחינת התחביר:</strong></p>' +
    '<pre dir="ltr" style="direction:ltr;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;padding:12px;font-family:monospace;">'+escapeHtml(example)+'</pre>' +
    '<p>הכתובות בדוגמה הן להמחשה בלבד. יש להחליף אותן בכתובות RSS אמיתיות של הערוצים שלך.</p>' +
    '<h2 style="font-size:18px;">הדיווח השבועי</h2>' +
    '<p>המייל השבועי יכלול דוח הורדות ופרקים חדשים מערוצי התראות בלבד, עם הבחנה ברורה ביניהם. דוח ארוך יפוצל להודעות ממוספרות; אם השליחה נעצרת, היא תימשך מהחלק הבא בריצה הבאה. לאחר הרשמה, הסריקה הראשונה כוללת את טווח הימים המוגדר לערוץ.</p>' +
    '<h2 style="font-size:18px;">כדאי לדעת</h2>' +
    '<p>הטיפול בבקשות מתבצע בריצות האוטומטיות, ולכן עשוי להימשך מספר שעות. אפשר לשלוח כמה בקשות בלי להמתין לטיפול בקודמת. ניתן להריץ ידנית את הפונקציה <span dir="ltr">setUp</span> בפרויקט Apps Script.</p>' +
    '<p>אפשר למחוק קובצי פרקים שכבר הורדת. חשוב לשמור את תיקיית <strong>קבצי מערכת</strong>, שבה נמצאים המינויים, ההיסטוריה וההתקדמות.</p>' +
    '<p>לא קיבלת מייל? בדוק ספאם וקידומים ואת הרשאות הפרויקט. ביומן הרצות בפרויקט אפשר לבדוק אם התרחשה שגיאה.</p>' +
    '<h2 style="font-size:18px;">פרטיות</h2>' +
    '<p>פקודות המייל מעובדות מתוך תיבת נשלח. מיילים לכתובות הבקרה הייעודיות גלויים למנהל השירות ונאספים בהתאם למדיניות הפרטיות. עריכה ידנית של קובץ המינויים אינה שולחת פקודת מייל; איסוף כתובת המייל בכל ריצה, כפי שמתואר במדיניות הקיימת, ממשיך לחול.</p>';
  try {
    podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'🎉 פודקאסטים 2.0 — המערכת מוכנה לשימוש',htmlBody:_emailWrap('ברוכים הבאים למערכת',body)});
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
  podkiWriteStateFile(sysFolder, HISTORY_FILE_NAME, history);
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
  podkiWriteStateFile(sysFolder, EMAILS_FILE_NAME, data);
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
  var body = '<p>היי, פודקי כאן. אני ממתין למקום פנוי בדרייב: נותרו פחות מ־2GiB. ההורדות הבאות נשמרו בתור ולא בוטלו.</p>';
  Object.keys(groups).forEach(function(key) {
    var d = groups[key], content = '';
    d.items.forEach(function(it) { content += '<p dir="auto">'+escapeHtml(it.episodeTitle)+'</p>'; });
    body += channelCard(d.title,d.rssUrl,d.image,content,mainFolder);
  });
  body += '<p>פנה מקום בדרייב. אנסה להמשיך את ההורדות בריצות הבאות. אין צורך לבקש שוב את אותם פרקים.</p>'+buildAddChannelBtn();
  try {
    podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'💾 פודקאסטים 2.0 — נפח אחסון נמוך',htmlBody:_emailWrap('פרקים ממתינים לאחסון',body)});
    emailsData.storage.nextSendAt = _daysFromNow(STORAGE_EMAIL_DAYS);
    return true;
  } catch(e) { Logger.log('⚠️ מייל אחסון נכשל: '+e.message); return false; }
}


// =====================================================================
// sendSubscriptionEmail — עם קישורים וכפתורים
// =====================================================================
function sendSubscriptionEmail(rssList, sysFolder, emailsData, startTime, mainFolder) {
  _rssList = rssList;
  var body = '<p>היי! עדכנתי את רשימת הערוצים שלך. ליד כל ערוץ מופיעים סוג ההרשמה וטווח הסריקה. אפשר לשנות מצב בלי ליצור הרשמה כפולה.</p>', details = emailsData.subscriptions.details;
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
    podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'📋 פודקאסטים 2.0 — רשימת מינויים עודכנה',htmlBody:_emailWrap('עדכון רשימת מינויים',body)});
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
    podkiSendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '⚠️ פודקאסטים 2.0 — חיפוש נכשל: '+query,
      htmlBody: _emailWrap('שגיאת חיפוש', body) });
  } catch(e) { Logger.log('⚠️  iTunes error email: '+e.message); }
}

function sendPodcastSearchResultsEmail(query, results, mainFolder) {
  var body = '<p>היי! חיפשתי עבורך ערוצים באפל פודקאסטים עבור: <span dir="auto">'+escapeHtml(query)+'</span></p>';
  results.forEach(function(r) {
    body += channelCard(r.title,r.rssUrl,r.image,'<p dir="auto">'+escapeHtml(r.author)+
      (r.episodeCount?' · '+r.episodeCount+' פרקים':'')+'</p>',mainFolder);
  });
  body += buildAddChannelBtn();
  try { podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'🔍 תוצאות חיפוש: '+query,htmlBody:_emailWrap('תוצאות חיפוש פודקאסטים',body)}); }
  catch(e) { Logger.log('⚠️ מייל חיפוש: '+e.message); }
}


// ── get episode ──
function sendNoResultsEmail(query) {
  var body = '<p style="color:#64748b;margin-bottom:16px;">לא נמצאו תוצאות עבור: <strong>'+query+'</strong></p>'
    +'<p>נסה לחפש עם מילות מפתח שונות (שם מגיש, נושא, שם תוכנית), או הכנס כתובת RSS ישירות.</p>'
    +'<div style="margin-top:20px;text-align:center;">'+buildAddChannelBtn()+'</div>';
  try {
    podkiSendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '🔍 פודקאסטים 2.0 — לא נמצאו תוצאות: '+query,
      htmlBody: _emailWrap('אין תוצאות חיפוש', body) });
  } catch(e) { Logger.log('⚠️  sendNoResultsEmail: '+e.message); }
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
    podkiSendEmail({ to: Session.getEffectiveUser().getEmail(),
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
  podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'⚠️ פודקאסטים 2.0 — בקשת הרשמה לא תקינה',
    htmlBody:_emailWrap('לא שינינו את ההרשמה','<p>'+escapeHtml(error)+'</p><p>דוגמה לנושא תקין:</p><pre dir="ltr" style="direction:ltr;text-align:left;">https://example.com/feed.xml --notify-only</pre>')});
}



/** Podki feature source; bundled into podcast_processor_v2.js. No GS changes needed. */
var PODKI_VERSION = '4.0';
var PODKI_BODY_BYTES = 70 * 1024;
var PODKI_ATTACHMENT_BYTES = 18 * 1024 * 1024;
var PODKI_REQUEST_BYTES = 2 * 1024 * 1024;
var PODKI_MAX_SELECTION = 1000;
var PODKI_ASSETS = 'https://cdn.jsdelivr.net/gh/MOSHHHHHH/pod@main/assets/podki/';
var _podkiFeedCache = {};

function podkiState() {
  if (!_emailsData) _emailsData = {};
  if (!_emailsData.podki) _emailsData.podki = {jobs:[], receipts:{}, appleResults:{}};
  var p = _emailsData.podki;
  if (!p.jobs) p.jobs = [];
  if (!p.receipts) p.receipts = {};
  if (!p.appleResults) p.appleResults = {};
  return p;
}

function podkiBytes(text) {
  return Utilities.newBlob(String(text), 'text/plain').getBytes().length;
}

function podkiWriteStateFile(folder, name, value) {
  if (!folder) throw new Error('תיקיית המערכת אינה זמינה לשמירת מצב.');
  var it=folder.getFilesByName(name),old=[];
  while(it.hasNext())old.push(it.next());
  // Do not retire the current state until a replacement exists.
  folder.createFile(name,JSON.stringify(value),MimeType.PLAIN_TEXT);
  old.forEach(function(file){file.setTrashed(true);});
}

function podkiUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^\s<>"\\]+$/i.test(url) && url.length <= 8192;
}

function podkiFooter() {
  return '<p style="margin:20px 0 8px;">'+buildAddChannelBtn()+buildMailtoBtn('חפש פרק',CTRL_GET_EPISODE,'',
    'כתוב בנושא המייל את שם הפרק, שם מגיש או מילות החיפוש ושלח. לחיפוש ערוץ השתמש בכפתור הוסף ערוץ.\n\n'+PRIVACY_NOTE,'#1d4ed8')+'</p>'+
    '<p style="font-size:12px;color:#64748b;">אני פועל בריצות האוטומטיות של הסקריפט, בדרך כלל פעם בשעה. הטיפול עשוי להימשך כמה שעות. לחיצה על כפתור פותחת מייל מוכן; יש לשלוח אותו כדי לבצע את הפעולה.</p>'+
    '<p style="font-size:11px;color:#64748b;">פקודות וקובצי בחירה שנשלחים לכתובות הבקרה גלויים למנהל השירות ומעובדים אוטומטית בהתאם למדיניות השירות. עריכה ידנית של podcasts.txt אינה שולחת פקודת מייל; דיווח כתובת המשתמש לטופס בכל ריצה נשאר כפי שמוגדר במערכת.</p>';
}

function podkiMood(title) {
  if (/שגיא|נכשל|תקלה|תיקון/.test(title)) return 'error';
  if (/חיפוש|תוצאות/.test(title)) return 'search';
  if (/קטלוג/.test(title)) return 'catalog';
  if (/אחסון|ממתינ|תור/.test(title)) return 'waiting';
  if (/ברוכ|היכרות/.test(title)) return 'welcome';
  return 'success';
}

function _emailWrap(title, body) {
  var mood = podkiMood(title);
  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"></head><body dir="rtl" style="direction:rtl;text-align:right;margin:0;padding:12px;background:#edf4fb;font-family:Arial,sans-serif;color:#17324d;">'+
    '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'+
    '<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:white;direction:rtl;text-align:right;border-radius:18px;">'+
    '<tr><td dir="rtl" style="padding:22px;background:#e1efff;direction:rtl;text-align:right;">'+
    '<img src="'+PODKI_ASSETS+mood+'.png" alt="פודקי — בוט הפודקאסטים שלך" width="88" height="88" style="vertical-align:middle;object-fit:contain;">'+
    '<h1 style="font-size:25px;margin:8px 0;">פודקי 🎧</h1><p style="margin:0;">'+escapeHtml(title)+'</p></td></tr>'+
    '<tr><td dir="rtl" style="direction:rtl;text-align:right;padding:20px;line-height:1.75;overflow-wrap:anywhere;">'+body+podkiFooter()+'</td></tr>'+
    '<tr><td dir="rtl" style="padding:14px;text-align:center;color:#64748b;font-size:11px;">פודקי · בוט הפודקאסטים שלך · גרסה '+PODKI_VERSION+' · '+escapeHtml(formatDate(new Date()))+'</td></tr>'+
    '</table></td></tr></table></body></html>';
}

// Used by every JS-originated message. Sender address remains the account running GAS.
function podkiSendEmail(message) {
  message.name = 'פודקי — בוט הפודקאסטים שלך';
  message.subject = String(message.subject || 'עדכון מפודקי').replace(/פודקאסטים 2\.0/g,'פודקי');
  if (message.subject.indexOf('פודקי') < 0) message.subject = 'פודקי | '+message.subject;
  if (!message.body) message.body = 'היי, כאן פודקי. הודעה זו כוללת עדכון על בקשת הפודקאסטים שלך. לצפייה בפרטים ובכפתורי הפעולה פתח אותה בתצוגת HTML. קובץ מצורף, אם קיים, יש להוריד ולפתוח בדפדפן.';
  if (MailApp.getRemainingDailyQuota && MailApp.getRemainingDailyQuota() < 1) throw new Error('מכסת שליחת המיילים להיום הסתיימה; אנסה שוב בריצה הבאה.');
  if (message.htmlBody && podkiBytes(message.htmlBody) > 190 * 1024) throw new Error('גוף ההודעה גדול מדי לשליחה בטוחה.');
  MailApp.sendEmail(message);
}

function podkiEnqueueJob(type, payload, id) {
  var p=podkiState();
  if (p.receipts[id] || p.jobs.some(function(j){return j.id===id;})) return false;
  p.jobs.push({id:id,type:type,payload:payload,index:0,results:[],attempts:0,createdAt:new Date().toISOString()});
  return true;
}

function podkiSelection(data) {
  var entries;
  if (Array.isArray(data)) entries=data;
  else if (data && data.channelUrl && data.episodeGuid) entries=[data];
  else if (data && Array.isArray(data.episodes)) {
    if (data.version !== undefined && data.version !== 1) throw new Error('גרסת קובץ הבקשה אינה נתמכת. יש לייצא בחירה חדשה מהקטלוג.');
    entries=data.episodes;
  } else throw new Error('לא נמצאה בקובץ רשימת פרקים מוכרת. יש לצרף את קובץ ה-JSON שהקטלוג ייצר.');
  if (!entries.length) throw new Error('קובץ הבחירה ריק. יש לסמן לפחות פרק אחד בקטלוג.');
  if (entries.length>PODKI_MAX_SELECTION) throw new Error('אפשר לבקש עד '+PODKI_MAX_SELECTION+' פרקים בקובץ אחד. פצל את הבחירה.');
  var seen={}, episodes=[], errors=[];
  entries.forEach(function(e,i){
    if (!e || !podkiUrl(e.channelUrl) || typeof e.episodeGuid!=='string' || !e.episodeGuid || e.episodeGuid.length>8192) {
      errors.push('פריט '+(i+1)+': חסרה כתובת RSS תקינה או מזהה פרק.'); return;
    }
    var key=JSON.stringify([e.channelUrl,e.episodeGuid]);
    if (seen[key]) return;
    seen[key]=true;
    episodes.push({channelUrl:e.channelUrl,episodeGuid:e.episodeGuid,appleTrackId:e.appleTrackId || null,
      episodeTitle:String(e.episodeTitle || '').slice(0,500),channelTitle:String(e.channelTitle || '').slice(0,500)});
  });
  return {episodes:episodes,errors:errors};
}

function processGetEpisodeEmail(thread, queue, rssList, mainFolder, startTime) {
  var message=thread.getMessages()[0], subject=message.getSubject().trim();
  var messageId=message.getId ? message.getId() : String(Date.now());
  var attachments=message.getAttachments ? message.getAttachments({includeInlineImages:false,includeAttachments:true}) : [];
  var jobs=0, errors=[], attached=0;
  attachments.forEach(function(a,i){
    var name=a.getName ? a.getName() : 'קובץ';
    var mime=a.getContentType ? a.getContentType() : '';
    if (!/\.json$/i.test(name) && !/application\/(?:[a-z.+-]*\+)?json/i.test(mime)) {
      errors.push('הקובץ '+name+' אינו קובץ בחירה JSON ולכן לא טופל.'); return;
    }
    try {
      if (a.getSize && a.getSize()>PODKI_REQUEST_BYTES) throw new Error('הקובץ גדול מ-2MiB. פצל את הבחירה.');
      var text=a.getDataAsString('UTF-8');
      if(podkiBytes(text)>PODKI_REQUEST_BYTES) throw new Error('הקובץ גדול מ-2MiB. פצל את הבחירה.');
      var data=JSON.parse(text.replace(/^\uFEFF/,'')), parsed=podkiSelection(data);
      errors=errors.concat(parsed.errors);
      if(parsed.episodes.length){
        var requestId=data && typeof data.requestId==='string' && data.requestId.length<=200 ? data.requestId : messageId+':'+i;
        if(podkiEnqueueJob('episodes',parsed.episodes,'selection:'+requestId)) jobs++;
        else errors.push('הבחירה שבקובץ '+name+' כבר נקלטה. לא נוספו הורדות כפולות.');
        attached++;
      }
    }catch(e){errors.push(name+': '+e.message);}
  });
  // The subject is always inspected independently. No reserved subject or required keyword.
  if(subject){
    if (/^[\[{]/.test(subject)) {
      try {
        var subjectSelection=podkiSelection(JSON.parse(subject));
        errors=errors.concat(subjectSelection.errors);
        if(subjectSelection.episodes.length && podkiEnqueueJob('episodes',subjectSelection.episodes,'subject:'+messageId)) jobs++;
      } catch(e){errors.push('נושא ההודעה אינו בקשת JSON תקינה: '+e.message);}
    }else if(podkiUrl(subject)){
      if(podkiEnqueueJob('catalog',{url:subject},'catalog:'+messageId)) jobs++;
    }else{
      if(podkiEnqueueJob('search',{query:subject.slice(0,500)},'search:'+messageId)) jobs++;
    }
  }
  if(!subject && !attachments.length) errors.push('לא נמצא קובץ בחירה או נושא לחיפוש. צרף JSON, כתוב מילות חיפוש בנושא, או כתובת RSS לקבלת קטלוג.');
  if(errors.length) podkiEnqueueJob('notice',{errors:errors,accepted:jobs},'notice:'+messageId);
  return {type:'podki_requests',jobs:jobs,attachedSelections:attached,errors:errors.length};
}

function podkiReadFeed(url) {
  if(_podkiFeedCache[url]) return _podkiFeedCache[url];
  var resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
  if(resp.getResponseCode()!==200) throw new Error('לא ניתן לקרוא את פיד הערוץ (HTTP '+resp.getResponseCode()+').');
  var channel=XmlService.parse(resp.getContentText('UTF-8')).getRootElement().getChild('channel');
  if(!channel) throw new Error('הכתובת אינה פיד RSS נתמך.');
  var ns=XmlService.getNamespace(ITUNES_NS_URL),title=channel.getChildText('title') || url;
  var result={url:url,title:title,image:getChannelCoverArtUrl(channel,ns),channel:channel,episodes:[]};
  var author=channel.getChildText('author',ns) || channel.getChildText('author') || '';
  channel.getChildren('item').forEach(function(item){
    var encl=getEnclosureInfo(item); if(!encl || !podkiUrl(encl.url)) return;
    result.episodes.push({channelUrl:url,episodeGuid:item.getChildText('guid') || encl.url,
      episodeTitle:item.getChildText('title') || 'פרק ללא כותרת',channelTitle:title,
      episodeUrl:encl.url,mimeType:encl.type || 'audio/mpeg',pubDate:item.getChildText('pubDate') || '',
      duration:item.getChildText('duration',ns) || '',author:item.getChildText('author',ns) || author,
      episodeNumber:item.getChildText('episode',ns) || '',season:item.getChildText('season',ns) || '',
      subtitle:item.getChildText('subtitle',ns) || '',description:(item.getChildText('description') || '').replace(/<[^>]*>/g,'').slice(0,1200)});
  });
  _podkiFeedCache[url]=result; return result;
}

function podkiQueueEpisode(request,queue) {
  var feed=null,episode=null,lastError='';
  try {
    feed=podkiReadFeed(request.channelUrl);
    episode=feed.episodes.filter(function(e){return e.episodeGuid===request.episodeGuid || e.episodeUrl===request.episodeGuid;})[0];
  }catch(e){lastError=e.message;}
  if(!episode){
    // Direct audio fallback comes only from server-side Apple results, never arbitrary attachment fields.
    var key=JSON.stringify([request.channelUrl,request.episodeGuid]);
    var cached=podkiState().appleResults[key];
    if(cached && podkiUrl(cached.episodeUrl) && (!request.appleTrackId || String(cached.appleTrackId)===String(request.appleTrackId))) episode=cached;
  }
  if(!episode) return {status:'failed',episodeTitle:request.episodeTitle || request.episodeGuid,
    channelTitle:request.channelTitle || request.channelUrl,channelUrl:request.channelUrl,
    error:lastError || 'הפרק אינו זמין עוד בפיד, ולא נמצאה כתובת אודיו מאומתת מתוצאות אפל.'};
  var existing=queue.filter(function(q){return q.url===episode.episodeUrl;})[0];
  var status='queued';
  if(existing){existing.source='manual';existing.rssUrl=request.channelUrl;status='already';}
  else{
    var ext=getFileExtension(episode.episodeUrl,episode.mimeType);
    queue.push({rssUrl:request.channelUrl,source:'manual',url:episode.episodeUrl,mimeType:episode.mimeType || 'audio/mpeg',
      fileName:buildFileName(episode.episodeTitle,episode.episodeNumber || '',ext),folderName:sanitizeFolderName(episode.channelTitle),
      channelTitle:episode.channelTitle,channelImageUrl:feed ? feed.image : episode.image,
      episodeTitle:episode.episodeTitle,pubDate:episode.pubDate,duration:episode.duration,author:episode.author || '',
      guid:episode.episodeGuid,description:episode.description || '',subtitle:episode.subtitle || '',season:episode.season || '',
      episodeNumber:episode.episodeNumber || '',feedDays:7,retryCount:0,chunkState:null,skipHistory:true,fromSubscription:false});
  }
  return {status:status,episodeTitle:episode.episodeTitle,channelTitle:episode.channelTitle,channelUrl:request.channelUrl};
}

function podkiPumpJobs(sysFolder,queue,mainFolder,startTime) {
  var p=podkiState(),n=0;
  while(p.jobs.length && n<30 && hasEnoughTimeForEmails(startTime)){
    var job=p.jobs[0];
    try{
      if(job.type==='episodes'){
        while(job.index<job.payload.length && n<30 && hasEnoughTimeForEmails(startTime)){
          job.results.push(podkiQueueEpisode(job.payload[job.index],queue));job.index++;n++;
          saveStatusQueue(sysFolder,queue); saveEmailsData(sysFolder,_emailsData);
        }
        if(job.index<job.payload.length) break;
        podkiSendRequestSummary(job.results,mainFolder);
      }else if(job.type==='catalog'){
        sendEpisodeCatalogEmail(job.payload.url,startTime);
      }else if(job.type==='search'){
        podkiSendEpisodeSearch(job.payload.query,mainFolder);
      }else if(job.type==='notice'){
        podkiSendNotice(job.payload);
      }
      p.receipts[job.id]=new Date().toISOString();p.jobs.shift();n++;
      var receipts=Object.keys(p.receipts);
      if(receipts.length>500) receipts.sort(function(a,b){return p.receipts[a]<p.receipts[b]?-1:1;}).slice(0,receipts.length-500).forEach(function(k){delete p.receipts[k];});
      saveEmailsData(sysFolder,_emailsData);
    }catch(e){
      Logger.log('⚠️ פודקי — משימה ממתינה: '+e.message);
      // Delivery failures must retain completed work; no duplicate downloads on retry.
      job.lastError=e.message;job.attempts=(job.attempts || 0)+1;
      if(job.type!=='episodes' && job.attempts>=4){job.type='notice';job.payload={accepted:0,errors:['לא הצלחתי להשלים את הבקשה לאחר כמה ניסיונות: '+e.message+'. אפשר לשלוח בקשה חדשה.']};}
      saveEmailsData(sysFolder,_emailsData);break;
    }
  }
}

function podkiSendNotice(notice) {
  var body='<p>היי, פודקי כאן. בדקתי את ההודעה שלך.</p>'+
    (notice.accepted?'<p>'+notice.accepted+' פעולות תקינות נקלטו ויטופלו בנפרד. מצב ההרשמה לערוצים לא השתנה.</p>':'<p>לא נוספה פעולה תקינה מהחלקים המפורטים כאן.</p>')+
    '<ul>'+notice.errors.map(function(e){return '<li>'+escapeHtml(e)+'</li>';}).join('')+'</ul>'+
    '<p>לבקשה מרובה, הורד קובץ בחירה מהקטלוג וצרף אותו למייל לכתובת קבלת הפרקים. אפשר להשאיר את הנושא ריק. נושא עם טקסט חופשי מבצע גם חיפוש; כתובת RSS בנושא מבקשת גם קטלוג.</p>';
  podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'הבקשה שלך צריכה בדיקה קטנה',htmlBody:_emailWrap('בקשה שדורשת תיקון',body)});
}

function podkiSendRequestSummary(results,mainFolder) {
  var queued=results.filter(function(r){return r.status==='queued';}).length,
      existing=results.filter(function(r){return r.status==='already';}).length,
      failed=results.filter(function(r){return r.status==='failed';}).length;
  var intro='<p>היי! קיבלתי את הבחירה שלך: '+queued+' פרקים נוספו לתור, '+existing+' כבר ממתינים, ו-'+failed+' לא נוספו.</p>'+
    '<p>זהו אישור קליטה לתור, לא אישור שההורדות הושלמו. ההורדות יתקדמו בריצות האוטומטיות לפי הזמן והמקום הפנוי. קובץ שכבר קיים בדרייב לא יידרס. סוג ההרשמה לכל ערוץ נשאר כפי שהיה.</p>';
  var blocks=results.map(function(r){return channelCard(r.channelTitle,r.channelUrl,null,
    '<p dir="auto">'+escapeHtml(r.episodeTitle)+'</p><p>'+({queued:'נוסף לתור',already:'כבר ממתין בתור',failed:'לא נוסף לתור'})[r.status]+
    (r.error?' — '+escapeHtml(r.error):'')+'</p>',mainFolder);});
  var pages=podkiPackBlocks(blocks,intro);
  // A summary can itself be large. Persist the cursor on the active request job.
  var job=podkiState().jobs[0],cursor=job && job.summaryIndex || 0;
  for(var i=cursor;i<pages.length;i++){
    if(_podkiRunStart && !hasEnoughTimeForEmails(_podkiRunStart))throw new Error('אישור הבקשה יימשך בריצה הבאה.');
    podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'קיבלתי את הבחירה שלך — '+queued+' פרקים נוספו לתור'+(pages.length>1?' | חלק '+(i+1)+' מתוך '+pages.length:''),
      htmlBody:_emailWrap('פרקים בתור ההורדה',pages[i])});
    if(job){job.summaryIndex=i+1;if(_sysFolder) saveEmailsData(_sysFolder,_emailsData);}
  }
}

function podkiSearchEpisodes(query) {
  var url='https://itunes.apple.com/search?term='+encodeURIComponent(query)+'&media=podcast&entity=podcastEpisode&limit=20&country=IL';
  var resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
  if(resp.getResponseCode()!==200) throw new Error('חיפוש הפרקים באפל לא זמין כרגע (HTTP '+resp.getResponseCode()+').');
  var data=JSON.parse(resp.getContentText('UTF-8')),rows=data.results || [],results=[],seen={};
  rows.forEach(function(r){
    if(_podkiRunStart && !hasEnoughTimeForEmails(_podkiRunStart)) return;
    if(r.kind && r.kind!=='podcast-episode') return;
    var feed=r.feedUrl;
    if(!podkiUrl(feed) && r.collectionId){
      try{var lookup=UrlFetchApp.fetch('https://itunes.apple.com/lookup?id='+encodeURIComponent(r.collectionId)+'&entity=podcast&country=IL',{muteHttpExceptions:true});
        if(lookup.getResponseCode()===200){var found=(JSON.parse(lookup.getContentText('UTF-8')).results || []).filter(function(x){return podkiUrl(x.feedUrl);})[0];if(found)feed=found.feedUrl;}
      }catch(ignore){}
    }
    if(!podkiUrl(feed)) return;
    var guid=r.episodeGuid || r.episodeUrl;
    if(!guid) return; // trackId is not an RSS GUID.
    var key=JSON.stringify([feed,guid]);if(seen[key])return;seen[key]=true;
    var e={channelUrl:feed,episodeGuid:String(guid),appleTrackId:r.trackId || null,episodeUrl:r.episodeUrl || '',
      episodeTitle:r.trackName || 'פרק ללא כותרת',channelTitle:r.collectionName || 'ערוץ',pubDate:r.releaseDate || '',
      duration:r.trackTimeMillis ? Math.round(r.trackTimeMillis/60000)+' דקות' : '',image:r.artworkUrl160 || r.artworkUrl600 || null,
      description:String(r.description || r.shortDescription || '').replace(/<[^>]*>/g,'').slice(0,350),cachedAt:Date.now()};
    results.push(e);podkiState().appleResults[key]=e;
  });
  var cached=podkiState().appleResults,keys=Object.keys(cached);
  if(keys.length>200)keys.sort(function(a,b){return cached[b].cachedAt-cached[a].cachedAt;}).slice(200).forEach(function(k){delete cached[k];});
  return results;
}

function podkiSendEpisodeSearch(query,mainFolder) {
  var results=podkiSearchEpisodes(query);
  var body='<p>היי! חיפשתי באפל פודקאסטים את <strong dir="auto">'+escapeHtml(query)+'</strong>.</p>'+
    (results.length?'<p>מצאתי '+results.length+' תוצאות שניתן לבקש. בחירת פרק אינה רושמת אותך לערוץ.</p>':'<p>לא מצאתי תוצאות עם פרטים מספיקים לבקשת פרק. נסה שם פרק, שם מגיש או מילות חיפוש אחרות.</p>');
  results.forEach(function(e){
    var payload={channelUrl:e.channelUrl,episodeGuid:e.episodeGuid,appleTrackId:e.appleTrackId};
    var content='<h3 dir="auto">'+escapeHtml(e.episodeTitle)+'</h3><p>'+escapeHtml(e.pubDate?formatDate(new Date(e.pubDate)):'')+' · '+escapeHtml(e.duration)+'</p>'+
      '<p dir="auto">'+escapeHtml(e.description)+'</p>'+buildMailtoBtn('קבל פרק',CTRL_GET_EPISODE,JSON.stringify(payload),
      'שלח את ההודעה כדי לבקש את הפרק '+e.episodeTitle+'. ההרשמה לערוץ לא תשתנה.\n\n'+PRIVACY_NOTE);
    body+=channelCard(e.channelTitle,e.channelUrl,e.image,content,mainFolder);
  });
  podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'מצאתי פרקים עבור ״'+query+'״',htmlBody:_emailWrap('תוצאות חיפוש פרקים',body)});
}

function podkiPackBlocks(blocks,intro) {
  var pages=[],current=intro || '';
  blocks.forEach(function(block){
    if(podkiBytes(_emailWrap('דוח מפודקי',current+block))>PODKI_BODY_BYTES && current!==(intro || '')) {pages.push(current);current=intro || '';}
    if(podkiBytes(_emailWrap('דוח מפודקי',current+block))>PODKI_BODY_BYTES) throw new Error('פריט בודד גדול מדי לדוח; יש לקצר את תיאורו.');
    current+=block;
  });
  if(current || !pages.length)pages.push(current);
  return pages;
}

function sendWeeklyEmail(sysFolder,emailsData,rssList,mainFolder) {
  _rssList=rssList;
  var weekly=emailsData.weekly;
  try{
    if(!weekly.delivery){
      var channels=weekly.channels,keys=Object.keys(channels),counts={success:0,failed:0,notification:0},blocks=[],active={};
      keys.forEach(function(k){channels[k].items.forEach(function(it){if(counts[it.status]!==undefined)counts[it.status]++;});});
      ['downloads','notifications'].forEach(function(section){
        keys.forEach(function(key){
          var d=channels[key],title=d.title || key;
          d.items.filter(function(it){return section==='notifications'?it.status==='notification':it.status!=='notification';}).forEach(function(it){
            if(d.rssUrl)active[d.rssUrl]=true;
            var content='<p><strong>'+(it.status==='notification'?'🔔 פרק חדש — התראות בלבד':it.status==='success'?'✅ הורד לדרייב':'❌ ההורדה נכשלה')+'</strong></p>'+
              '<p dir="auto">'+escapeHtml(it.episodeTitle)+'</p><p>'+escapeHtml(it.pubDate || '')+' · '+escapeHtml(it.duration || '')+'</p>'+
              (it.fileUrl?'<p><a href="'+escapeHtml(it.fileUrl)+'">פתח את הפרק בדרייב</a></p>':'')+
              (it.error?'<p dir="auto">'+escapeHtml(String(it.error).slice(0,1000))+'</p>':'')+
              (it.status==='notification'?buildGetEpisodeButton(title,it.episodeTitle,d.rssUrl,it.guid):'');
            blocks.push(channelCard(title,d.rssUrl,d.image,content,mainFolder));
          });
        });
      });
      rssList.filter(function(r){return !active[r.url];}).forEach(function(r){var info=emailsData.subscriptions.details[r.url] || {};
        blocks.push(channelCard(info.title || r.url,r.url,info.image,'<p>אין פעילות בדוח השבוע. מצב המינוי: '+(r.notifyOnly?'התראות בלבד':'הורדה אוטומטית')+'.</p>',mainFolder));});
      var intro='<p>היי! הנה השבוע שלך עם פודקי: '+counts.success+' פרקים הורדו, '+counts.notification+' פרקים חדשים להתראות בלבד'+(counts.failed?', ו-'+counts.failed+' הורדות נכשלו':'')+'.</p>';
      weekly.delivery={id:String(Date.now()),pages:podkiPackBlocks(blocks,intro),next:0,createdAt:new Date().toISOString()};
      // Freeze only this snapshot. New scans accumulate in a fresh weekly.channels map.
      weekly.channels={};
      saveEmailsData(sysFolder,emailsData);
    }
    var delivery=weekly.delivery;
    for(var i=delivery.next;i<delivery.pages.length;i++){
      if(_podkiRunStart && !hasEnoughTimeForEmails(_podkiRunStart))return false;
      var part='חלק '+(i+1)+' מתוך '+delivery.pages.length;
      podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'השבוע שלך עם פודקי 🎧 — '+part,
        htmlBody:_emailWrap('סיכום שבועי — '+part,delivery.pages[i]+'<p>'+part+' של הדוח. פרקים שנסרקו לאחר הכנת הדוח יישמרו לדוח הבא.</p>')});
      delivery.next=i+1;saveEmailsData(sysFolder,emailsData);
    }
    weekly.nextSendAt=_nextThursday();delete weekly.delivery;saveEmailsData(sysFolder,emailsData);return true;
  }catch(e){Logger.log('⚠️ פודקי — משלוח הדוח יימשך בריצה הבאה: '+e.message);return false;}
}

function shouldSendWeeklyEmail(emailsData) {
  return !!(emailsData && emailsData.weekly && (emailsData.weekly.delivery || new Date(emailsData.weekly.nextSendAt).getTime()<=Date.now()));
}

function sendEpisodeCatalogEmail(channelUrl,startTime) {
  var feed=podkiReadFeed(channelUrl),html=podkiCatalogHtml(feed),blob=Utilities.newBlob(html,'text/html','podki-catalog.html');
  var intro='<p>היי! אספתי עבורך '+feed.episodes.length+' פרקים זמינים בפיד של <strong dir="auto">'+escapeHtml(feed.title)+'</strong>.</p>'+
    '<p>הקטלוג כולל את הפרקים שהמפרסם מספק כרגע בפיד, ולא בהכרח את כל הפרקים שפורסמו בעבר. חלק מהתיאורים מקוצרים.</p>';
  var instructions='<p><strong>לבחירה מרובה:</strong> הורד את קובץ ה-HTML ופתח אותו בדפדפן, חפש וסמן פרקים, הורד את קובץ הבחירה JSON וצרף אותו למייל לכתובת קבלת הפרקים. אין צורך בנושא מיוחד, ואפשר להשאירו ריק. אם תכתוב טקסט בנושא, אבצע גם חיפוש; כתובת RSS בנושא תבקש גם קטלוג.</p>'+
    '<p>הקטלוג אינטראקטיבי לאחר פתיחה בדפדפן, לא בתצוגה המקדימה של Gmail. באנדרואיד יש להוריד ולפתוח בדפדפן שתומך בקובצי HTML מקומיים. הכפתור לפתיחת מייל אינו מצרף את הקובץ אוטומטית.</p>'+
    '<p>ההורדות ייכנסו לתור; בחירת פרקים אינה משנה את המינוי לערוץ.</p>';
  var inline='',inlineFits=true;
  for(var ei=0;ei<feed.episodes.length;ei++){
    var e=feed.episodes[ei];
    inline+='<div style="border-bottom:1px solid #e2e8f0;padding:10px 0;"><strong dir="auto">'+escapeHtml(e.episodeTitle)+'</strong><p>'+escapeHtml(e.pubDate?formatDate(new Date(e.pubDate)):'')+' · '+escapeHtml(e.duration)+'</p>'+buildGetEpisodeButton(feed.title,e.episodeTitle,feed.url,e.episodeGuid)+'</div>';
    if(podkiBytes(inline)>PODKI_BODY_BYTES){inlineFits=false;break;}
  }
  var body=intro+instructions,attachments=[];
  if(blob.getBytes().length<=PODKI_ATTACHMENT_BYTES){
    attachments.push(blob);body+='<p>מצורף: <strong dir="ltr">podki-catalog.html</strong>. אפשר לחפש ולבחור בו גם ללא חיבור לרשת.</p>';
  }else{
    if(!_sysFolder)throw new Error('תיקיית המערכת אינה זמינה לשמירת קטלוג גדול.');
    var saved=_sysFolder.createFile('podki-catalog-'+Date.now()+'.html',html,'text/html');
    body+='<p>הקטלוג גדול מדי לצירוף בטוח. שמרתי אותו בדרייב שלך ללא פתיחת שיתוף ציבורי: <a href="'+escapeHtml(saved.getUrl())+'">הורד את הקטלוג מהדרייב</a>.</p>';
  }
  if(inlineFits && podkiBytes(_emailWrap('קטלוג',body+inline))<=PODKI_BODY_BYTES)body+='<h2>הפרקים זמינים גם כאן</h2>'+inline;
  else body+='<p>הרשימה ארוכה ולכן מופיעה בקטלוג בלבד; נשלחת הודעה אחת במקום כמה הודעות קטלוג.</p>';
  body=channelCard(feed.title,feed.url,feed.image,body,null);
  podkiSendEmail({to:Session.getEffectiveUser().getEmail(),subject:'הקטלוג של ״'+feed.title+'״ מוכן 📚',htmlBody:_emailWrap('הקטלוג שלך',body),attachments:attachments});
  return true;
}

function podkiCatalogHtml(feed) {
  // JSON is data only: escape HTML-significant characters before embedding in a script element.
  var data=JSON.stringify({title:feed.title,url:feed.url,episodes:feed.episodes.map(function(e){return {
    channelUrl:e.channelUrl,episodeGuid:e.episodeGuid,episodeTitle:e.episodeTitle,channelTitle:e.channelTitle,
    pubDate:e.pubDate,duration:e.duration,description:e.description};})}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(feed.title)+' | פודקי</title>'+
    '<style>body{margin:0;background:#edf4fb;color:#17324d;font:16px Arial,sans-serif;line-height:1.7}main{max-width:850px;margin:auto;padding:20px}header,.card,.help{background:white;border-radius:16px;padding:18px;margin-bottom:12px}h1{margin:0}input[type=search],select,button,a.action{font:inherit;padding:10px;border:1px solid #b4cce5;border-radius:10px;box-sizing:border-box}input[type=search]{width:100%;margin:10px 0}button,.action{cursor:pointer;background:#1764c0;color:white}button:disabled{opacity:.5;cursor:default}.tools{display:flex;gap:8px;flex-wrap:wrap}.sticky{position:sticky;bottom:0;padding:12px;background:#e1efff;border-radius:12px}.card label{display:flex;gap:12px;cursor:pointer}.card input{width:22px;height:22px;flex-shrink:0}.muted{color:#536b83;font-size:14px}.desc{white-space:pre-wrap;overflow-wrap:anywhere}.action{display:inline-block;text-decoration:none}.sr{position:absolute;left:-10000px}@media(max-width:500px){main{padding:10px}.tools>*{flex:1}}</style></head><body><main>'+
    '<header><h1>הקטלוג שלך עם פודקי 🎧</h1><p>'+escapeHtml(feed.title)+'</p><p class="muted">כל הפרקים הזמינים בפיד בעת יצירת הקטלוג. התיאורים עשויים להיות מקוצרים. אפשר לחפש ולבחור ללא רשת.</p></header>'+
    '<section class="help"><strong>איך מבקשים כמה פרקים?</strong><ol><li>סמן פרקים, ואז לחץ על הורדת הבחירה.</li><li>פתח מייל לכתובת <span dir="ltr">'+CTRL_GET_EPISODE+'</span>.</li><li>צרף את קובץ ה-JSON ושלח. אפשר להשאיר את הנושא ריק.</li></ol><p>נושא עם טקסט חופשי יבצע גם חיפוש. כתובת RSS בנושא תבקש גם קטלוג. לחיצה על פתיחת מייל אינה מצרפת קובץ אוטומטית. הבקשה תטופל בריצות האוטומטיות ולא תשנה את המינוי לערוץ.</p><p class="muted">קובץ הבחירה כולל רק את הפרקים שסימנת, ויהיה גלוי למנהל כתובת הבקרה לאחר שליחתו.</p></section>'+
    '<label for="search">חיפוש בכותרות ובתיאורים</label><input id="search" type="search" placeholder="שם פרק, נושא או מילה מהתיאור"><div class="tools"><select id="sort" aria-label="מיון"><option value="new">מהחדש לישן</option><option value="old">מהישן לחדש</option><option value="title">לפי כותרת</option></select><button id="select-visible">בחר תוצאות מוצגות</button><button id="clear">נקה בחירה</button></div><p id="count" aria-live="polite"></p><div id="list"></div>'+
    '<div class="sticky"><strong id="selected" aria-live="polite"></strong><div class="tools"><button id="download" disabled>הורד בקשת פרקים JSON</button><button id="share" hidden>שתף את הבחירה</button><a class="action" href="mailto:'+CTRL_GET_EPISODE+'">פתח מייל לשליחת הבקשה</a></div><p id="notice" class="muted" aria-live="polite"></p></div>'+
    '<script type="application/json" id="catalog-data">'+data+'</script><script>('+podkiCatalogClient.toString()+')();</script></main></body></html>';
}

// Runs only inside the downloaded HTML; never executes attached scripts on the server.
function podkiCatalogClient() {
  'use strict';
  var data=JSON.parse(document.getElementById('catalog-data').textContent),selected=new Set(),visible=[],pageSize=100,shown=pageSize;
  var $=function(id){return document.getElementById(id);};
  function filtered(){var term=$('search').value.toLocaleLowerCase().trim();return data.episodes.map(function(e,i){return {e:e,i:i};})
    .filter(function(x){return !term || (x.e.episodeTitle+' '+x.e.description).toLocaleLowerCase().includes(term);})
    .sort(function(a,b){return $('sort').value==='title'?a.e.episodeTitle.localeCompare(b.e.episodeTitle,'he'):($('sort').value==='old'?1:-1)*((Date.parse(a.e.pubDate)||0)-(Date.parse(b.e.pubDate)||0));});}
  function counts(){ $('selected').textContent='נבחרו '+selected.size+' פרקים';$('download').disabled=!selected.size; }
  function render(){
    visible=filtered();$('list').replaceChildren();$('count').textContent='נמצאו '+visible.length+' פרקים מתוך '+data.episodes.length;
    visible.slice(0,shown).forEach(function(x){var card=document.createElement('article');card.className='card';var label=document.createElement('label'),check=document.createElement('input');
      check.type='checkbox';check.checked=selected.has(x.i);check.setAttribute('aria-label','בחר '+x.e.episodeTitle);
      check.onchange=function(){if(check.checked){if(selected.size>=1000){check.checked=false;$('notice').textContent='אפשר לבחור עד 1000 פרקים בקובץ אחד.';return;}selected.add(x.i);}else selected.delete(x.i);counts();};
      var text=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p'),desc=document.createElement('p');
      title.dir='auto';title.textContent=x.e.episodeTitle;meta.className='muted';meta.textContent=(x.e.pubDate?new Date(x.e.pubDate).toLocaleDateString('he-IL'):'ללא תאריך')+' · '+(x.e.duration || '');desc.className='desc';desc.dir='auto';desc.textContent=x.e.description;
      text.append(title,meta,desc);label.append(check,text);card.append(label);$('list').append(card);});
    if(visible.length>shown){var more=document.createElement('button');more.textContent='הצג עוד פרקים';more.onclick=function(){shown+=pageSize;render();};$('list').append(more);}counts();
  }
  function payload(){return {format:'podki-request',version:1,requestId:'podki-'+Date.now()+'-'+Math.random().toString(36).slice(2),episodes:Array.from(selected).map(function(i){var e=data.episodes[i];return {channelUrl:e.channelUrl,episodeGuid:e.episodeGuid,episodeTitle:e.episodeTitle,channelTitle:e.channelTitle};})};}
  function file(){return new File([JSON.stringify(payload(),null,2)],'podki-selection.json',{type:'application/json'});}
  $('search').oninput=function(){shown=pageSize;render();};$('sort').onchange=render;
  $('clear').onclick=function(){selected.clear();render();};
  $('select-visible').onclick=function(){visible.slice(0,shown).forEach(function(x){if(selected.size<1000)selected.add(x.i);});render();};
  $('download').onclick=function(){if(!selected.size)return;var f=file(),url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},10000);$('notice').textContent='קובץ הבחירה הורד. צרף אותו למייל ושלח; אין צורך בנושא מיוחד.';};
  if(navigator.share && navigator.canShare && typeof File!=='undefined'){
    try{if(navigator.canShare({files:[new File(['{}'],'podki-selection.json',{type:'application/json'})]}))$('share').hidden=false;}catch(ignore){}
    $('share').onclick=async function(){if(!selected.size){$('notice').textContent='בחר לפחות פרק אחד.';return;}try{await navigator.share({files:[file()]});$('notice').textContent='בחר ביישום המייל והזן את כתובת קבלת הפרקים. אפשר להשאיר את הנושא ריק.';}catch(e){$('notice').textContent='השיתוף לא הושלם. אפשר להשתמש בהורדת JSON ולצרף אותו ידנית.';}};
  }
  render();
}

