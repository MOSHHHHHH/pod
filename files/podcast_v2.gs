/**
 * podcast_v2.gs
 * =============
 * נקודת כניסה יחידה. הלוגיקה נטענת ישירות מ-GitHub בכל ריצה.
 * קובץ JS ב-Drive — לא נדרש.
 *
 * מבנה התיקיות ב-Drive (כולל קובץ podcasts.txt) נוצר אוטומטית בריצה
 * הראשונה — אין צורך להכין שום דבר מראש. אם podcasts.txt חסר (כולל
 * ריצה ראשונה-ראשונה, כשגם התיקייה הראשית לא קיימת עדיין), נוצר קובץ
 * ריק ונשלח למשתמש מייל חד-פעמי עם הנחיה להוספת ערוץ.
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
}

// ── קבועים ───────────────────────────────────────────────────────────
var MAIN_FOLDER_NAME = "פודקאסטים 2.0";
var SYS_FOLDER_NAME  = "קבצי מערכת";
var RSS_FILE_NAME    = "podcasts.txt";
var HOURLY_UID_KEY   = "HOURLY_TRIGGER_UID";
var GITHUB_JS_URL    = "https://cdn.jsdelivr.net/gh/MOSHHHHHH/pod@main/files/podcast_processor_v2.js";

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

  // 3. טעינת הלוגיקה מ-GitHub והרצתה
  //    (בדיקת/יצירת קובץ podcasts.txt וכל שאר האתחול מתבצעים בתוך main(),
  //    כולל שליחת מייל חד-פעמי אם הקובץ לא קיים — גם בריצה ראשונה לגמרי)
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
