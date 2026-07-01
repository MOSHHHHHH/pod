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
var STORAGE_EMAIL_DAYS   = 2;                         // מרווח ימים בין מיילי אחסון
var DOWNLOAD_BUFFER_MS   = 40 * 1000;                // buffer לעצירת הורדות לפני תום הזמן
var EMAIL_TIME_BUFFER_MS = 90 * 1000;                // זמן שמור לבניית ושליחת מיילים
var SUBS_EMAIL_TIME_MS   = 60 * 1000;                // זמן שמור למייל עדכון מינויים


// =====================================================================
// משתנים גלובליים (חולקים מידע בתוך ריצה אחת)
// =====================================================================
var _downloadHistory = [];
var _emailsData      = null;
var _sysFolder       = null;  // reference לשימוש בפונקציות עזר


// =====================================================================
// נקודת כניסה ראשית — נקראת מ-podcast_v2.gs
// מחזירה true אם נותרו הורדות בתור לריצה הבאה, אחרת false.
// =====================================================================
function main(sysFolder, mainFolder) {
  var startTime = new Date();
  Logger.log("🚀 מערכת הורדת פודקאסטים v2 — " + startTime.toLocaleString("he-IL"));

  // ── 1. אתחול: היסטוריה, מיילים, תור ──
  _sysFolder       = sysFolder;
  _downloadHistory = purgeExpiredHistory(loadDownloadHistory(sysFolder));
  _emailsData      = loadEmailsData(sysFolder);
  initEmailsStructure(_emailsData);

  var queue = loadStatusQueue(sysFolder);
  Logger.log("📦 " + queue.length + " פריטים נטענו מתור קודם.");

  var seenUrls = {};
  for (var q = 0; q < queue.length; q++) { seenUrls[queue[q].url] = true; }

  // ── 2. סריקת כל הפידים ──
  var rssList     = loadRssList(sysFolder);
  var folderCache = {};
  Logger.log("📋 נטענו " + rssList.length + " כתובות RSS.");

  for (var f = 0; f < rssList.length; f++) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן בסריקה — עוצר.");
      break;
    }
    try {
      scanFeed(rssList[f].url, rssList[f].days, mainFolder, queue, seenUrls, folderCache);
    } catch (e) {
      Logger.log("❌ שגיאה בסריקת " + rssList[f].url + ": " + e.message);
    }
  }

  Logger.log("📊 סה\"כ פרקים בתור: " + queue.length);

  // ── 3. הורדה לפי סדר ──
  var downloaded = 0;
  var idx        = 0;

  while (idx < queue.length) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן — עוצר הורדות.");
      break;
    }

    var item         = queue[idx];
    var targetFolder = getOrCreateFolder(mainFolder, item.folderName);

    // הגנה כפולה: קיים בדרייב
    if (fileExistsInFolder(targetFolder, item.fileName)) {
      Logger.log("🔁 כבר קיים: " + item.fileName);
      queue.splice(idx, 1);
      continue;
    }

    // ── בדיקת נפח אחסון לפני הורדה ──
    var freeBytes = getFreeStorageBytes();
    if (freeBytes < STORAGE_MIN_BYTES) {
      Logger.log("💾 נפח נמוך (" + Math.round(freeBytes / 1048576) + "MB) — דוחה: " + item.episodeTitle);
      addToStoragePending(_emailsData, item);
      // לא מגדילים retryCount — הפריט נשאר בתור ומחכה לפינוי מקום
      idx++;
      continue;
    }

    Logger.log("⬇️  מוריד: " + item.episodeTitle +
      (item.chunkState ? " (ממשיך מ-" + Math.round(item.chunkState.offset/1048576) + "MB)" : ""));

    var result;
    if (item.chunkState) {
      // ── המשך הורדה chunked שנעצרה בריצה קודמת ──
      var tf = getOrCreateFolder(mainFolder, item.folderName);
      result = downloadChunked(item.url, item.fileName, item.mimeType, tf,
                               item.chunkState.contentLength, startTime, item.chunkState);
    } else {
      result = downloadAndSaveAudio(item.url, item.fileName, item.mimeType, targetFolder, startTime);
    }

    if (result.success) {
      downloaded++;
      Logger.log("✅ נשמר: " + item.fileName);
      item.chunkState = null;  // ניקוי מצב שמור
      createLrcFile(targetFolder, item.fileName.substring(0, item.fileName.lastIndexOf(".")), item);
      addToHistory(_downloadHistory, item);
      addToWeeklyPending(_emailsData, item, "success", null);
      queue.splice(idx, 1);
    } else if (result.paused) {
      // ── הושהה עקב מגבלת זמן — שומר מצב ב-item ומשאיר בתור ──
      Logger.log("⏸️  הושהה: " + item.episodeTitle + " — יחודש בריצה הבאה.");
      item.chunkState = result.chunkState;
      idx++;
    } else {
      item.chunkState = null;  // ניקוי אם היה state ישן
      item.retryCount = (item.retryCount || 0) + 1;
      Logger.log("❌ ניסיון " + item.retryCount + "/" + MAX_RETRIES + ": " + result.error);

      if (item.retryCount >= MAX_RETRIES) {
        Logger.log("🗑️  מקסימום נסיונות — מוסר ושולח מייל.");
        addToWeeklyPending(_emailsData, item, "failed", result.error);
        sendFailureEmail(item, result.error);
        queue.splice(idx, 1);
      } else {
        idx++;
      }
    }
  }

  Logger.log("📥 הורדו בריצה זו: " + downloaded);

  // ── 4. שמירת מצב ──
  saveDownloadHistory(sysFolder, _downloadHistory);
  saveEmailsData(sysFolder, _emailsData);
  if (queue.length === 0) {
    deleteStatusQueue(sysFolder);
  } else {
    saveStatusQueue(sysFolder, queue);
    Logger.log("💾 " + queue.length + " פרקים נותרו בתור.");
  }

  // ── 5. ניקוי טריגרים ──
  enforceSingleNightlyTrigger();

  // ── 6. שליחת מיילים אם הגיע הזמן ויש מספיק זמן ריצה ──
  var needStorage = shouldSendStorageEmail(_emailsData);
  var needWeekly  = shouldSendWeeklyEmail(_emailsData);
  var needSubs    = checkSubscriptionChanges(rssList, _emailsData);  // גם מעדכן רשימה ב-json

  if ((needStorage || needWeekly || needSubs) && hasEnoughTimeForEmails(startTime)) {
    if (needStorage) { sendStorageEmail(sysFolder, _emailsData); needStorage = false; }
    if (needWeekly)  { sendWeeklyEmail(sysFolder, _emailsData);  needWeekly  = false; }
    if (needSubs)    { sendSubscriptionEmail(rssList, sysFolder, _emailsData, startTime); needSubs = false; }
    saveEmailsData(sysFolder, _emailsData);
  } else if (needStorage || needWeekly || needSubs) {
    Logger.log("⏰ אין מספיק זמן לשליחת מיילים — מגדיר טריגר המשך.");
    ensureOneTimeTrigger();
  }

  // מחזירים true אם נדרשת ריצה נוספת
  return queue.length > 0 || needStorage || needWeekly || needSubs;
}


