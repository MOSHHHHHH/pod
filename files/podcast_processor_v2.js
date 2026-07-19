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
var _sysFolder       = null;  // reference לשימוש בפונקציות עזר


// =====================================================================
// נקודת כניסה ראשית — נקראת מ-podcast_v2.gs
// מחזירה true אם נותרו הורדות בתור לריצה הבאה, אחרת false.
// =====================================================================
function main(sysFolder, mainFolder) {
  var startTime = new Date();
  Logger.log("🚀 פודקאסטים v2 — " + formatDate(startTime));

  // ── 1. אתחול ──
  _sysFolder       = sysFolder;
  _downloadHistory = purgeExpiredHistory(loadDownloadHistory(sysFolder));
  _emailsData      = loadEmailsData(sysFolder);
  initEmailsStructure(_emailsData);

  // ── 2. טעינת תור ועיבוד מיילי בקרה ──
  var queue = loadStatusQueue(sysFolder);
  Logger.log("📦 " + queue.length + " פריטים בתור.");
  var seenUrls = {};
  for (var q = 0; q < queue.length; q++) seenUrls[queue[q].url] = true;

  var rssList = loadRssList(sysFolder);
  var processedEmails = checkSentMailbox(sysFolder, mainFolder, queue, rssList, startTime);
  // reload rssList — unsubscribe/subscribe may have changed it
  rssList = loadRssList(sysFolder);

  // ── 3. בדיקה: רשימת ערוצים ריקה ──
  if (rssList.length === 0) {
    if (!_emailsData.emptySubsEmailSent) {
      sendEmptySubscriptionsEmail(_emailsData);
      _emailsData.emptySubsEmailSent = true;
    }
    saveEmailsData(sysFolder, _emailsData);
    saveDownloadHistory(sysFolder, _downloadHistory);
    if (processedEmails.length > 0 && hasEnoughTimeForEmails(startTime)) {
      sendProcessedEmailsSummary(processedEmails);
    }
    Logger.log("⚠️  רשימת ערוצים ריקה.");
    return false;
  }
  _emailsData.emptySubsEmailSent = false;  // reset flag when channels exist

  // ── 4. סריקת פידים ──
  var folderCache = {};
  Logger.log("📋 נטענו " + rssList.length + " כתובות RSS.");
  for (var f = 0; f < rssList.length; f++) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן בסריקה."); break;
    }
    try {
      scanFeed(rssList[f].url, rssList[f].days, mainFolder, queue, seenUrls, folderCache);
    } catch(e) {
      Logger.log("❌ סריקה " + rssList[f].url + ": " + e.message);
    }
  }
  Logger.log("📊 " + queue.length + " פרקים בתור.");

  // ── 5. הורדה ──
  var downloaded = 0, idx = 0;
  while (idx < queue.length) {
    if (new Date() - startTime > TIME_LIMIT_MS - DOWNLOAD_BUFFER_MS) {
      Logger.log("⏰ מגבלת זמן — עוצר הורדות."); break;
    }
    var item         = queue[idx];
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
    if (needStorage) { sendStorageEmail(sysFolder, _emailsData, mainFolder);  needStorage = false; }
    if (needWeekly)  { sendWeeklyEmail(sysFolder, _emailsData, rssList, mainFolder); needWeekly = false; }
    if (needSubs)    { sendSubscriptionEmail(rssList, sysFolder, _emailsData, startTime, mainFolder); needSubs = false; }
    saveEmailsData(sysFolder, _emailsData);
  } else if (needStorage || needWeekly || needSubs) {
    Logger.log("⏰ אין מספיק זמן לשליחת מיילים — יטופלו בריצה הבאה.");
  }

  // ── 8. סיכום פרקים שהתקבלו בבקשה ספציפית ──
  // הוסף לרשימה המצטברת ב-emails.json
  var newEpisodeItems = (processedEmails || []).filter(function(it){ return it.type === 'episode_queued' && it.ok; });
  if (newEpisodeItems.length > 0) {
    newEpisodeItems.forEach(function(it){ _emailsData.pendingEpisodeSummary.push(it); });
  }
  if (_emailsData.pendingEpisodeSummary.length > 0 && hasEnoughTimeForEmails(startTime)) {
    sendProcessedEmailsSummary(_emailsData.pendingEpisodeSummary);
    _emailsData.pendingEpisodeSummary = [];
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
  var t  = item.channelTitle;
  if (!ch[t]) ch[t] = { image: item.channelImageUrl || null, rssUrl: item.url, fromSubscription: item.fromSubscription !== false, items: [] };
  ch[t].items.push({
    episodeTitle : item.episodeTitle,
    pubDate      : item.pubDate ? formatDate(new Date(item.pubDate)) : "",
    duration     : item.duration,
    status       : status,
    error        : error || null,
    fileUrl      : item.fileUrl || null
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

  var sortFn = function(a, b) { return a.url < b.url ? -1 : 1; };
  var curStr = JSON.stringify(current.slice().sort(sortFn));
  var stoStr = JSON.stringify(stored.slice().sort(sortFn));

  if (curStr === stoStr) return false;

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
  var now = formatDate(new Date());
  return '<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head><body style="font-family:Heebo,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#1e293b;">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">' +
    '<div style="background:linear-gradient(135deg,#6366f1,#ec4899);padding:28px 32px;color:#fff;">' +
    '<h1 style="margin:0;font-size:1.5rem;">🎙️ פודקאסטים 2.0</h1>' +
    '<p style="margin:6px 0 0;opacity:.85;">' + title + '</p></div>' +
    '<div style="padding:28px 32px;">' + body + '</div>' +
    '<div style="background:#f8fafc;padding:16px 32px;color:#64748b;font-size:.8rem;text-align:center;">פודקאסטים 2.0 — מערכת הורדה אוטומטית | ' + now + '</div>' +
    '</div></body></html>';
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
  return '<a href="'+uri+'" style="display:inline-block;padding:5px 13px;background:'+color+
         ';color:#fff;border-radius:20px;text-decoration:none;font-size:.78rem;font-weight:600;margin:2px 3px;">'+label+'</a>';
}

/** כפתורי שליטה לערוץ: הסר מנוי + קבל פרקים */
function buildChannelControlButtons(channelTitle, rssUrl) {
  var unsubBtn = buildMailtoBtn('הסר מנוי', CTRL_UNSUBSCRIBE, rssUrl,
    'שלח מייל זה על מנת לבטל מינוי לערוץ \''+channelTitle+'\', הבקשה תטופל תוך מספר שעות.\n\n'+PRIVACY_NOTE, '#ef4444');
  var epBtn = buildMailtoBtn('קבל פרקים', CTRL_GET_EPISODE, rssUrl,
    'שלח מייל זה על מנת לקבל את קטלוג הפרקים מערוץ \''+channelTitle+'\'. הבקשה תטופל תוך מספר שעות.\n\n'+PRIVACY_NOTE);
  return unsubBtn + epBtn;
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
  return buildMailtoBtn('+ הירשם לערוץ', CTRL_SUBSCRIBE, rssUrl,
    'שלח מייל זה להוספת הערוץ \'' + channelTitle + '\' לרשימת המינויים שלך. הבקשה תטופל תוך מספר שעות.\n\n' + PRIVACY_NOTE,
    '#10b981');
}

/** שם ערוץ עם קישור לתיקייה (או ללא קישור אם לא קיימת) */
function channelNameTag(channelTitle, mainFolder, extra) {
  extra = extra || '';
  var link = getFolderLink(channelTitle, mainFolder);
  var nameHtml = link
    ? '<a href="'+link+'" style="color:#1e293b;font-weight:700;text-decoration:none;">'+channelTitle+'</a>'
    : '<strong>'+channelTitle+'</strong>';
  return nameHtml + extra;
}

/** תמונת ערוץ עם src ישיר (לא base64) */
function channelImgTag(imgUrl) {
  return imgUrl
    ? '<img src="'+imgUrl+'" width="44" height="44" style="border-radius:8px;object-fit:cover;vertical-align:middle;flex-shrink:0;" alt="">'
    : '<div style="width:44px;height:44px;background:#e0e7ff;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🎙️</div>';
}


// =====================================================================
// sendWeeklyEmail — עם ערוצים לא פעילים, קישורים, כפתורים
// =====================================================================
function sendWeeklyEmail(sysFolder, emailsData, rssList, mainFolder) {
  var channels    = emailsData.weekly.channels;
  var activeNames = Object.keys(channels);
  var total       = 0;
  for (var ch in channels) total += channels[ch].items.length;

  // ── סיכום מספרי ──
  var successCount = 0, failCount = 0;
  for (var ch in channels) {
    channels[ch].items.forEach(function(it){ if(it.status==='success') successCount++; else failCount++; });
  }

  var summary = '<div style="display:flex;gap:12px;margin-bottom:20px;">'
    +'<div style="background:#f0fdf4;border-radius:10px;padding:12px 18px;flex:1;text-align:center;">'
    +'<div style="font-size:1.6rem;font-weight:700;color:#10b981;">'+successCount+'</div>'
    +'<div style="color:#166534;font-size:.88rem;">הורדו בהצלחה</div></div>'
    +(failCount?'<div style="background:#fef2f2;border-radius:10px;padding:12px 18px;flex:1;text-align:center;">'
    +'<div style="font-size:1.6rem;font-weight:700;color:#ef4444;">'+failCount+'</div>'
    +'<div style="color:#b91c1c;font-size:.88rem;">נכשלו</div></div>':'')
    +'</div>';

  var body = summary;

  // ── ערוצים פעילים ──
  if (activeNames.length > 0) {
    body += '<h3 style="color:#1e293b;margin:0 0 12px;">פרקים שהורדו</h3>';
    for (var ch in channels) {
      var d = channels[ch];
      var succ = d.items.filter(function(x){ return x.status==='success'; });
      var fail = d.items.filter(function(x){ return x.status==='failed'; });
      body += '<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">'
        +'<div style="background:#f8fafc;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
        +channelImgTag(d.image)
        +'<span style="margin-right:10px;">'+channelNameTag(ch, mainFolder)+'</span>'
        +'<span style="color:#10b981;font-size:.82rem;">✅ '+succ.length+'</span>'
        +(fail.length?'<span style="color:#ef4444;font-size:.82rem;margin-right:4px;">❌ '+fail.length+'</span>':'')
        +(d.fromSubscription !== false ? buildChannelControlButtons(ch, d.rssUrl||'') : buildSubscribeButton(ch, d.rssUrl||''))
        +'</div><div style="padding:4px 14px 8px;">';
      succ.concat(fail).forEach(function(it){
        var icon = it.status==='success' ? '✅' : '❌';
        var titleHtml = it.fileUrl
          ? '<a href="'+it.fileUrl+'" style="color:#1e293b;text-decoration:none;font-weight:600;">'+icon+' '+it.episodeTitle+'</a>'
          : icon+' <span style="font-weight:600;">'+it.episodeTitle+'</span>';
        body += '<div style="padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:.85rem;">'+titleHtml
          +'<span style="color:#94a3b8;font-size:.78rem;margin-right:8px;"> '+it.pubDate+(it.error?' | '+it.error:'')+'</span></div>';
      });
      body += '</div></div>';
    }
  }

  // ── ערוצים לא פעילים ──
  var inactiveChannels = rssList.filter(function(r){
    return activeNames.indexOf(r._title||'') < 0 && !channels[r.url];
  });
  // Try to get titles from DB by rescanning (we stored channelTitle in rssList if available)
  // For inactive: we show by URL since we don't have title without fetching RSS
  // Better: get title from subscriptions list in emailsData
  var subs = emailsData.subscriptions && emailsData.subscriptions.details ? emailsData.subscriptions.details : {};

  var inactiveItems = rssList.filter(function(r){
    var title = subs[r.url] ? subs[r.url].title : null;
    return title && !channels[title];
  });

  if (inactiveItems.length > 0) {
    body += '<div style="margin-top:20px;padding:14px 16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">'
      +'<h3 style="color:#64748b;font-size:.95rem;margin:0 0 10px;">ערוצים שאתה מנוי אליהם אך לא ירדו פרקים השבוע</h3>';
    inactiveItems.forEach(function(r){
      var info  = subs[r.url] || {};
      var title = info.title;
      var imgUrl = info.image || null;
      body += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">'
        +channelImgTag(imgUrl)
        +'<span style="margin-right:8px;">'+channelNameTag(title, mainFolder)+'</span>'
        +buildChannelControlButtons(title, r.url)
        +'</div>';
    });
    body += '</div>';
  }

  body += '<div style="margin-top:20px;text-align:center;">'+buildAddChannelBtn()+'</div>';

  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '📊 פודקאסטים 2.0 — סיכום שבועי | '+successCount+' פרקים הורדו',
      htmlBody: _emailWrap('סיכום שבועי', body) });
    Logger.log('📧 סיכום שבועי נשלח.');
    emailsData.weekly.nextSendAt = _nextThursday();
    emailsData.weekly.channels   = {};
  } catch(e) { Logger.log('⚠️  סיכום שבועי נכשל: '+e.message); }
}


