/**
 * podcast_v2.gs
 * =============
 * נקודת כניסה יחידה. הלוגיקה נטענת ישירות מ-GitHub בכל ריצה.
 * קובץ JS ב-Drive — לא נדרש.
 *
 * קבצים הנדרשים בתיקיית "קבצי מערכת" ב-Drive:
 *   • podcasts.txt   — רשימת פידי ה-RSS של המשתמש
 */

// ── הרשאות נדרשות (if false = לא מתבצע, מאלץ בקשת scopes) ─────────
if (false) {
  DriveApp.getRootFolder().createFolder("").createFile("","").setTrashed(true);
  DriveApp.getFileById("").setTrashed(true);
  GmailApp.search("in:sent");
  GmailApp.sendEmail("","","");
  GmailApp.createLabel("");
  ScriptApp.newTrigger("setUp").timeBased().everyHours(1).create();
  ScriptApp.getOAuthToken();
  PropertiesService.getScriptProperties().setProperty("","");
  Session.getEffectiveUser().getEmail();
  UrlFetchApp.fetch("");
  CalendarApp.getDefaultCalendar();
  SpreadsheetApp.create("");
}

// ── קבועים ───────────────────────────────────────────────────────────
var MAIN_FOLDER_NAME = "פודקאסטים 2.0";
var SYS_FOLDER_NAME  = "קבצי מערכת";
var RSS_FILE_NAME    = "podcasts.txt";
var HOURLY_UID_KEY   = "HOURLY_TRIGGER_UID";
var GITHUB_JS_URL    = "https://raw.githubusercontent.com/MOSHHHHHH/pod/refs/heads/main/files/podcast_processor_v2.js";

// ── פונקציה יחידה ────────────────────────────────────────────────────
function setUp() {
  var props     = PropertiesService.getScriptProperties();
  var hourlyUid = props.getProperty(HOURLY_UID_KEY);

  // 1. ניהול טריגרים — שמור רק טריגר שעתי אחד, מחק את השאר
  var triggers  = ScriptApp.getProjectTriggers();
  var hourFound = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === hourlyUid) { hourFound = true; }
    else { ScriptApp.deleteTrigger(triggers[i]); }
  }
  if (!hourFound) {
    var ht = ScriptApp.newTrigger("setUp").timeBased().everyHours(1).create();
    props.setProperty(HOURLY_UID_KEY, ht.getUniqueId());
    Logger.log("✅ טריגר שעתי נוצר.");
  }

  // 2. מבנה תיקיות
  var rootFolder = DriveApp.getRootFolder();
  var mainIt     = rootFolder.getFoldersByName(MAIN_FOLDER_NAME);
  var mainFolder = mainIt.hasNext() ? mainIt.next() : rootFolder.createFolder(MAIN_FOLDER_NAME);
  var sysIt      = mainFolder.getFoldersByName(SYS_FOLDER_NAME);
  var sysFolder  = sysIt.hasNext() ? sysIt.next() : mainFolder.createFolder(SYS_FOLDER_NAME);

  // 3. בדיקת קובץ המינויים
  if (!sysFolder.getFilesByName(RSS_FILE_NAME).hasNext()) {
    Logger.log("⏳ קובץ " + RSS_FILE_NAME + " חסר בתיקייה '" + SYS_FOLDER_NAME + "'.");
    return;
  }

  // 4. טעינת הלוגיקה מ-GitHub והרצתה
  try {
    var code = UrlFetchApp.fetch(GITHUB_JS_URL, { muteHttpExceptions: true }).getContentText();
    eval(code);
    var hasRemaining = main(sysFolder, mainFolder);
    if (hasRemaining) Logger.log("🕐 נותרו משימות — יטופלו בריצה הבאה.");
  } catch(e) {
    Logger.log("❌ שגיאה: " + e.message);
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        "❌ פודקאסטים 2.0 — שגיאה קריטית",
        "שגיאה בריצה: " + e.message + "\n\n" + e.stack);
    } catch(m) {}
  }
}
