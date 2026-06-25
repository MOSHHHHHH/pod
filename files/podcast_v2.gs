/**
 * podcast_v2.gs
 * =============
 * נקודת כניסה יחידה למערכת הורדת פודקאסטים v2.
 * כל הלוגיקה נמצאת ב-podcast_processor_v2.js בתיקיית Drive.
 *
 * הגדרה ראשונית:
 *   הרץ setUp פעם אחת ידנית.
 *   אם קבצי המערכת עדיין לא הוכנסו לתיקייה — המערכת תיצור את מבנה
 *   התיקיות הנדרש ותגדיר בעצמה טריגר בדיקה חוזרת לעוד שעה.
 *   אין צורך להריץ שוב ידנית — ברגע שתכניס את הקבצים, הטריגר האוטומטי
 *   ימצא אותם ויתחיל לעבוד לבד.
 */

// ── הרשאות נדרשות (if false = לא מתבצע, רק מאלץ בקשת scopes) ──────
if (false) {
  UrlFetchApp.fetch("");
  DriveApp.getRootFolder().createFolder("").createFile("", "").setTrashed(true);
  DriveApp.getFileById("").setTrashed(true);
  ScriptApp.newTrigger("setUp").timeBased().after(1).create();
  ScriptApp.getOAuthToken();
  PropertiesService.getScriptProperties().setProperty("", "");
  MailApp.sendEmail("", "", "");
}

// ── קבועי תצורה ──────────────────────────────────────────────────────
var MAIN_FOLDER_NAME = "פודקאסטים 2.0";
var SYS_FOLDER_NAME  = "קבצי מערכת";
var JS_FILE_NAME     = "podcast_processor_v2.js";
var RSS_FILE_NAME    = "podcasts.txt";
var NIGHTLY_HOUR     = 1;                 // שעת הטריגר הלילי הקבוע (01:00–02:00)
var NIGHTLY_UID_KEY  = "NIGHTLY_TRIGGER_UID";

// ── פונקציה יחידה ────────────────────────────────────────────────────
function setUp() {
  var props      = PropertiesService.getScriptProperties();
  var nightlyUid = props.getProperty(NIGHTLY_UID_KEY);

  // 1. ניקוי טריגרים חד-פעמיים ישנים/תקועים.
  //    (טריגרי "after" נמחקים אוטומטית ע"י GAS לאחר שהם יורים —
  //     הניקוי כאן מטפל רק בשאריות/כפילויות חריגות.)
  //    הטריגר הלילי הקבוע אף פעם לא נמחק.
  var triggers   = ScriptApp.getProjectTriggers();
  var nightFound = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getUniqueId() === nightlyUid) {
      nightFound = true;
    } else {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 2. רשת ביטחון — מבטיח שתמיד קיים טריגר לילי, כדי שהמערכת לעולם
  //    לא "תמות" גם אם כל הטריגרים החד-פעמיים נמחקו / נכשלו.
  if (!nightFound) {
    var nt = ScriptApp.newTrigger("setUp").timeBased().everyDays(1).atHour(NIGHTLY_HOUR).create();
    props.setProperty(NIGHTLY_UID_KEY, nt.getUniqueId());
    Logger.log("✅ טריגר לילי נוצר: 0" + NIGHTLY_HOUR + ":00–0" + (NIGHTLY_HOUR + 1) + ":00.");
  }

  // 3. מציאת / יצירת מבנה תיקיות
  var rootFolder = DriveApp.getRootFolder();

  var mainIt = rootFolder.getFoldersByName(MAIN_FOLDER_NAME);
  var mainFolder = mainIt.hasNext() ? mainIt.next() : rootFolder.createFolder(MAIN_FOLDER_NAME);

  var sysIt = mainFolder.getFoldersByName(SYS_FOLDER_NAME);
  var sysFolder = sysIt.hasNext() ? sysIt.next() : mainFolder.createFolder(SYS_FOLDER_NAME);

  // 4. בדיקת קבצי מערכת — אם חסרים, מחכים שעה ומנסים שוב (ללא צורך
  //    בהרצה ידנית נוספת; הטריגר החד-פעמי הבא יבדוק אוטומטית).
  var jsIt  = sysFolder.getFilesByName(JS_FILE_NAME);
  var txtIt = sysFolder.getFilesByName(RSS_FILE_NAME);

  if (!jsIt.hasNext() || !txtIt.hasNext()) {
    Logger.log("⏳ קבצי מערכת חסרים בתיקייה '" + SYS_FOLDER_NAME + "'. הכנס:");
    if (!jsIt.hasNext())  Logger.log("   • " + JS_FILE_NAME);
    if (!txtIt.hasNext()) Logger.log("   • " + RSS_FILE_NAME);
    Logger.log("🕐 הטריגר הלילי הקבוע יבדוק שוב מחר. ניתן גם להריץ ידנית לבדיקה מיידית.");
    return;
  }

  // 5. טעינת הלוגיקה מ-Drive והרצתה.
  //    main() מחזירה true אם נותרו הורדות לטיפול בריצה הבאה.
  eval(jsIt.next().getBlob().getDataAsString());
  var hasRemainingQueue = main(sysFolder, mainFolder);

  // 6. אם נותרו הורדות — טריגר המשך לשעה הבאה, תוך הימנעות מהתנגשות
  //    עם הטריגר הלילי הקבוע (לא יוצרים טריגר חד-פעמי לשעה הסמוכה
  //    שלפני הריצה הלילית, וגם לא לשעת הריצה הלילית עצמה — הטריגר
  //    הלילי שכבר מובטח שקיים ירוץ ויטפל בהמשך ממילא).
  if (hasRemainingQueue) {
    var nextHour     = (new Date().getHours() + 1) % 24;
    var hourBeforeNg = (NIGHTLY_HOUR - 1 + 24) % 24;

    if (nextHour === NIGHTLY_HOUR || nextHour === hourBeforeNg) {
      Logger.log("⏭️  טריגר המשך מדולג (קרוב מדי לריצה הלילית) — הריצה הלילית תטפל בהמשך.");
    } else {
      ScriptApp.newTrigger("setUp").timeBased().after(60 * 60 * 1000).create();
      Logger.log("🕐 נותרו הורדות בתור — טריגר המשך נוצר לעוד שעה.");
    }
  }
}