// =====================================================================
// sendStorageEmail — עם קישורים וכפתורים
// =====================================================================
function sendStorageEmail(sysFolder, emailsData, mainFolder) {
  var pending = emailsData.storage.pending;
  if (!pending.length) return;

  var byChannel = {};
  pending.forEach(function(p){
    if (!byChannel[p.channelTitle]) byChannel[p.channelTitle] = { img: p.channelImageUrl, items: [], rssUrl: p.url };
    byChannel[p.channelTitle].items.push(p);
  });

  var body = '<div style="background:#fffbeb;border-right:4px solid #f59e0b;padding:12px 16px;border-radius:10px;margin-bottom:18px;">'
    +'⚠️ <strong>נפח אחסון ב-Drive נמוך מ-2GB.</strong> הפרקים הבאים ממתינים:</div>';

  for (var ch in byChannel) {
    var d = byChannel[ch];
    body += '<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">'
      +'<div style="background:#f8fafc;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +channelImgTag(d.img)
      +'<span style="margin-right:10px;">'+channelNameTag(ch, mainFolder)+'</span>'
      +buildChannelControlButtons(ch, d.rssUrl||'')
      +'</div><div style="padding:4px 14px 8px;">';
    d.items.forEach(function(it){
      body += '<div style="padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:.85rem;">'
        +'<span style="font-weight:600;">'+it.episodeTitle+'</span>'
        +'<span style="color:#94a3b8;font-size:.78rem;margin-right:8px;"> '+formatDate(new Date(it.skippedAt||Date.now()))+'</span></div>';
    });
    body += '</div></div>';
  }
  body += '<p style="color:#64748b;font-size:.88rem;margin-top:12px;">פנה מקום ב-Drive — הפרקים יורדו אוטומטית.</p>'
    +'<div style="margin-top:16px;text-align:center;">'+buildAddChannelBtn()+'</div>';

  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '💾 פודקאסטים 2.0 — נפח אחסון נמוך',
      htmlBody: _emailWrap('פרקים ממתינים לאחסון', body) });
    Logger.log('📧 מייל אחסון נשלח.');
    emailsData.storage.nextSendAt = _daysFromNow(STORAGE_EMAIL_DAYS);
  } catch(e) { Logger.log('⚠️  מייל אחסון נכשל: '+e.message); }
}