// =====================================================================
// סריקת פיד בודד — מוסיף פרקים חדשים לתור (queue מתעדכן by reference)
// =====================================================================
function scanFeed(rssUrl, days, mainFolder, queue, seenUrls, folderCache) {
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
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      "⚠️ פרק לא הורד אחרי " + MAX_RETRIES + " נסיונות — " + item.channelTitle,
      "הפרק הבא הוסר מתור ההורדות לאחר " + MAX_RETRIES + " נסיונות כושלים:\n\n" +
      "פודקאסט: " + item.channelTitle + "\n" +
      "פרק: " + item.episodeTitle + "\n" +
      "תאריך פרסום: " + item.pubDate + "\n" +
      "כתובת: " + item.url + "\n\n" +
      "שגיאה אחרונה: " + lastError
    );
  } catch (e) {
    Logger.log("⚠️  שליחת מייל כשלון נכשלה: " + e.message);
  }
}


// =====================================================================
// טעינת רשימת RSS מ-Drive (כולל תמיכה ב-N ימים אופציונלי לכל פיד)
// =====================================================================
function loadRssList(sysFolder) {
  var it = sysFolder.getFilesByName(RSS_FILE_NAME);
  if (!it.hasNext()) return [];

  var rssFile = it.next();
  var content = (rssFile.getMimeType() === MimeType.GOOGLE_DOCS)
    ? rssFile.getAs("text/plain").getDataAsString("UTF-8")
    : rssFile.getBlob().getDataAsString("UTF-8");

  var lines   = content.split("\n").map(function(l) { return l.trim(); });
  var rssList = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === "" || line.charAt(0) === "#") continue;
    if (line.indexOf("http") !== 0) {
      Logger.log("⚠️  שורה לא תקינה בקובץ הרשימה (מדולגת): " + line);
      continue;
    }

    var days = 7;
    var next = i + 1;
    while (next < lines.length && (lines[next] === "" || lines[next].charAt(0) === "#")) { next++; }
    if (next < lines.length && /^\d+$/.test(lines[next])) {
      days = parseInt(lines[next], 10);
      i = next;
    }

    rssList.push({ url: line, days: days });
  }

  return rssList;
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
      return { success: false, error: "HTTP " + resp.getResponseCode() };
    }
    folder.createFile(resp.getBlob().setName(fileName));
    return { success: true, error: null };
  } catch (e) {
    return { success: false, error: e.message };
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
      return { success: true, error: null };
    } else {
      return { success: false, error: "העלאת chunk נכשלה: HTTP " + uploadCode };
    }
  }

  return { success: true, error: null };
}


