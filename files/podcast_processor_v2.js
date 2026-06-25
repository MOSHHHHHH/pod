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
var MAX_RETRIES      = 3;                   // נסיונות הורדה לפני ויתור על פרק
var STATUS_FILE_NAME = "status_queue.json";
var RSS_FILE_NAME    = "podcasts.txt";


// =====================================================================
// נקודת כניסה ראשית — נקראת מ-podcast_v2.gs
// מחזירה true אם נותרו הורדות בתור לריצה הבאה, אחרת false.
// =====================================================================
function main(sysFolder, mainFolder) {
  var startTime = new Date();
  Logger.log("🚀 מערכת הורדת פודקאסטים v2 — " + startTime.toLocaleString("he-IL"));

  // ── 1. טעינת תור קודם (אם נשארו הורדות מריצה קודמת) ──
  var queue = loadStatusQueue(sysFolder);
  Logger.log("📦 " + queue.length + " פריטים נטענו מתור קודם.");

  var seenUrls = {};
  for (var q = 0; q < queue.length; q++) { seenUrls[queue[q].url] = true; }

  // ── 2. סריקת כל הפידים והוספת פרקים חדשים לתור ──
  var rssList = loadRssList(sysFolder);
  Logger.log("📋 נטענו " + rssList.length + " כתובות RSS.");

  var folderCache = {};  // channelTitle → { folder, coverArtDone }

  for (var f = 0; f < rssList.length; f++) {
    try {
      scanFeed(rssList[f].url, rssList[f].days, mainFolder, queue, seenUrls, folderCache);
    } catch (e) {
      Logger.log("❌ שגיאה בסריקת " + rssList[f].url + ": " + e.message);
    }
  }

  Logger.log("📊 סה\"כ פרקים בתור להורדה: " + queue.length);

  // ── 3. הורדה לפי סדר, עד תום מגבלת הזמן ──
  var downloaded = 0;
  var idx = 0;
  while (idx < queue.length) {
    if (new Date() - startTime > TIME_LIMIT_MS) {
      Logger.log("⏰ מגבלת זמן הריצה הגיעה — עוצר.");
      break;
    }

    var item = queue[idx];

    // הגנה כפולה: ייתכן שהקובץ כבר קיים (למשל מריצה מקבילה/ידנית)
    var targetFolder = getOrCreateFolder(mainFolder, item.folderName);
    if (fileExistsInFolder(targetFolder, item.fileName)) {
      Logger.log("🔁 כבר קיים: " + item.fileName + " — מוסר מהתור.");
      queue.splice(idx, 1);
      continue;
    }

    Logger.log("⬇️  מוריד: " + item.episodeTitle);
    var result = downloadAndSaveAudio(item.url, item.fileName, item.mimeType, targetFolder, startTime);

    if (result.success) {
      downloaded++;
      Logger.log("✅ נשמר: " + item.fileName);
      createLrcFile(targetFolder, item.fileName.substring(0, item.fileName.lastIndexOf(".")), item);
      queue.splice(idx, 1);  // לא מקדמים idx — האיבר הבא זז למקום הזה
    } else {
      item.retryCount = (item.retryCount || 0) + 1;
      Logger.log("❌ ניסיון " + item.retryCount + "/" + MAX_RETRIES + " נכשל: " +
        item.episodeTitle + " — " + result.error);

      if (item.retryCount >= MAX_RETRIES) {
        Logger.log("🗑️  הגיע למקסימום נסיונות — מוותר ושולח מייל.");
        sendFailureEmail(item, result.error);
        queue.splice(idx, 1);  // לא מקדמים idx
      } else {
        idx++;  // משאיר בתור, עובר לפריט הבא
      }
    }
  }

  Logger.log("📥 סה\"כ פרקים חדשים שהורדו בריצה זו: " + downloaded);

  // ── 4. ניקוי הגנתי: ודא שנשאר טריגר קבוע (לילי) אחד בלבד.
  //    מתבצע כאן, לפני שה-gs מחליט אם ליצור טריגר המשך — כך שבנקודה
  //    זו לעולם לא קיים עדיין טריגר חד-פעמי לגיטימי, וניקוי זה תמיד בטוח.
  enforceSingleNightlyTrigger();

  // ── 5. עדכון / מחיקת קובץ תור ──
  if (queue.length === 0) {
    deleteStatusQueue(sysFolder);
    Logger.log("🏁 אין הורדות ממתינות. סיום.");
    return false;
  } else {
    saveStatusQueue(sysFolder, queue);
    Logger.log("💾 " + queue.length + " פרקים נותרו בתור — נשמר לריצה הבאה.");
    return true;
  }
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
      url           : enclosureInfo.url,
      mimeType      : enclosureInfo.type || "audio/mpeg",
      fileName      : fileName,
      folderName    : folderName,
      channelTitle  : channelTitle,
      episodeTitle  : title,
      pubDate       : pubDateStr,
      author        : item.getChildText("author", itunesNs) || item.getChildText("author") || channelAuthor,
      duration      : item.getChildText("duration", itunesNs) || "",
      episodeNumber : episodeNum,
      season        : item.getChildText("season", itunesNs) || "",
      subtitle      : item.getChildText("subtitle", itunesNs) || "",
      guid          : item.getChildText("guid") || enclosureInfo.url,
      description   : item.getChildText("description") || "",
      retryCount    : 0
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

  return downloadChunked(url, fileName, mimeType, folder, contentLength, startTime);
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

function downloadChunked(url, fileName, mimeType, folder, contentLength, startTime) {
  var token = ScriptApp.getOAuthToken();

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

  var uploadUrl = initResp.getHeaders()["Location"] || initResp.getHeaders()["location"];
  if (!uploadUrl) {
    return { success: false, error: "חסר Location header ב-Resumable Upload" };
  }

  Logger.log("📡 מתחיל " + Math.ceil(contentLength / CHUNK_SIZE_BYTES) + " chunks...");

  var offset = 0;
  while (offset < contentLength) {
    if (new Date() - startTime > TIME_LIMIT_MS) {
      try { UrlFetchApp.fetch(uploadUrl, { method: "delete", muteHttpExceptions: true }); } catch (e) {}
      return { success: false, error: "מגבלת זמן באמצע chunked download" };
    }

    var end = Math.min(offset + CHUNK_SIZE_BYTES - 1, contentLength - 1);

    var chunkResp = UrlFetchApp.fetch(url, {
      headers            : { "Range": "bytes=" + offset + "-" + end },
      muteHttpExceptions : true,
      followRedirects    : true
    });

    var chunkCode = chunkResp.getResponseCode();
    if (chunkCode !== 206 && chunkCode !== 200) {
      try { UrlFetchApp.fetch(uploadUrl, { method: "delete", muteHttpExceptions: true }); } catch (e) {}
      return { success: false, error: "הורדת chunk נכשלה: HTTP " + chunkCode };
    }

    var chunkBytes = chunkResp.getContent();

    var uploadResp = UrlFetchApp.fetch(uploadUrl, {
      method  : "PUT",
      headers : {
        "Content-Range" : "bytes " + offset + "-" + end + "/" + contentLength,
        "Content-Type"  : mimeType
      },
      payload            : chunkBytes,
      muteHttpExceptions : true
    });

    var uploadCode = uploadResp.getResponseCode();

    if (uploadCode === 308) {
      // ממשיך
    } else if (uploadCode === 200 || uploadCode === 201) {
      return { success: true, error: null };
    } else {
      return { success: false, error: "העלאת chunk נכשלה: HTTP " + uploadCode };
    }

    offset = end + 1;
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

  return text.replace(pattern, function(match, g1, g2, g3) {
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
    return "[" + pad(mm) + ":" + pad(ss) + ".00]";
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