// =====================================================================
// sendSubscriptionEmail — עם קישורים וכפתורים
// =====================================================================
function sendSubscriptionEmail(rssList, sysFolder, emailsData, startTime, mainFolder) {
  var body    = '<p style="color:#64748b;margin-bottom:16px;">רשימת הפודקאסטים עודכנה:</p>';
  var invalid = [];
  var details = emailsData.subscriptions.details || {};

  rssList.forEach(function(rss){
    if (new Date() - startTime > TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) return;
    try {
      var resp = UrlFetchApp.fetch(rss.url, { muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() !== 200) { invalid.push({ url: rss.url, reason: 'HTTP '+resp.getResponseCode() }); return; }
      var doc  = XmlService.parse(resp.getContentText('UTF-8'));
      var ch   = doc.getRootElement().getChild('channel');
      if (!ch) { invalid.push({ url: rss.url, reason: 'RSS לא תקין' }); return; }
      var ns    = XmlService.getNamespace(ITUNES_NS_URL);
      var title = ch.getChildText('title') || rss.url;
      var desc  = (ch.getChildText('description') || ch.getChildText('subtitle', ns) || '').replace(/<[^>]*>/g,'').substring(0, 150);
      var imgUrl= getChannelCoverArtUrl(ch, ns);
      details[rss.url] = { title: title, image: imgUrl };
      var folderLink = getFolderLink(title, mainFolder);
      var nameHtml   = folderLink
        ? '<a href="'+folderLink+'" style="color:#1e293b;font-weight:700;text-decoration:none;">'+title+'</a>'
        : '<strong>'+title+'</strong>';
      body += '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;flex-wrap:wrap;">'
        +channelImgTag(imgUrl)
        +'<div style="margin-right:12px;flex:1;min-width:0;">'
        +'<div style="margin-bottom:4px;">'+nameHtml
        +'<span style="background:#e0e7ff;color:#4f46e5;font-size:.72rem;padding:2px 8px;border-radius:20px;margin-right:8px;">'+rss.days+' ימים</span></div>'
        +(desc?'<p style="color:#64748b;font-size:.82rem;margin:0 0 6px;">'+desc+'</p>':'')
        +buildChannelControlButtons(title, rss.url)
        +'</div></div>';
    } catch(e) { invalid.push({ url: rss.url, reason: e.message.substring(0,60) }); }
  });

  emailsData.subscriptions.details = details;

  if (invalid.length) {
    body += '<div style="background:#fef2f2;border-right:4px solid #ef4444;padding:12px 16px;border-radius:10px;margin-top:14px;">'
      +'<strong>⚠️ כתובות שלא הגיבו:</strong><ul style="margin:8px 0 0;padding-right:18px;">';
    invalid.forEach(function(x){ body += '<li style="font-size:.82rem;margin-bottom:3px;"><code>'+x.url+'</code> — '+x.reason+'</li>'; });
    body += '</ul></div>';
  }
  body += '<div style="margin-top:18px;text-align:center;">'+buildAddChannelBtn()+'</div>';

  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '📋 פודקאסטים 2.0 — רשימת מינויים עודכנה',
      htmlBody: _emailWrap('עדכון רשימת מינויים', body) });
    Logger.log('📧 מייל מינויים נשלח.');
  } catch(e) { Logger.log('⚠️  מייל מינויים נכשל: '+e.message); }
}