// =====================================================================
// פונקציות עזר
// =====================================================================

/**
 * מוודא שקיים תמיד טריגר קבוע (לילי) אחד בלבד, ומוחק כל טריגר
 * setUp נוסף שאינו תואם ל-UID השמור ב-PropertiesService.
 * נקרא בסוף main(), עוד לפני שה-gs יוצר (אם בכלל) טריגר המשך
 * חד-פעמי לריצה זו — כך שבנקודה זו לא קיים עדיין טריגר חד-פעמי
 * לגיטימי, וניקוי זה לעולם לא פוגע בטריגר המשך אמיתי.
 */
function enforceSingleNightlyTrigger() {
  var nightlyUid = PropertiesService.getScriptProperties().getProperty("NIGHTLY_TRIGGER_UID");
  var triggers   = ScriptApp.getProjectTriggers();
  var removed    = 0;

  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    if (t.getHandlerFunction() !== "setUp") continue;
    if (t.getUniqueId() === nightlyUid) continue;  // הטריגר הקבוע — נשאר
    ScriptApp.deleteTrigger(t);
    removed++;
  }

  if (removed > 0) {
    Logger.log("🧹 נמחקו " + removed + " טריגרים מיותרים. נשאר טריגר קבוע אחד בלבד.");
  }
}

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

  var lines = [
    "פודקאסט:      " + meta.channelTitle,
    "פרק:          " + meta.episodeTitle,
    "תאריך פרסום:  " + meta.pubDate,
    "מגיש / כותב:  " + meta.author,
    "משך:          " + meta.duration
  ];

  if (meta.season)        lines.push("עונה:          " + meta.season);
  if (meta.episodeNumber) lines.push("מספר פרק:     "  + meta.episodeNumber);
  if (meta.subtitle)      lines.push("כותרת משנה:   "  + meta.subtitle);
  if (meta.guid)          lines.push("מזהה ייחודי:  "  + meta.guid);

  lines.push("");
  lines.push("── תיאור ──────────────────────────────────");

  var cleanDescription = meta.description
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .trim();

  cleanDescription = convertTimestampsToLrc(cleanDescription);
  lines.push(cleanDescription);

  folder.createFile(lrcName, lines.join("\n"), MimeType.PLAIN_TEXT);
  Logger.log("📄 נוצר קובץ LRC: " + lrcName);
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
  if (!_emailsData.subscriptions) {
    _emailsData.subscriptions = { list: [] };
  }
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
    pubDate         : item.pubDate,
    duration        : item.duration,
    url             : item.url
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
  var t  = item.channelTitle;
  if (!ch[t]) ch[t] = { image: item.channelImageUrl || null, items: [] };
  ch[t].items.push({
    episodeTitle : item.episodeTitle,
    pubDate      : item.pubDate,
    duration     : item.duration,
    status       : status,        // "success" | "failed"
    error        : error || null
  });
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
  var current = rssList.map(function(r) { return { url: r.url, days: r.days }; });
  var stored  = emailsData.subscriptions.list || [];

  if (current.length === 0) return false;

  // השוואה: JSON → string compare (סדר חייב להיות עקבי)
  var sortFn = function(a, b) { return a.url < b.url ? -1 : 1; };
  var curStr = JSON.stringify(current.slice().sort(sortFn));
  var stoStr = JSON.stringify(stored.slice().sort(sortFn));

  if (curStr === stoStr) return false;

  // יש שינוי — מעדכן
  emailsData.subscriptions.list = current;
  return true;
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

