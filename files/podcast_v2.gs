/**
 * podcast_v2.gs
 * =============
 * נקודת כניסה יחידה למערכת הורדת פודקאסטים v2.
 * כל הלוגיקה נמצאת ב-podcast_processor_v2.js בתיקיית Drive.
 */

// ── הרשאות נדרשות (if false = לא מתבצע, רק מאלץ בקשת scopes) ──────
if (false) {
  // Drive
  DriveApp.getRootFolder().createFolder("").createFile("", "").setTrashed(true);
  DriveApp.getFileById("").setTrashed(true);
  // Gmail — נדרש לקריאת Sent ושליחה
  GmailApp.search("in:sent");
  GmailApp.sendEmail("", "", "");
  GmailApp.createLabel("");
  // Script / Auth
  ScriptApp.newTrigger("setUp").timeBased().everyHours(1).create();
  ScriptApp.getOAuthToken();
  PropertiesService.getScriptProperties().setProperty("", "");
  Session.getEffectiveUser().getEmail();
  // External requests (RSS, APIs, GitHub)
  UrlFetchApp.fetch("");
  // שימוש עתידי אפשרי
  CalendarApp.getDefaultCalendar();
  SpreadsheetApp.create("");
}

// ── קבועי תצורה ──────────────────────────────────────────────────────
var MAIN_FOLDER_NAME  = "פודקאסטים 2.0";
var SYS_FOLDER_NAME   = "קבצי מערכת";
var JS_FILE_NAME      = "podcast_processor_v2.js";
var RSS_FILE_NAME     = "podcasts.txt";
var NIGHTLY_HOUR      = 1;
var NIGHTLY_UID_KEY   = "NIGHTLY_TRIGGER_UID";
var HOURLY_UID_KEY    = "HOURLY_TRIGGER_UID";

// ── פונקציה יחידה ────────────────────────────────────────────────────
function setUp() {
  var props      = PropertiesService.getScriptProperties();
  var nightlyUid = props.getProperty(NIGHTLY_UID_KEY);
  var hourlyUid  = props.getProperty(HOURLY_UID_KEY);

  // 1. ניקוי טריגרים — שומר רק טריגר לילי ושעתי קבועים
  var triggers   = ScriptApp.getProjectTriggers();
  var nightFound = false;
  var hourFound  = false;
  for (var i = 0; i < triggers.length; i++) {
    var uid = triggers[i].getUniqueId();
    if (uid === nightlyUid)      { nightFound = true; }
    else if (uid === hourlyUid)  { hourFound  = true; }
    else { ScriptApp.deleteTrigger(triggers[i]); }  // מחק חד-פעמיים ישנים
  }

  // 2. יצירת טריגר לילי אם חסר
  if (!nightFound) {
    var nt = ScriptApp.newTrigger("setUp").timeBased().everyDays(1).atHour(NIGHTLY_HOUR).create();
    props.setProperty(NIGHTLY_UID_KEY, nt.getUniqueId());
    Logger.log("✅ טריגר לילי נוצר: 0" + NIGHTLY_HOUR + ":00.");
  }

  // 3. יצירת טריגר שעתי אם חסר (רץ כל שעה, 24/7)
  if (!hourFound) {
    var ht = ScriptApp.newTrigger("setUp").timeBased().everyHours(1).create();
    props.setProperty(HOURLY_UID_KEY, ht.getUniqueId());
    Logger.log("✅ טריגר שעתי נוצר (כל שעה).");
  }

  // 4. מציאת / יצירת מבנה תיקיות
  var rootFolder = DriveApp.getRootFolder();
  var mainIt     = rootFolder.getFoldersByName(MAIN_FOLDER_NAME);
  var mainFolder = mainIt.hasNext() ? mainIt.next() : rootFolder.createFolder(MAIN_FOLDER_NAME);
  var sysIt      = mainFolder.getFoldersByName(SYS_FOLDER_NAME);
  var sysFolder  = sysIt.hasNext() ? sysIt.next() : mainFolder.createFolder(SYS_FOLDER_NAME);

  // 5. בדיקת קבצי מערכת
  var jsIt  = sysFolder.getFilesByName(JS_FILE_NAME);
  var txtIt = sysFolder.getFilesByName(RSS_FILE_NAME);
  if (!jsIt.hasNext() || !txtIt.hasNext()) {
    Logger.log("⏳ קבצי מערכת חסרים. הכנס:");
    if (!jsIt.hasNext())  Logger.log("   • " + JS_FILE_NAME);
    if (!txtIt.hasNext()) Logger.log("   • " + RSS_FILE_NAME);
    return;
  }

  // 6. טעינה והרצה — main() מחזיר true אם נותרו משימות (לצורך לוג בלבד)
  eval(jsIt.next().getBlob().getDataAsString());
  var hasRemaining = main(sysFolder, mainFolder);
  if (hasRemaining) Logger.log("🕐 נותרו משימות — יטופלו בריצה השעתית הבאה.");
}