// update initEmailsStructure to include subscriptions.details and emptySubsEmailSent
// (patched inline by checking in the function below)


// =====================================================================
// sendEmptySubscriptionsEmail — נשלח פעם אחת כשאין ערוצים
// =====================================================================
function sendEmptySubscriptionsEmail(emailsData) {
  var body = '<p style="color:#64748b;margin-bottom:16px;">רשימת הפודקאסטים שלך ריקה. הוסף ערוצים כדי להתחיל בהורדה אוטומטית.</p>'
    +'<p style="color:#64748b;font-size:.9rem;margin-bottom:20px;">אם ידוע לך כתובת ה-RSS של פודקאסט — הכנס אותה ישירות. אחרת תוכל לחפש לפי שם.</p>'
    +'<div style="text-align:center;padding:20px;">'+buildAddChannelBtn()+'</div>'
    +'<p style="color:#94a3b8;font-size:.8rem;text-align:center;margin-top:12px;">ניתן גם לערוך את קובץ podcasts.txt ישירות ב-Google Drive</p>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '🎙️ פודקאסטים 2.0 — הוסף ערוצים להתחלה',
      htmlBody: _emailWrap('ברוך הבא!', body) });
    Logger.log('📧 מייל ערוצים ריקים נשלח.');
  } catch(e) { Logger.log('⚠️  מייל ריק נכשל: '+e.message); }
}