/**
 * מוודא שיש טריגר המשך חד-פעמי לשעה הבאה — ללא כפילויות.
 * לא פוגע בטריגר הלילי הקבוע.
 */
function ensureOneTimeTrigger() {
  var nightlyUid = PropertiesService.getScriptProperties().getProperty("NIGHTLY_TRIGGER_UID");
  var triggers   = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    if (t.getHandlerFunction() === "setUp" && t.getUniqueId() !== nightlyUid) {
      Logger.log("🕐 טריגר המשך כבר קיים — לא מוסיף כפול.");
      return;
    }
  }
  ScriptApp.newTrigger("setUp").timeBased().after(60 * 60 * 1000).create();
  Logger.log("🕐 טריגר המשך נוצר לעוד שעה.");
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
  return '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head><body style="font-family:Heebo,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#1e293b;">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">' +
    '<div style="background:linear-gradient(135deg,#6366f1,#ec4899);padding:28px 32px;color:#fff;">' +
    '<h1 style="margin:0;font-size:1.5rem;">🎙️ פודקאסטים 2.0</h1>' +
    '<p style="margin:6px 0 0;opacity:.85;">' + title + '</p></div>' +
    '<div style="padding:28px 32px;">' + body + '</div>' +
    '<div style="background:#f8fafc;padding:16px 32px;color:#64748b;font-size:.8rem;text-align:center;">פודקאסטים 2.0 — מערכת הורדה אוטומטית</div>' +
    '</div></body></html>';
}


// ── sendStorageEmail ──
function sendStorageEmail(sysFolder, emailsData) {
  var pending = emailsData.storage.pending;
  if (!pending.length) return;

  var byChannel = {};
  for (var i = 0; i < pending.length; i++) {
    var p = pending[i];
    if (!byChannel[p.channelTitle]) byChannel[p.channelTitle] = { img: null, items: [] };
    byChannel[p.channelTitle].img = byChannel[p.channelTitle].img || p.channelImageUrl;
    byChannel[p.channelTitle].items.push(p);
  }

  var body = '<div style="background:#fffbeb;border-right:4px solid #f59e0b;padding:14px 18px;border-radius:10px;margin-bottom:20px;">' +
    '⚠️ <strong>נפח אחסון ב-Google Drive נמוך מ-2GB.</strong><br>הפרקים הבאים ממתינים להורדה:</div>';

  for (var ch in byChannel) {
    var d      = byChannel[ch];
    var imgTag = d.img
      ? '<img src="' + d.img + '" width="44" height="44" style="border-radius:8px;vertical-align:middle;object-fit:cover;flex-shrink:0;" alt="">'
      : '<div style="width:44px;height:44px;background:#e0e7ff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🎙️</div>';

    body += '<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#f8fafc;padding:12px 16px;display:flex;align-items:center;gap:12px;">' +
      imgTag + '<strong style="margin-right:12px;">' + ch + '</strong></div>' +
      '<div style="padding:8px 16px;">';
    for (var j = 0; j < d.items.length; j++) {
      var it = d.items[j];
      body += '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:.9rem;">' +
        '<span style="font-weight:600;">' + it.episodeTitle + '</span>' +
        '<span style="color:#64748b;font-size:.82rem;margin-right:8px;"> | ' +
        (it.pubDate||'') + (it.duration ? ' | ' + it.duration : '') + '</span></div>';
    }
    body += '</div></div>';
  }

  body += '<p style="color:#64748b;font-size:.88rem;margin-top:16px;">פנה מקום ב-Drive — הפרקים יורדו אוטומטית בריצה הבאה.</p>';

  try {
    MailApp.sendEmail({
      to      : Session.getEffectiveUser().getEmail(),
      subject : "💾 פודקאסטים 2.0 — נפח אחסון נמוך",
      htmlBody: _emailWrap("פרקים ממתינים לאחסון", body)
    });
    Logger.log("📧 נשלח מייל אחסון.");
    emailsData.storage.nextSendAt = _daysFromNow(STORAGE_EMAIL_DAYS);
  } catch(e) {
    Logger.log("⚠️  שליחת מייל אחסון נכשלה: " + e.message);
  }
}