// =====================================================================
// checkSentMailbox — סורק תיבת הדואר היוצא לכתובות הבקרה
// =====================================================================
function checkSentMailbox(sysFolder, mainFolder, queue, rssList, startTime) {
  var processed    = [];
  var processedIds = (_emailsData.processedEmailIds || []);
  var CTRL_ADDRS   = [CTRL_UNSUBSCRIBE, CTRL_SUBSCRIBE, CTRL_GET_EPISODE];

  CTRL_ADDRS.forEach(function(addr){
    if (new Date() - startTime > TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) return;
    try {
      var threads = GmailApp.search('in:sent to:'+addr, 0, 10);
      threads.forEach(function(thread){
        if (new Date() - startTime > TIME_LIMIT_MS - EMAIL_TIME_BUFFER_MS) return;
        var tid = thread.getId();
        if (processedIds.indexOf(tid) > -1) return;
        var result = null;
        if (addr === CTRL_UNSUBSCRIBE)  result = processUnsubscribeEmail(thread, sysFolder, rssList);
        else if (addr === CTRL_SUBSCRIBE) result = processSubscribeEmail(thread, sysFolder, rssList, mainFolder, startTime);
        else if (addr === CTRL_GET_EPISODE) result = processGetEpisodeEmail(thread, queue, rssList, mainFolder, startTime);
        if (result !== null) {
          // רק אם לא נדחה — מסמן כטופל ומוחק
          if (result.type !== 'subscribe_search_pending') {
            thread.moveToTrash();
            processedIds.push(tid);
          }
          if (result.type !== 'subscribe_search_pending') processed.push(result);
        }
      });
    } catch(e) { Logger.log('⚠️  checkSentMailbox ('+addr+'): '+e.message); }
  });

  // שמור רק 200 אחרונים
  _emailsData.processedEmailIds = processedIds.slice(-200);
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
  var it = sysFolder.getFilesByName(RSS_FILE_NAME);
  if (!it.hasNext()) return false;
  var file    = it.next();
  var content = file.getMimeType() === MimeType.GOOGLE_DOCS
    ? file.getAs('text/plain').getDataAsString('UTF-8')
    : file.getBlob().getDataAsString('UTF-8');
  var lines = content.split('\n');
  var out = [], i = 0, removed = false;
  while (i < lines.length) {
    if (lines[i].trim() === urlToRemove) {
      removed = true;
      // remove preceding comment+empty line
      while (out.length > 0 && (out[out.length-1].trim() === '' || out[out.length-1].trim().startsWith('#')))
        out.pop();
      i++;
      // skip following days line
      if (i < lines.length && /^\d+$/.test(lines[i].trim())) i++;
    } else { out.push(lines[i]); i++; }
  }
  if (!removed) return false;
  file.setTrashed(true);
  sysFolder.createFile(RSS_FILE_NAME, out.join('\n'), MimeType.PLAIN_TEXT);
  return true;
}