// ── sendWeeklyEmail ──
function sendWeeklyEmail(sysFolder, emailsData) {
  var channels = emailsData.weekly.channels;
  var total = 0;
  for (var ch in channels) total += channels[ch].items.length;
  if (!total) {
    emailsData.weekly.nextSendAt = _nextThursday();
    emailsData.weekly.channels   = {};
    return;
  }

  var successCount = 0, failCount = 0;
  var body = '';

  for (var ch in channels) {
    var d    = channels[ch];
    var succ = d.items.filter(function(x){ return x.status === "success"; });
    var fail = d.items.filter(function(x){ return x.status === "failed";  });
    successCount += succ.length; failCount += fail.length;

    var imgTag = d.image
      ? '<img src="' + d.image + '" width="44" height="44" style="border-radius:8px;vertical-align:middle;object-fit:cover;flex-shrink:0;" alt="">'
      : '<div style="width:44px;height:44px;background:#e0e7ff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🎙️</div>';

    body += '<div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
      '<div style="background:#f8fafc;padding:12px 16px;display:flex;align-items:center;gap:10px;">' +
      imgTag +
      '<strong style="margin-right:10px;">' + ch + '</strong>' +
      '<span style="color:#10b981;font-size:.85rem;">✅ ' + succ.length + '</span>' +
      (fail.length ? ' <span style="color:#ef4444;font-size:.85rem;margin-right:6px;">❌ ' + fail.length + '</span>' : '') +
      '</div><div style="padding:6px 16px;">';

    for (var j = 0; j < succ.length; j++) {
      body += '<div style="padding:6px 0;border-bottom:1px solid #f8fafc;color:#166534;font-size:.88rem;">✅ ' +
        succ[j].episodeTitle +
        '<span style="color:#64748b;font-size:.8rem;"> | ' + (succ[j].pubDate||'') + '</span></div>';
    }
    for (var k = 0; k < fail.length; k++) {
      body += '<div style="padding:6px 0;border-bottom:1px solid #f8fafc;color:#b91c1c;font-size:.88rem;">❌ ' +
        fail[k].episodeTitle +
        '<span style="color:#64748b;font-size:.8rem;"> | ' + (fail[k].error||'') + '</span></div>';
    }
    body += '</div></div>';
  }

  var summary = '<div style="display:flex;gap:16px;margin-bottom:20px;">' +
    '<div style="background:#f0fdf4;border-radius:10px;padding:14px 20px;flex:1;text-align:center;">' +
    '<div style="font-size:1.6rem;font-weight:700;color:#10b981;">' + successCount + '</div>' +
    '<div style="color:#166534;font-size:.9rem;">הורדו בהצלחה</div></div>' +
    (failCount ? '<div style="background:#fef2f2;border-radius:10px;padding:14px 20px;flex:1;text-align:center;">' +
    '<div style="font-size:1.6rem;font-weight:700;color:#ef4444;">' + failCount + '</div>' +
    '<div style="color:#b91c1c;font-size:.9rem;">נכשלו</div></div>' : '') +
    '</div>';

  try {
    MailApp.sendEmail({
      to      : Session.getEffectiveUser().getEmail(),
      subject : "📊 פודקאסטים 2.0 — סיכום שבועי | " + successCount + " פרקים הורדו",
      htmlBody: _emailWrap("סיכום שבועי", summary + body)
    });
    Logger.log("📧 נשלח סיכום שבועי (" + successCount + " הצלחות, " + failCount + " כישלונות).");
    emailsData.weekly.nextSendAt = _nextThursday();
    emailsData.weekly.channels   = {};
  } catch(e) {
    Logger.log("⚠️  שליחת סיכום שבועי נכשלה: " + e.message);
  }
}