// ── subscribe ──
function processSubscribeEmail(thread, sysFolder, rssList, mainFolder, startTime) {
  var subject = thread.getMessages()[0].getSubject().trim();
  if (subject.startsWith('http')) {
    if (rssList.some(function(r){ return r.url === subject; }))
      return { type: 'subscribe_duplicate', url: subject };
    addToPodcastsFile(sysFolder, subject, null, 7);
    rssList.push({ url: subject, days: 7 });
    return { type: 'subscribe_added', url: subject };
  }
  // חיפוש iTunes (עם retry logic)
  var results = handleITunesRetry(subject, sysFolder, startTime);
  if (results === null) return { type: 'subscribe_search_pending', query: subject };  // נדחה לריצה הבאה
  if (results.length === 0) {
    sendNoResultsEmail(subject);
    return { type: 'subscribe_no_results', query: subject };
  }
  sendPodcastSearchResultsEmail(subject, results, mainFolder);
  return { type: 'subscribe_search', query: subject, count: results.length };
}

function addToPodcastsFile(sysFolder, url, comment, days) {
  var it = sysFolder.getFilesByName(RSS_FILE_NAME);
  var existing = it.hasNext() ? it.next() : null;
  var content  = existing
    ? (existing.getMimeType() === MimeType.GOOGLE_DOCS
        ? existing.getAs('text/plain').getDataAsString('UTF-8')
        : existing.getBlob().getDataAsString('UTF-8'))
    : '';
  var lines = content.trim().split('\n');
  lines.push('');
  if (comment) lines.push('# ' + comment);
  lines.push(url);
  if (days && days !== 7) lines.push(String(days));
  if (existing) existing.setTrashed(true);
  sysFolder.createFile(RSS_FILE_NAME, lines.join('\n'), MimeType.PLAIN_TEXT);
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
  var body = '<p style="color:#64748b;margin-bottom:16px;">תוצאות חיפוש עבור: <strong>'+query+'</strong></p>';
  if (!results.length) {
    body += '<p>לא נמצאו תוצאות. נסה לחפש עם מילות מפתח שונות, או הכנס כתובת RSS ישירות.</p>';
  } else {
    results.forEach(function(r){
      var addBtn = buildMailtoBtn('+ הוסף ערוץ', CTRL_SUBSCRIBE, r.rssUrl,
        'שלח מייל זה להוספת הערוץ \''+r.title+'\' לרשימת המינויים שלך.\n\n'+PRIVACY_NOTE, '#10b981');
      var epBtn  = buildMailtoBtn('קבל פרקים', CTRL_GET_EPISODE, r.rssUrl,
        'שלח מייל זה לקבלת קטלוג פרקי הערוץ \''+r.title+'\'.\n\n'+PRIVACY_NOTE);
      body += '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;flex-wrap:wrap;">'
        +channelImgTag(r.image)
        +'<div style="flex:1;min-width:0;margin-right:12px;">'
        +'<div style="font-weight:700;">'+r.title+'</div>'
        +'<div style="color:#64748b;font-size:.82rem;margin-bottom:4px;">'+r.author
        +(r.episodeCount?' | '+r.episodeCount+' פרקים':'')
        +(r.lastDate?' | אחרון: '+r.lastDate:'')+'</div>'
        +addBtn+epBtn
        +'</div></div>';
    });
  }
  body += '<div style="margin-top:16px;text-align:center;">'+buildAddChannelBtn()+'</div>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '🔍 תוצאות חיפוש: '+query,
      htmlBody: _emailWrap('תוצאות חיפוש פודקאסטים', body) });
  } catch(e) { Logger.log('⚠️  מייל חיפוש: '+e.message); }
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
    if (resp.getResponseCode() !== 200) return false;
    var doc     = XmlService.parse(resp.getContentText('UTF-8'));
    var channel = doc.getRootElement().getChild('channel');
    if (!channel) return false;
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
      var guid = item.getChildText('guid') || '';
      if (guid !== episodeGuid) continue;
      var encl = getEnclosureInfo(item);
      if (!encl) return false;
      var title  = item.getChildText('title') || 'פרק';
      var epNum  = item.getChildText('episode', ns) || '';
      var fileExt= getFileExtension(encl.url, encl.type);
      queue.push({
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
        var guid  = item.getChildText('guid') || String(j);
        var pd    = item.getChildText('pubDate') || '';
        var pdFmt = pd ? formatDate(new Date(pd)) : '';
        var dur   = item.getChildText('duration', ns) || '';
        var desc  = (item.getChildText('description') || '').replace(/<[^>]*>/g,'').substring(0,150);
        var getBtn = buildMailtoBtn('קבל פרק זה', CTRL_GET_EPISODE,
          JSON.stringify({ channelUrl: channelUrl, episodeGuid: guid }),
          'שלח מייל זה על מנת להוסיף את הפרק \''+title+'\' מערוץ \''+chanTitle+'\' לרשימת ההורדות. הבקשה תטופל תוך מספר שעות.\n\n'+PRIVACY_NOTE);
        body += '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">'
          +'<div style="font-weight:600;margin-bottom:3px;">'+title+'</div>'
          +'<div style="color:#94a3b8;font-size:.8rem;margin-bottom:4px;">'+pdFmt+(dur?' | '+dur:'')+'</div>'
          +(desc?'<div style="color:#64748b;font-size:.82rem;margin-bottom:6px;">'+desc+'</div>':'')
          +getBtn+'</div>';
      }

      MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
        subject: '📻 '+chanTitle+' — קטלוג פרקים'+(pages>1?' ('+( page+1)+'/'+pages+')':''),
        htmlBody: _emailWrap('קטלוג: '+chanTitle, '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;">'+channelImgTag(chanImg)+'<strong>'+chanTitle+'</strong></div>'+body) });
    }
  } catch(e) { Logger.log('⚠️  sendEpisodeCatalogEmail: '+e.message); }
}