// ── sendSubscriptionEmail ──
/**
 * שולח מייל עדכון מינויים עם פרטי כל הערוצים.
 * אוסף פרטי ערוץ (כותרת, תיאור, תמונה) ישירות מהפיד.
 */
function sendSubscriptionEmail(rssList, sysFolder, emailsData, startTime) {
  var body     = '<p style="color:#64748b;margin-bottom:20px;">רשימת הפודקאסטים עודכנה. הרשימה הנוכחית:</p>';
  var invalid  = [];
  var channels = [];

  for (var i = 0; i < rssList.length; i++) {
    if (new Date() - startTime > TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) break;
    var rss = rssList[i];
    try {
      var resp = UrlFetchApp.fetch(rss.url, { muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() !== 200) {
        invalid.push({ url: rss.url, reason: "HTTP " + resp.getResponseCode() });
        continue;
      }
      var doc  = XmlService.parse(resp.getContentText("UTF-8"));
      var ch   = doc.getRootElement().getChild("channel");
      if (!ch) { invalid.push({ url: rss.url, reason: "RSS לא תקין" }); continue; }

      var ns    = XmlService.getNamespace(ITUNES_NS_URL);
      var title = ch.getChildText("title") || rss.url;
      var desc  = (ch.getChildText("description") || ch.getChildText("subtitle", ns) || "")
                    .replace(/<[^>]*>/g, "").substring(0, 160);
      var imgUrl= getChannelCoverArtUrl(ch, ns);
      channels.push({ title: title, desc: desc, imgUrl: imgUrl, days: rss.days });
    } catch(e) {
      invalid.push({ url: rss.url, reason: e.message.substring(0, 80) });
    }
  }

  for (var j = 0; j < channels.length; j++) {
    var c = channels[j];
    // שימוש ב-URL ישיר (לא base64) — שומר על גודל מייל קטן
    var imgTag = c.imgUrl
      ? '<img src="' + c.imgUrl + '" width="44" height="44" style="border-radius:8px;vertical-align:middle;object-fit:cover;" alt="">'
      : '<div style="width:44px;height:44px;background:#e0e7ff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🎙️</div>';

    body += '<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px;padding:14px;border:1px solid #e2e8f0;border-radius:12px;">' +
      imgTag +
      '<div style="margin-right:12px;flex:1;min-width:0;">' +
        '<div><strong>' + c.title + '</strong>' +
        '<span style="background:#e0e7ff;color:#4f46e5;font-size:.75rem;padding:2px 8px;border-radius:20px;margin-right:8px;white-space:nowrap;">' + c.days + ' ימים</span></div>' +
        (c.desc ? '<p style="color:#64748b;font-size:.83rem;margin:4px 0 0;line-height:1.5;">' + c.desc + '</p>' : '') +
      '</div></div>';
  }

  if (invalid.length) {
    body += '<div style="background:#fef2f2;border-right:4px solid #ef4444;padding:14px 18px;border-radius:10px;margin-top:16px;">' +
      '<strong>⚠️ כתובות שלא הגיבו כצפוי:</strong><ul style="margin:8px 0 0;padding-right:18px;">';
    for (var k = 0; k < invalid.length; k++) {
      body += '<li style="font-size:.85rem;margin-bottom:4px;">' +
        '<code style="font-size:.78rem;">' + invalid[k].url + '</code> — ' + invalid[k].reason + '</li>';
    }
    body += '</ul></div>';
  }

  try {
    MailApp.sendEmail({
      to      : Session.getEffectiveUser().getEmail(),
      subject : "📋 פודקאסטים 2.0 — רשימת מינויים עודכנה (" + channels.length + " ערוצים)",
      htmlBody: _emailWrap("עדכון רשימת מינויים", body)
    });
    Logger.log("📧 נשלח מייל עדכון מינויים (" + channels.length + " ערוצים).");
  } catch(e) {
    Logger.log("⚠️  שליחת מייל מינויים נכשלה: " + e.message);
  }
}