// =====================================================================
// sendProcessedEmailsSummary — סיכום מיילי בקרה שטופלו
// =====================================================================
function sendProcessedEmailsSummary(items) {
  // שולח מייל רק עבור פרקים ספציפיים שנוספו לתור — שאר הפעולות כבר מקבלות מייל ייעודי
  var episodeItems = (items || []).filter(function(it){ return it.type === 'episode_queued' && it.ok; });
  if (!episodeItems.length) return;
  var body = '<p style="color:#64748b;margin-bottom:14px;">הפרקים הבאים נוספו לתור ההורדות לפי בקשתך:</p>';
  episodeItems.forEach(function(it){
    body += '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:.9rem;">'
      +'<span style="font-weight:600;">'+(it.episodeTitle||'פרק')+'</span>'
      +(it.channelTitle?'<span style="color:#64748b;font-size:.82rem;margin-right:8px;"> — '+it.channelTitle+'</span>':'')
      +'</div>';
  });
  body += '<p style="color:#94a3b8;font-size:.82rem;margin-top:12px;">הפרקים יורדו בריצה הקרובה.</p>';
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(),
      subject: '📥 פודקאסטים 2.0 — '+episodeItems.length+' פרקים נוספו לתור',
      htmlBody: _emailWrap('פרקים בתור הורדה', body) });
  } catch(e) { Logger.log('⚠️  סיכום פרקים: '+e.message); }
}
