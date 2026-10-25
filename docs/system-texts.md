# אוסף הטקסטים של פודקי לניסוח מחדש

האוסף משקף את הקוד המקומי לאחר קיבוץ הפרקים לפי ערוץ. הוא מסמך עריכה בלבד ואינו משנה את הטקסטים במערכת.

- כל רשומה כוללת מזהה, פונקציה ומיקום בקוד. אפשר להחזיר ניסוחים חדשים לפי המזהים.
- `{{...}}` מסמן מידע או פעולה שמוזרקים בזמן הריצה: שם ערוץ, כותרת פרק, מספר פרקים, כתובת וכדומה. אלה אינם טקסטים קבועים. תתי־נוסחים מותנים מופיעים גם כרשומות נפרדות.
- תגי HTML ועיצוב הוסרו לנוחות הקריאה. טקסטי נגישות ושדות קלט מפורטים לצד התוכן. תבניות שמורכבות מכמה פונקציות מציגות את נקודת השילוב.
- הנוסחים מובאים כפי שהם בקוד, כולל נוסחים ישנים: בשורת הנושא מנגנון השליחה מחליף אוטומטית „פודקאסטים 2.0” ב„פודקי” ומוסיף „פודקי |” אם השם חסר.
- האוסף כולל מיילים, כפתורי מייל וגופי הודעות מוכנים לשליחה, קטלוג HTML, דף התקנה, שמות קבצים, שגיאות ולוגים. שמות פרקים, ערוצים, תיאורים וטקסטים המגיעים מפידים ומ־Apple משתנים ואינם ניתנים לרשימה מראש.
- טקסטים שאינם חלק מממשק המוצר (הערות קוד, בדיקות, רישיון, היסטוריית שינויים ומילות חיפוש בקובץ keywords.txt) אינם נוסחי המערכת. הם נשארים בקובצי המקור.
- לצד מסמך זה נמצא `system-texts-source.json`, הכולל את כל מחרוזות המקור בעברית מתוך קובצי הקוד, ללא הסרת HTML, לשמירת דיוק הנוסח וההקשר.

## דף ההתקנה — הטקסט המוצג

מקור: `index.htm`. הסדר לפי הדף, כולל שלבים שמוצגים רק לאחר מעבר בין מסכים.

```text
פודקי — בוט הפודקאסטים שלך
פודקי בוט הפודקאסטים שלך קוד פתוח ↗
שלב 1 מתוך 3 · נעים להכיר
1
2
3
נעים להכיר, אני
פודקי
בוט הפודקאסטים שלך. מורידים לדרייב, מקבלים התראות או בוחרים רק את הפרקים שמעניינים אותך — דרך המייל.
חינם וקוד פתוח בחשבון Google שלך בלי אפליקציה נוספת
מה עושים עם פודקי
בוחרים איך לעקוב. פודקי מטפל בשאר בריצות אוטומטיות, בדרך כלל פעם בשעה.
הורדה אוטומטית לדרייב
סריקה מתוזמנת של כל הערוצים שנרשמתם אליהם, והורדת פרקים חדשים ישירות לתיקיות מסודרות בדרייב.
הורדות או התראות בלבד
בוחרים הרשמה רגילה להורדה אוטומטית, או התראות בלבד במייל השבועי. אפשר לשנות מצב או להסיר ערוץ במייל, וגם לערוך את רשימת הערוצים בדרייב.
חיפוש ערוצים וגם פרקים
מחפשים ערוץ דרך ״הוסף ערוץ״, או פרק דרך ״חפש פרק״. כותבים שם או מילות חיפוש בנושא המייל, ושולחים. תוצאות מאפל פודקאסטים מגיעות עם כפתורי פעולה.
קטלוג עם בחירה מרובה
״קבל פרקים״ שולח קטלוג HTML של הפרקים הזמינים בפיד: מחפשים, ממיינים ובוחרים כמה יחד. מורידים JSON, מצרפים למייל ושולחים — גם בלי נושא. הבחירה אינה משנה את המינוי.
קבצים גדולים בלי לאבד התקדמות
פרקים כבדים מתחלקים להורדה על פני כמה ריצות, כדי לעמוד במגבלת הזמן של גוגל סקריפט.
דיווחים והתראות
דוח שבועי של הורדות ופרקים חדשים מערוצי התראות, עם ״קבל פרק״ לבחירה ידנית. דוח ארוך מפוצל לחלקים. פודקי גם מתריע על מחסור במקום ושומר תמונה ומידע לצד הפרקים.
הבא
לפני שמתחילים
מדיניות פרטיות
הסקריפט פועל בחשבון שלך. חשוב להכיר את שני סוגי המידע שמועברים למנהל השירות:
א
כתובת המייל שלך — נשלחת לטופס של מנהל השירות בכל הרצה, גם אם מנהלים את רשימת הערוצים ידנית בדרייב.
ב
פקודות וקבצים שנשלחים במייל — הודעות לכתובות הבקרה הייעודיות, כולל נושא, גוף ההודעה וקובצי בחירה מצורפים, גלויים למנהל השירות. אלה כוללים הרשמה והסרה, מעבר להתראות בלבד, חיפוש ודרישת פרקים או קטלוג. הסקריפט מעבד את הפקודות מתוך תיבת ״נשלח״ שלך. עריכה ידנית של רשימת הערוצים אינה שולחת פקודת מייל; דיווח כתובת המייל בכל הרצה ממשיך לחול.
קראתי ואני מאשר/ת את מדיניות הפרטיות.
ידוע לי שהודעות וקובצי בחירה שאשלח לכתובות הבקרה יהיו גלויים למנהל השירות. עריכת רשימת הערוצים בדרייב אינה שולחת פקודה, אך כתובת המייל שלי נשלחת בכל הרצה.
חזרה
הבא
עוד כמה דקות ואנחנו יחד
התקנת פודקי
אותו תהליך התקנה, בחשבון Google שלך. ההרצה הראשונה יוצרת את התיקיות ואת התזמון האוטומטי.
פותחים פרויקט חדש
נכנסים ל-Google Apps Script ויוצרים פרויקט ריק חדש.
פתיחת Apps Script חדש
מוחקים את הקוד הקיים
מוחקים את כל התוכן שמופיע כברירת מחדל בקובץ Code.gs.
מעתיקים ומדביקים את התוכן
לוחצים על הכפתור, וקוד ההפעלה (files/podcast_v2.gs) נטען ומועתק אוטומטית ללוח ההעתקה. עוברים לחלון של Apps Script (GAS) שנפתח בשלב 1, לוחצים בתוך קובץ Code.gs הריק, ומדביקים (Ctrl+V / ⌘V).
העתקת קוד המערכת
ההעתקה לא זמינה? פתח את קוד ההפעלה והעתק ידנית .
מריצים פעם אחת בלבד ומאשרים הרשאות
אין צורך להגדיר שום דבר אחר — לא תיקיות ולא טריגרים בנפרד. שומרים את הפרויקט (Ctrl+S / ⌘S), בוחרים את הפונקציה setUp ולוחצים על Run (▶) כדי להריץ אותה פעם אחת. בהרצה הראשונה תיפתח בקשת הרשאות — אלה השלבים לאישור:
בחלון "Authorization required" לוחצים על Review permissions, ובוחרים את חשבון הגוגל שאיתו רוצים להשתמש בכלי.
מופיעה אזהרה שגוגל לא אימתה את האפליקציה ("Google hasn't verified this app") — זה תקין ומצופה עבור סקריפט שכתבתם/הדבקתם בעצמכם. לוחצים על Advanced (מתקדם).
לוחצים על הקישור Go to [שם הפרויקט] (unsafe) שמופיע בהמשך המסך.
בודקים ברשימת ההרשאות המבוקשות (גישה ל-Drive ול-Gmail) ולוחצים Allow / Continue כדי לאשר.
בדרך כלל אישור ההרשאות נדרש בהתקנה. Google עשויה לבקש אישור מחדש בהמשך, למשל לאחר שינוי בהרשאות הפרויקט.
בודקים במייל
פודקי ישלח מייל היכרות עם הוראות ודוגמת TXT. מתחילים ב״הוסף ערוץ״ ובוחרים הורדה אוטומטית או התראות בלבד. לא הגיע מייל? בדקו ספאם וקידומים ואת יומן ההרצות ב-Apps Script.
איך משתמשים בפודקי אחרי ההתקנה?
שלושת כפתורי הערוץ: ״הירשם״ מפעיל הורדה אוטומטית, ״הירשם להתראות בלבד״ מוסיף פרקים חדשים לדוח השבועי, ו״הסר״ מבטל את המינוי. מוצגים שני הכפתורים שמתאימים למצב הנוכחי. ״קבל פרקים״ זמין לקבלת קטלוג בכל מצב.
פרק בודד: ״קבל פרק״ מוסיף פרק לתור ההורדה בלי לשנות את המינוי לערוץ. יש לשלוח את המייל שנפתח כדי לבצע את הפעולה.
כמה פרקים יחד: מורידים את קובץ ה-HTML מהקטלוג ופותחים בדפדפן, לא בתצוגה המקדימה של Gmail. באנדרואיד נדרש דפדפן שתומך בקובצי HTML מקומיים. מסמנים עד 1,000 פרקים, מורידים JSON ומצרפים למייל שנפתח מתוך הקטלוג. הכפתור אינו מצרף קובץ אוטומטית. אפשר להשאיר נושא ריק; טקסט בנושא יבצע גם חיפוש, וכתובת RSS תבקש גם קטלוג.
הקטלוג כולל את הפרקים הזמינים כרגע בפיד, לא בהכרח את כל פרקי העבר. התיאורים עשויים להיות מקוצרים. קטלוג גדול במיוחד נשמר בדרייב ונשלח קישור פרטי אליו.
עריכה ידנית: הקובץ podcasts.txt נמצא ב״פודקאסטים 2.0״ ← ״קבצי מערכת״. הדוגמה הבאה תקינה מבחינת התחביר; מחליפים את הכתובות ב-RSS אמיתי.
# Automatic downloads
https://example.com/podcast/feed.xml
# Weekly notifications only
https://example.com/alerts/feed.xml --notify-only
30
המספר בשורה שאחרי כתובת הערוץ מגדיר כמה ימים לאחור לסרוק. ללא מספר, ברירת המחדל היא 7 ימים. אפשר להוסיף --notify-only גם לנושא מייל ההרשמה. חשוב לשמור את תיקיית ״קבצי מערכת״, שבה נמצאים המינויים וההתקדמות.
פודקי מוכן. אחרי הוספת ערוצים, פרקים יורדו לדרייב או יופיעו בהתראות — בהתאם לבחירה שלך. הטיפול בבקשות עשוי להימשך כמה שעות.
חזרה
פודקי · בוט הפודקאסטים שלך קוד פתוח · נבנה למי שאוהבים להקשיב מה חדש בגרסה 4.0 ↗
כדי לעבור בין שלבי ההתקנה ולהעתיק את הקוד, יש להפעיל JavaScript בדפדפן. פתיחת המאגר
```

### דף ההתקנה — תיאורים, נגישות ושדות


- WEB-001 · `description`: פודקי מנהל את הפודקאסטים שלך דרך המייל: הורדות לגוגל דרייב, התראות בלבד, חיפוש פרקים וקטלוג לבחירה מרובה. התקנה בחשבון Google שלך.

- WEB-002 · `og:title`: פודקי — בוט הפודקאסטים שלך

- WEB-003 · `og:description`: מורידים, מחפשים ובוחרים פרקים. פודקי מסדר את הפודקאסטים שלך בדרייב — בשליטה דרך המייל.

- WEB-004 · `aria-label`: פודקי — דף הבית

- WEB-005 · `aria-label`: שלבי ההתקנה

- WEB-006 · `aria-label`: שלב 1: היכרות

- WEB-007 · `aria-label`: שלב 2: פרטיות

- WEB-008 · `aria-label`: שלב 3: התקנה

- WEB-009 · `alt`: פודקי, רובוט כחול עם אוזניות, מנופף לשלום


## מיילים, קטלוג, כפתורים והודעות למשתמש


### קבועים ואתחול


**TXT-001** · `files/podcast_processor_v2.js:31` · `קבועים ואתחול`

```text
שים לב: מיילים הנשלחים לכתובות אלו נאספים ומעובדים אוטומטית בהתאם למדיניות השירות.
```


### scanFeed


**TXT-002** · `files/podcast_processor_v2.js:227` · `scanFeed`

```text
פודקאסט_ללא_שם
```


**TXT-003** · `files/podcast_processor_v2.js:252` · `scanFeed`

```text
פרק_{{j + 1}}
```


### sendFailureEmail


**TXT-004** · `files/podcast_processor_v2.js:361` · `sendFailureEmail`

```text
⚠️ פרק לא הורד אחרי {{MAX_RETRIES}} נסיונות — {{item.channelTitle}}
```


**TXT-005** · `files/podcast_processor_v2.js:362` · `sendFailureEmail`

```text
הורדת פרק נכשלה
```


**TXT-006** · `files/podcast_processor_v2.js:363` · `sendFailureEmail`

```text
{{escapeHtml(item.episodeTitle)}}
שגיאה אחרונה: {{escapeHtml(lastError)}}
```


### writeMergedPodcastsFile


**TXT-007** · `files/podcast_processor_v2.js:420` · `writeMergedPodcastsFile`

```text
# רשימת פודקאסטים
```


### ensureRssFileExists


**TXT-008** · `files/podcast_processor_v2.js:473` · `ensureRssFileExists`

```text
# רשימת פודקאסטים
```


### מייל פתיחה והדרכה


**TXT-009** · `files/podcast_processor_v2.js:487` · `sendMissingRssFileEmail`

```text
# הרשמה רגילה — הורדה אוטומטית
https://example.com/regular/feed.xml
# התראות בלבד — ללא הורדה אוטומטית
https://example.com/alerts/feed.xml --notify-only
# התראות בלבד, עם סריקה של 30 ימים לאחור
https://example.com/month/feed.xml --notify-only
30
```


**TXT-010** · `files/podcast_processor_v2.js:490` · `sendMissingRssFileEmail`

```text
היי, נעים להכיר — אני פודקי 🎧
אני בוט הפודקאסטים שלך, ופועל בחשבון Google שלך בריצות אוטומטיות פעם בשעה. אפשר להתחיל בהוספת ערוץ באמצעות הכפתור הבא. בנושא המייל שייפתח יש להזין כתובת RSS או שם פודקאסט לחיפוש, ולשלוח.
{{buildAddChannelBtn()}}
איך רוצים לעקוב אחר הערוצים?
הירשם — פרקים חדשים יורדו אוטומטית לתיקיית הערוץ בדרייב.
הירשם להתראות בלבד — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית. ליד כל פרק יופיע קבל פרק, כדי לבקש רק את הפרקים הרצויים לך.
אפשר לשנות את סוג ההרשמה או להסיר ערוץ באמצעות הכפתורים שלידו במיילים. הכפתור קבל פרק אינו משנה את סוג ההרשמה.
רוצים לבחור מתוך פרקים קודמים?
הכפתור קבל פרקים שליד כל ערוץ שולח קטלוג של הפרקים הזמינים כרגע בפיד. בקטלוג קצר אפשר לבקש פרק בודד ישירות מהמייל. בכל קטלוג מצורף גם קובץ HTML לחיפוש בכותרות ובתיאורים, מיון ובחירת כמה פרקים יחד. קטלוג גדול במיוחד נשמר בדרייב שלך ונשלח קישור פרטי להורדתו.
בקשה של כמה פרקים: הורד את קובץ ה-HTML ופתח אותו בדפדפן, סמן פרקים והורד את קובץ הבחירה JSON. פתח מייל לכתובת קבלת הפרקים באמצעות הכפתור בקטלוג, צרף אליו את ה-JSON ושלח. אין צורך בנושא מיוחד, ואפשר להשאירו ריק. פתיחת מייל אינה מצרפת את הקובץ אוטומטית. ניתן לבחור עד 1,000 פרקים בקובץ אחד; בקשות גדולות יטופלו בהדרגה בין ריצות.
יש לפתוח את ה-HTML בדפדפן ולא בתצוגה המקדימה של Gmail. באנדרואיד יש להשתמש בדפדפן שתומך בקובצי HTML מקומיים. התיאורים עשויים להיות מקוצרים, והקטלוג אינו מבטיח לכלול פרקים ישנים שהמפרסם הסיר מהפיד.
חיפוש פרק מסוים
לחץ על חפש פרק בתחתית כל הודעה, כתוב בנושא שם פרק, שם מגיש או מילות חיפוש ושלח. אחפש פרקים באפל פודקאסטים ואשלח תוצאות עם כפתור קבל פרק. הזמינות תלויה בקטלוג של אפל ובמפרסם. לחיפוש ערוץ שלם השתמש בהוסף ערוץ.
קובצי JSON מזוהים אוטומטית. נושא ההודעה נבדק בנפרד גם כשמצורף קובץ: טקסט חופשי יבצע בנוסף חיפוש, כתובת RSS תבקש בנוסף קטלוג, ובקשת JSON בנושא תמשיך לפעול כבעבר. בחירת פרקים אינה משנה את המינוי לערוץ.
ניהול ידני בדרייב
אפשר לערוך את הקובץ podcasts.txt בתיקיית פודקאסטים 2.0, בתוך תיקיית קבצי מערכת.
להרשמה רגילה מוסיפים כתובת RSS בשורה נפרדת. להתראות בלבד מוסיפים בסוף אותה שורה רווח ואת הדגל --notify-only . אפשר להשתמש באותו דגל גם בסוף נושא מייל ההרשמה.
בשורה שאחרי כתובת הערוץ אפשר להוסיף מספר ימים לסריקה לאחור. ברירת המחדל היא שבעה ימים. שורות שמתחילות בסימן # הן הערות.
דוגמת קובץ TXT תקינה מבחינת התחביר:
{{escapeHtml(example)}}
הכתובות בדוגמה הן להמחשה בלבד. יש להחליף אותן בכתובות RSS אמיתיות של הערוצים שלך.
הדיווח השבועי
המייל השבועי יכלול דוח הורדות ופרקים חדשים מערוצי התראות בלבד, עם הבחנה ברורה ביניהם. דוח ארוך יפוצל להודעות ממוספרות; אם השליחה נעצרת, היא תימשך מהחלק הבא בריצה הבאה. לאחר הרשמה, הסריקה הראשונה כוללת את טווח הימים המוגדר לערוץ.
כדאי לדעת
הטיפול בבקשות מתבצע בריצות האוטומטיות, ולכן עשוי להימשך מספר שעות. אפשר לשלוח כמה בקשות בלי להמתין לטיפול בקודמת. ניתן להריץ ידנית את הפונקציה setUp בפרויקט Apps Script.
אפשר למחוק קובצי פרקים שכבר הורדת. חשוב לשמור את תיקיית קבצי מערכת, שבה נמצאים המינויים, ההיסטוריה וההתקדמות.
לא קיבלת מייל? בדוק ספאם וקידומים ואת הרשאות הפרויקט. ביומן הרצות בפרויקט אפשר לבדוק אם התרחשה שגיאה.
פרטיות
פקודות המייל מעובדות מתוך תיבת נשלח. מיילים לכתובות הבקרה הייעודיות גלויים למנהל השירות ונאספים בהתאם למדיניות הפרטיות. עריכה ידנית של קובץ המינויים אינה שולחת פקודת מייל; איסוף כתובת המייל בכל ריצה, כפי שמתואר במדיניות הקיימת, ממשיך לחול.
```


**TXT-011** · `files/podcast_processor_v2.js:520` · `sendMissingRssFileEmail`

```text
🎉 פודקאסטים 2.0 — המערכת מוכנה לשימוש
```


**TXT-012** · `files/podcast_processor_v2.js:520` · `sendMissingRssFileEmail`

```text
ברוכים הבאים למערכת
```


### downloadChunked


**TXT-013** · `files/podcast_processor_v2.js:605` · `downloadChunked`

```text
פתיחת Resumable Upload נכשלה: HTTP {{initResp.getResponseCode()}}
```


**TXT-014** · `files/podcast_processor_v2.js:608` · `downloadChunked`

```text
חסר Location header
```


**TXT-015** · `files/podcast_processor_v2.js:637` · `downloadChunked`

```text
הורדת chunk נכשלה: HTTP {{chunkCode}}
```


**TXT-016** · `files/podcast_processor_v2.js:659` · `downloadChunked`

```text
העלאת chunk נכשלה: HTTP {{uploadCode}}
```


### createLrcFile


**TXT-017** · `files/podcast_processor_v2.js:764` · `createLrcFile`

```text
פודקאסט: {{meta.channelTitle}}
```


**TXT-018** · `files/podcast_processor_v2.js:765` · `createLrcFile`

```text
פרק: {{meta.episodeTitle}}
```


**TXT-019** · `files/podcast_processor_v2.js:766` · `createLrcFile`

```text
תאריך פרסום: {{pd}}
```


**TXT-020** · `files/podcast_processor_v2.js:767` · `createLrcFile`

```text
מגיש: {{meta.author || ""}}
```


**TXT-021** · `files/podcast_processor_v2.js:768` · `createLrcFile`

```text
משך: {{meta.duration || ""}}
```


**TXT-022** · `files/podcast_processor_v2.js:770` · `createLrcFile`

```text
עונה: {{meta.season}}
```


**TXT-023** · `files/podcast_processor_v2.js:771` · `createLrcFile`

```text
מספר פרק: {{meta.episodeNumber}}
```


**TXT-024** · `files/podcast_processor_v2.js:772` · `createLrcFile`

```text
כותרת משנה: {{meta.subtitle}}
```


**TXT-025** · `files/podcast_processor_v2.js:775` · `createLrcFile`

```text
תיאור:
```


### כפתורי פעולה לערוץ


**TXT-026** · `files/podcast_processor_v2.js:1153` · `buildChannelControlButtons`

```text
פרטי הערוץ יעודכנו בסריקה הבאה
```


**TXT-027** · `files/podcast_processor_v2.js:1157` · `buildChannelControlButtons`

```text
הסר
```


**TXT-028** · `files/podcast_processor_v2.js:1158` · `buildChannelControlButtons`

```text
שלח מייל זה להסרת הערוץ {{channelTitle}}.
{{PRIVACY_NOTE}}
```


**TXT-029** · `files/podcast_processor_v2.js:1160` · `buildChannelControlButtons`

```text
קבל פרקים
```


**TXT-030** · `files/podcast_processor_v2.js:1161` · `buildChannelControlButtons`

```text
שלח מייל זה לקבלת קטלוג הפרקים של {{channelTitle}}.
{{PRIVACY_NOTE}}
```


### כפתור הוספת ערוץ


**TXT-031** · `files/podcast_processor_v2.js:1166` · `buildAddChannelBtn`

```text
+ הוסף ערוץ
```


**TXT-032** · `files/podcast_processor_v2.js:1167` · `buildAddChannelBtn`

```text
[כתובת RSS או מחרוזת חיפוש]
```


**TXT-033** · `files/podcast_processor_v2.js:1168` · `buildAddChannelBtn`

```text
אם אתה יודע את כתובת הפיד RSS של הפודקאסט, מלא אותה בכותרת. אחרת מלא את שם הפודקאסט/נושא/מגיש לחיפוש. לאחר מכן שלח מייל זה. הבקשה תטופל תוך מספר שעות.
{{PRIVACY_NOTE}}
```


### מייל אחסון נמוך


**TXT-034** · `files/podcast_processor_v2.js:1220` · `sendStorageEmail`

```text
היי, פודקי כאן. אני ממתין למקום פנוי בדרייב: נותרו פחות מ־2GiB. ההורדות הבאות נשמרו בתור ולא בוטלו.
```


**TXT-035** · `files/podcast_processor_v2.js:1226` · `sendStorageEmail`

```text
פנה מקום בדרייב. אנסה להמשיך את ההורדות בריצות הבאות. אין צורך לבקש שוב את אותם פרקים.
{{buildAddChannelBtn()}}
```


**TXT-036** · `files/podcast_processor_v2.js:1228` · `sendStorageEmail`

```text
💾 פודקאסטים 2.0 — נפח אחסון נמוך
```


**TXT-037** · `files/podcast_processor_v2.js:1228` · `sendStorageEmail`

```text
פרקים ממתינים לאחסון
```


### מייל עדכון מינויים


**TXT-038** · `files/podcast_processor_v2.js:1240` · `sendSubscriptionEmail`

```text
היי! עדכנתי את רשימת הערוצים שלך. ליד כל ערוץ מופיעים סוג ההרשמה וטווח הסריקה. אפשר לשנות מצב בלי ליצור הרשמה כפולה.
```


**TXT-039** · `files/podcast_processor_v2.js:1253` · `sendSubscriptionEmail`

```text
🔔 התראות בלבד — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית.
```


**TXT-040** · `files/podcast_processor_v2.js:1253` · `sendSubscriptionEmail`

```text
⬇️ הרשמה רגילה — פרקים חדשים יורדו אוטומטית לדרייב.
```


**TXT-041** · `files/podcast_processor_v2.js:1253` · `sendSubscriptionEmail`

```text
{{rss.notifyOnly ? '🔔 התראות בלבד — פרקים חדשים יופיעו במייל השבועי, ללא הורדה אוטומטית.' : '⬇️ הרשמה רגילה — פרקים חדשים יורדו אוטומטית לדרייב.'}}
טווח סריקה: {{rss.days}} ימים
{{reason ? '
לא ניתן היה לעדכן פרטי ערוץ: '+escapeHtml(reason)+'
' : ''}}
```


**TXT-042** · `files/podcast_processor_v2.js:1255` · `sendSubscriptionEmail`

```text
לא ניתן היה לעדכן פרטי ערוץ: {{escapeHtml(reason)}}
```


**TXT-043** · `files/podcast_processor_v2.js:1258` · `sendSubscriptionEmail`

```text
אין כרגע ערוצים ברשימת ההרשמה.
```


**TXT-044** · `files/podcast_processor_v2.js:1261` · `sendSubscriptionEmail`

```text
📋 פודקאסטים 2.0 — רשימת מינויים עודכנה
```


**TXT-045** · `files/podcast_processor_v2.js:1261` · `sendSubscriptionEmail`

```text
עדכון רשימת מינויים
```


### sendITunesErrorEmail


**TXT-046** · `files/podcast_processor_v2.js:1432` · `sendITunesErrorEmail`

```text
לא ניתן היה לחפש פודקאסטים עבור: {{query}}
שגיאת תקשורת עם Apple Podcasts API לאחר {{attempts}} נסיונות.
נסה לחפש שוב מאוחר יותר או הכנס כתובת RSS ישירות.
{{buildAddChannelBtn()}}
```


**TXT-047** · `files/podcast_processor_v2.js:1438` · `sendITunesErrorEmail`

```text
⚠️ פודקאסטים 2.0 — חיפוש נכשל: {{query}}
```


**TXT-048** · `files/podcast_processor_v2.js:1439` · `sendITunesErrorEmail`

```text
שגיאת חיפוש
```


### מייל תוצאות חיפוש ערוצים


**TXT-049** · `files/podcast_processor_v2.js:1444` · `sendPodcastSearchResultsEmail`

```text
היי! חיפשתי עבורך ערוצים באפל פודקאסטים עבור: {{escapeHtml(query)}}
```


**TXT-050** · `files/podcast_processor_v2.js:1447` · `sendPodcastSearchResultsEmail`

```text
· {{r.episodeCount}} פרקים
```


**TXT-051** · `files/podcast_processor_v2.js:1450` · `sendPodcastSearchResultsEmail`

```text
🔍 תוצאות חיפוש: {{query}}
```


**TXT-052** · `files/podcast_processor_v2.js:1450` · `sendPodcastSearchResultsEmail`

```text
תוצאות חיפוש פודקאסטים
```


### מייל ללא תוצאות


**TXT-053** · `files/podcast_processor_v2.js:1457` · `sendNoResultsEmail`

```text
לא נמצאו תוצאות עבור: {{query}}
נסה לחפש עם מילות מפתח שונות (שם מגיש, נושא, שם תוכנית), או הכנס כתובת RSS ישירות.
{{buildAddChannelBtn()}}
```


**TXT-054** · `files/podcast_processor_v2.js:1462` · `sendNoResultsEmail`

```text
🔍 פודקאסטים 2.0 — לא נמצאו תוצאות: {{query}}
```


**TXT-055** · `files/podcast_processor_v2.js:1463` · `sendNoResultsEmail`

```text
אין תוצאות חיפוש
```


### addSpecificEpisodeToQueueEx


**TXT-056** · `files/podcast_processor_v2.js:1496` · `addSpecificEpisodeToQueueEx`

```text
פרק
```


### sendProcessedEmailsSummary


**TXT-057** · `files/podcast_processor_v2.js:1544` · `sendProcessedEmailsSummary`

```text
הפרקים הבאים נוספו לתור ההורדות לפי בקשתך:
```


**TXT-058** · `files/podcast_processor_v2.js:1547` · `sendProcessedEmailsSummary`

```text
פרק
```


**TXT-059** · `files/podcast_processor_v2.js:1552` · `sendProcessedEmailsSummary`

```text
הפרקים יורדו בריצה הקרובה.
```


**TXT-060** · `files/podcast_processor_v2.js:1555` · `sendProcessedEmailsSummary`

```text
📥 פודקאסטים 2.0 — {{episodeItems.length}} פרקים נוספו לתור
```


**TXT-061** · `files/podcast_processor_v2.js:1556` · `sendProcessedEmailsSummary`

```text
פרקים בתור הורדה
```


### בדיקת בקשת הרשמה


**TXT-062** · `files/podcast_processor_v2.js:1568` · `parseSubscriptionInput`

```text
דגל הרשמה לא מוכר; השתמש ב־--notify-only
```


**TXT-063** · `files/podcast_processor_v2.js:1570` · `parseSubscriptionInput`

```text
כתובת RSS אינה יכולה להכיל רווחים
```


### כפתור שינוי הרשמה


**TXT-064** · `files/podcast_processor_v2.js:1582` · `buildSubscriptionButton`

```text
הירשם להתראות בלבד
```


**TXT-065** · `files/podcast_processor_v2.js:1582` · `buildSubscriptionButton`

```text
הירשם
```


**TXT-066** · `files/podcast_processor_v2.js:1584` · `buildSubscriptionButton`

```text
שלח מייל זה {{notifyOnly?'לקבלת התראות שבועיות בלבד, ללא הורדה אוטומטית':'להפעלת הורדה אוטומטית'}} עבור הערוץ {{title}}.
{{PRIVACY_NOTE}}
```


**TXT-067** · `files/podcast_processor_v2.js:1584` · `buildSubscriptionButton`

```text
לקבלת התראות שבועיות בלבד, ללא הורדה אוטומטית
```


**TXT-068** · `files/podcast_processor_v2.js:1584` · `buildSubscriptionButton`

```text
להפעלת הורדה אוטומטית
```


### כפתור בקשת פרק


**TXT-069** · `files/podcast_processor_v2.js:1590` · `buildGetEpisodeButton`

```text
קבל פרק
```


**TXT-070** · `files/podcast_processor_v2.js:1592` · `buildGetEpisodeButton`

```text
שלח מייל זה לבקשת הפרק {{episodeTitle}} מהערוץ {{channelTitle}}. סוג ההרשמה לערוץ לא ישתנה.
{{PRIVACY_NOTE}}
```


### sendInvalidSubscriptionEmail


**TXT-071** · `files/podcast_processor_v2.js:1653` · `sendInvalidSubscriptionEmail`

```text
⚠️ פודקאסטים 2.0 — בקשת הרשמה לא תקינה
```


**TXT-072** · `files/podcast_processor_v2.js:1654` · `sendInvalidSubscriptionEmail`

```text
לא שינינו את ההרשמה
```


**TXT-073** · `files/podcast_processor_v2.js:1654` · `sendInvalidSubscriptionEmail`

```text
{{escapeHtml(error)}}
דוגמה לנושא תקין:
https://example.com/feed.xml --notify-only
```


### תחתית המייל


**TXT-074** · `files/podcast_processor_v2.js:1696` · `podkiFooter`

```text
חפש פרק
```


**TXT-075** · `files/podcast_processor_v2.js:1697` · `podkiFooter`

```text
כתוב בנושא המייל את שם הפרק, שם מגיש או מילות החיפוש ושלח. לחיפוש ערוץ השתמש בכפתור הוסף ערוץ.
{{PRIVACY_NOTE}}
```


**TXT-076** · `files/podcast_processor_v2.js:1696` · `podkiFooter`

```text
{{buildAddChannelBtn()}}{{buildMailtoBtn('חפש פרק',CTRL_GET_EPISODE,'', 'כתוב בנושא המייל את שם הפרק, שם מגיש או מילות החיפוש ושלח. לחיפוש ערוץ השתמש בכפתור הוסף ערוץ.\n\n'+PRIVACY_NOTE,'#1d4ed8')}}
אני פועל בריצות האוטומטיות של הסקריפט, בדרך כלל פעם בשעה. הטיפול עשוי להימשך כמה שעות. לחיצה על כפתור פותחת מייל מוכן; יש לשלוח אותו כדי לבצע את הפעולה.
פקודות וקובצי בחירה שנשלחים לכתובות הבקרה גלויים למנהל השירות ומעובדים אוטומטית בהתאם למדיניות השירות. עריכה ידנית של podcasts.txt אינה שולחת פקודת מייל; דיווח כתובת המשתמש לטופס בכל ריצה נשאר כפי שמוגדר במערכת.
```


### מעטפת המייל


**TXT-077** · `files/podcast_processor_v2.js:1713` · `_emailWrap`

```text
פודקי 🎧
{{escapeHtml(title)}}
{{body}}{{podkiFooter()}}
פודקי · בוט הפודקאסטים שלך · גרסה {{PODKI_VERSION}} · {{escapeHtml(formatDate(new Date()))}}
```


- `alt`: פודקי — בוט הפודקאסטים שלך

### שם השולח ותצוגת טקסט חלופית


**TXT-078** · `files/podcast_processor_v2.js:1726` · `podkiSendEmail`

```text
פודקי — בוט הפודקאסטים שלך
```


**TXT-079** · `files/podcast_processor_v2.js:1727` · `podkiSendEmail`

```text
עדכון מפודקי
```


**TXT-080** · `files/podcast_processor_v2.js:1727` · `podkiSendEmail`

```text
פודקי
```


**TXT-081** · `files/podcast_processor_v2.js:1728` · `podkiSendEmail`

```text
פודקי
```


**TXT-082** · `files/podcast_processor_v2.js:1728` · `podkiSendEmail`

```text
פודקי | {{message.subject}}
```


**TXT-083** · `files/podcast_processor_v2.js:1729` · `podkiSendEmail`

```text
היי, כאן פודקי. הודעה זו כוללת עדכון על בקשת הפודקאסטים שלך. לצפייה בפרטים ובכפתורי הפעולה פתח אותה בתצוגת HTML. קובץ מצורף, אם קיים, יש להוריד ולפתוח בדפדפן.
```


### בדיקת קובץ הבחירה


**TXT-084** · `files/podcast_processor_v2.js:1755` · `podkiSelection`

```text
פריט {{i+1}}: חסרה כתובת RSS תקינה או מזהה פרק.
```


### processGetEpisodeEmail


**TXT-085** · `files/podcast_processor_v2.js:1772` · `processGetEpisodeEmail`

```text
קובץ
```


**TXT-086** · `files/podcast_processor_v2.js:1775` · `processGetEpisodeEmail`

```text
הקובץ {{name}} אינו קובץ בחירה JSON ולכן לא טופל.
```


**TXT-087** · `files/podcast_processor_v2.js:1786` · `processGetEpisodeEmail`

```text
הבחירה שבקובץ {{name}} כבר נקלטה. לא נוספו הורדות כפולות.
```


**TXT-088** · `files/podcast_processor_v2.js:1798` · `processGetEpisodeEmail`

```text
נושא ההודעה אינו בקשת JSON תקינה: {{e.message}}
```


**TXT-089** · `files/podcast_processor_v2.js:1805` · `processGetEpisodeEmail`

```text
לא נמצא קובץ בחירה או נושא לחיפוש. צרף JSON, כתוב מילות חיפוש בנושא, או כתובת RSS לקבלת קטלוג.
```


### קריאת פיד פרקים


**TXT-090** · `files/podcast_processor_v2.js:1822` · `podkiReadFeed`

```text
פרק ללא כותרת
```


### הוספת פרק לתור


**TXT-091** · `files/podcast_processor_v2.js:1845` · `podkiQueueEpisode`

```text
הפרק אינו זמין עוד בפיד, ולא נמצאה כתובת אודיו מאומתת מתוצאות אפל.
```


### podkiPumpJobs


**TXT-092** · `files/podcast_processor_v2.js:1907` · `podkiPumpJobs`

```text
לא הצלחתי להשלים את הבקשה לאחר כמה ניסיונות: {{e.message}}. אפשר לשלוח בקשה חדשה.
```


### מייל בקשה שדורשת תיקון


**TXT-093** · `files/podcast_processor_v2.js:1914` · `podkiSendNotice`

```text
היי, פודקי כאן. בדקתי את ההודעה שלך.
{{notice.accepted?'
'+notice.accepted+' פעולות תקינות נקלטו ויטופלו בנפרד. מצב ההרשמה לערוצים לא השתנה.
':'
לא נוספה פעולה תקינה מהחלקים המפורטים כאן.
'}}{{notice.errors.map(function(e){return '
'+escapeHtml(e)+'
';}).join('')}}
לבקשה מרובה, הורד קובץ בחירה מהקטלוג וצרף אותו למייל לכתובת {{escapeHtml(CTRL_GET_EPISODE)}} . אפשר להשאיר את הנושא ריק. נושא עם טקסט חופשי מבצע גם חיפוש; כתובת RSS בנושא מבקשת גם קטלוג.
```


**TXT-094** · `files/podcast_processor_v2.js:1915` · `podkiSendNotice`

```text
{{notice.accepted}} פעולות תקינות נקלטו ויטופלו בנפרד. מצב ההרשמה לערוצים לא השתנה.
```


**TXT-095** · `files/podcast_processor_v2.js:1915` · `podkiSendNotice`

```text
לא נוספה פעולה תקינה מהחלקים המפורטים כאן.
```


**TXT-096** · `files/podcast_processor_v2.js:1918` · `podkiSendNotice`

```text
הבקשה שלך צריכה בדיקה קטנה
```


**TXT-097** · `files/podcast_processor_v2.js:1918` · `podkiSendNotice`

```text
בקשה שדורשת תיקון
```


### מייל קיבלתי את הבחירה שלך


**TXT-098** · `files/podcast_processor_v2.js:1925` · `podkiSendRequestSummary`

```text
היי! קיבלתי את הבחירה שלך: {{queued}} פרקים נוספו לתור, {{existing}} כבר ממתינים, ו-{{failed}} לא נוספו.
זהו אישור קליטה לתור, לא אישור שההורדות הושלמו. ההורדות יתקדמו בריצות האוטומטיות לפי הזמן והמקום הפנוי. קובץ שכבר קיים בדרייב לא יידרס. סוג ההרשמה לכל ערוץ נשאר כפי שהיה.
```


**TXT-099** · `files/podcast_processor_v2.js:1928` · `podkiSendRequestSummary`

```text
נוסף לתור
```


**TXT-100** · `files/podcast_processor_v2.js:1928` · `podkiSendRequestSummary`

```text
כבר ממתין בתור
```


**TXT-101** · `files/podcast_processor_v2.js:1928` · `podkiSendRequestSummary`

```text
לא נוסף לתור
```


**TXT-102** · `files/podcast_processor_v2.js:1936` · `podkiSendRequestSummary`

```text
קיבלתי את הבחירה שלך — {{queued}} פרקים נוספו לתור{{pages.length>1?' | חלק '+(i+1)+' מתוך '+pages.length:''}}
```


**TXT-103** · `files/podcast_processor_v2.js:1936` · `podkiSendRequestSummary`

```text
| חלק {{i+1}} מתוך {{pages.length}}
```


**TXT-104** · `files/podcast_processor_v2.js:1937` · `podkiSendRequestSummary`

```text
פרקים בתור ההורדה
```


### חיפוש פרקים באפל


**TXT-105** · `files/podcast_processor_v2.js:1961` · `podkiSearchEpisodes`

```text
פרק ללא כותרת
```


**TXT-106** · `files/podcast_processor_v2.js:1961` · `podkiSearchEpisodes`

```text
ערוץ
```


**TXT-107** · `files/podcast_processor_v2.js:1962` · `podkiSearchEpisodes`

```text
{{Math.round(r.trackTimeMillis/60000)}} דקות
```


### מייל תוצאות חיפוש פרקים


**TXT-108** · `files/podcast_processor_v2.js:1973` · `podkiSendEpisodeSearch`

```text
היי! חיפשתי באפל פודקאסטים את {{escapeHtml(query)}}.
{{ביטוי דינמי; ראו מקור}}
```


**TXT-109** · `files/podcast_processor_v2.js:1974` · `podkiSendEpisodeSearch`

```text
מצאתי {{results.length}} תוצאות שניתן לבקש. בחירת פרק אינה רושמת אותך לערוץ.
```


**TXT-110** · `files/podcast_processor_v2.js:1974` · `podkiSendEpisodeSearch`

```text
לא מצאתי תוצאות עם פרטים מספיקים לבקשת פרק. נסה שם פרק, שם מגיש או מילות חיפוש אחרות.
```


**TXT-111** · `files/podcast_processor_v2.js:1978` · `podkiSendEpisodeSearch`

```text
קבל פרק
```


**TXT-112** · `files/podcast_processor_v2.js:1979` · `podkiSendEpisodeSearch`

```text
שלח את ההודעה כדי לבקש את הפרק {{e.episodeTitle}}. ההרשמה לערוץ לא תשתנה.
{{PRIVACY_NOTE}}
```


**TXT-113** · `files/podcast_processor_v2.js:1981` · `podkiSendEpisodeSearch`

```text
מצאתי פרקים עבור ״{{query}}״
```


**TXT-114** · `files/podcast_processor_v2.js:1981` · `podkiSendEpisodeSearch`

```text
תוצאות חיפוש פרקים
```


### podkiGroupedEpisodeCards


**TXT-115** · `files/podcast_processor_v2.js:2000` · `podkiGroupedEpisodeCards`

```text
דוח מפודקי
```


### podkiPackBlocks


**TXT-116** · `files/podcast_processor_v2.js:2011` · `podkiPackBlocks`

```text
דוח מפודקי
```


**TXT-117** · `files/podcast_processor_v2.js:2012` · `podkiPackBlocks`

```text
דוח מפודקי
```


### מייל סיכום שבועי


**TXT-118** · `files/podcast_processor_v2.js:2031` · `sendWeeklyEmail`

```text
🔔 פרק חדש — התראות בלבד
```


**TXT-119** · `files/podcast_processor_v2.js:2031` · `sendWeeklyEmail`

```text
✅ הורד לדרייב
```


**TXT-120** · `files/podcast_processor_v2.js:2031` · `sendWeeklyEmail`

```text
❌ ההורדה נכשלה
```


**TXT-121** · `files/podcast_processor_v2.js:2033` · `sendWeeklyEmail`

```text
פתח את הפרק בדרייב
```


**TXT-122** · `files/podcast_processor_v2.js:2041` · `sendWeeklyEmail`

```text
אין פעילות בדוח השבוע. מצב המינוי: {{r.notifyOnly?'התראות בלבד':'הורדה אוטומטית'}}.
```


**TXT-123** · `files/podcast_processor_v2.js:2041` · `sendWeeklyEmail`

```text
התראות בלבד
```


**TXT-124** · `files/podcast_processor_v2.js:2041` · `sendWeeklyEmail`

```text
הורדה אוטומטית
```


**TXT-125** · `files/podcast_processor_v2.js:2042` · `sendWeeklyEmail`

```text
היי! הנה השבוע שלך עם פודקי: {{counts.success}} פרקים הורדו, {{counts.notification}} פרקים חדשים להתראות בלבד{{counts.failed?', ו-'+counts.failed+' הורדות נכשלו':''}}.
```


**TXT-126** · `files/podcast_processor_v2.js:2042` · `sendWeeklyEmail`

```text
, ו-{{counts.failed}} הורדות נכשלו
```


**TXT-127** · `files/podcast_processor_v2.js:2051` · `sendWeeklyEmail`

```text
חלק {{i+1}} מתוך {{delivery.pages.length}}
```


**TXT-128** · `files/podcast_processor_v2.js:2052` · `sendWeeklyEmail`

```text
השבוע שלך עם פודקי 🎧 — {{part}}
```


**TXT-129** · `files/podcast_processor_v2.js:2053` · `sendWeeklyEmail`

```text
סיכום שבועי — {{part}}
```


**TXT-130** · `files/podcast_processor_v2.js:2053` · `sendWeeklyEmail`

```text
{{delivery.pages[i]}}
{{part}} של הדוח. פרקים שנסרקו לאחר הכנת הדוח יישמרו לדוח הבא.
```


### מייל הקטלוג המצורף


**TXT-131** · `files/podcast_processor_v2.js:2065` · `sendEpisodeCatalogEmail`

```text
קטלוג פודקי {{sanitizeFileName(feed.title) || 'ערוץ'}}.html
```


**TXT-132** · `files/podcast_processor_v2.js:2065` · `sendEpisodeCatalogEmail`

```text
ערוץ
```


**TXT-133** · `files/podcast_processor_v2.js:2066` · `sendEpisodeCatalogEmail`

```text
היי! אספתי עבורך {{feed.episodes.length}} פרקים זמינים בפיד של {{escapeHtml(feed.title)}}.
הקטלוג כולל את הפרקים שהמפרסם מספק כרגע בפיד, ולא בהכרח את כל הפרקים שפורסמו בעבר. חלק מהתיאורים מקוצרים.
```


**TXT-134** · `files/podcast_processor_v2.js:2068` · `sendEpisodeCatalogEmail`

```text
לבחירה מרובה: הורד את קובץ ה-HTML ופתח אותו בדפדפן, חפש וסמן פרקים, הורד את קובץ הבחירה „הקבצים שבחרתי.json” וצרף אותו למייל לכתובת {{escapeHtml(CTRL_GET_EPISODE)}} . אין צורך בנושא מיוחד, ואפשר להשאירו ריק. אם תכתוב טקסט בנושא, אבצע גם חיפוש; כתובת RSS בנושא תבקש גם קטלוג.
הקטלוג אינטראקטיבי לאחר פתיחה בדפדפן, לא בתצוגה המקדימה של Gmail. באנדרואיד יש להוריד ולפתוח בדפדפן שתומך בקובצי HTML מקומיים. הכפתור לפתיחת מייל אינו מצרף את הקובץ אוטומטית.
ההורדות ייכנסו לתור; בחירת פרקים אינה משנה את המינוי לערוץ.
```


**TXT-135** · `files/podcast_processor_v2.js:2079` · `sendEpisodeCatalogEmail`

```text
מצורף: {{escapeHtml(catalogName)}}. אפשר לחפש ולבחור בו גם ללא חיבור לרשת.
```


**TXT-136** · `files/podcast_processor_v2.js:2083` · `sendEpisodeCatalogEmail`

```text
הקטלוג גדול מדי לצירוף בטוח. שמרתי אותו בדרייב שלך ללא פתיחת שיתוף ציבורי: הורד את הקטלוג מהדרייב .
```


**TXT-137** · `files/podcast_processor_v2.js:2085` · `sendEpisodeCatalogEmail`

```text
קטלוג
```


**TXT-138** · `files/podcast_processor_v2.js:2085` · `sendEpisodeCatalogEmail`

```text
הפרקים זמינים גם כאן
{{inline}}
```


**TXT-139** · `files/podcast_processor_v2.js:2086` · `sendEpisodeCatalogEmail`

```text
הרשימה ארוכה ולכן מופיעה בקטלוג בלבד; נשלחת הודעה אחת במקום כמה הודעות קטלוג.
```


**TXT-140** · `files/podcast_processor_v2.js:2088` · `sendEpisodeCatalogEmail`

```text
הקטלוג של ״{{feed.title}}״ מוכן 📚
```


**TXT-141** · `files/podcast_processor_v2.js:2088` · `sendEpisodeCatalogEmail`

```text
הקטלוג שלך
```


### הקטלוג — תוכן הדף


**TXT-142** · `files/podcast_processor_v2.js:2097` · `podkiCatalogHtml`

```text
{{escapeHtml(feed.title)}} | פודקי
הקטלוג שלך עם פודקי 🎧
{{escapeHtml(feed.title)}}
כל הפרקים הזמינים בפיד בעת יצירת הקטלוג. התיאורים עשויים להיות מקוצרים. אפשר לחפש ולבחור ללא רשת.
איך מבקשים כמה פרקים?
סמן פרקים והורד את הקובץ „הקבצים שבחרתי.json”.
פתח מייל לכתובת {{CTRL_GET_EPISODE}} .
צרף את קובץ ה-JSON ושלח. אין צורך בנושא מיוחד; אפשר להשאיר אותו ריק.
נושא עם טקסט חופשי יבצע גם חיפוש. כתובת RSS בנושא תבקש גם קטלוג. לחיצה על פתיחת מייל אינה מצרפת קובץ אוטומטית. הבקשה תטופל בריצות האוטומטיות ולא תשנה את המינוי לערוץ.
קובץ הבחירה כולל רק את הפרקים שסימנת, ויהיה גלוי למנהל כתובת הבקרה לאחר שליחתו.
חיפוש בכותרות ובתיאורים
התאמה לחיפוש
מהחדש לישן
מהישן לחדש
לפי כותרת
בחר תוצאות מוצגות
נקה בחירה
רק הפרקים שבחרתי
בחיפוש, התאמות בכותרת מופיעות ראשונות. הבחירה נשמרת כשמשנים חיפוש או מיון.
הורד את הבחירה
שתף את הבחירה
פתח מייל לשליחת הבקשה
צרף את „הקבצים שבחרתי.json” למייל אל {{escapeHtml(CTRL_GET_EPISODE)}} . פתיחת מייל אינה מצרפת את הקובץ.
```


- `placeholder`: שם פרק, נושא או מילה מהתיאור

- `aria-label`: מיון

### מונה הבחירה בקטלוג


**TXT-143** · `files/podcast_processor_v2.js:2130` · `counts`

```text
נבחרו {{selected.size}} פרקים{{selected.size?' · מוכנים לשליחה':' · סמן פרקים כדי להתחיל'}}
```


**TXT-144** · `files/podcast_processor_v2.js:2130` · `counts`

```text
· מוכנים לשליחה
```


**TXT-145** · `files/podcast_processor_v2.js:2130` · `counts`

```text
· סמן פרקים כדי להתחיל
```


### תוצאות חיפוש ובחירה בקטלוג


**TXT-146** · `files/podcast_processor_v2.js:2132` · `render`

```text
נמצאו {{visible.length}} פרקים מתוך {{data.episodes.length}}
```


**TXT-147** · `files/podcast_processor_v2.js:2134` · `render`

```text
אין פרקים נבחרים התואמים לחיפוש. אפשר לבטל את הסינון או לשנות את החיפוש.
```


**TXT-148** · `files/podcast_processor_v2.js:2134` · `render`

```text
לא נמצאו פרקים. נסה מילה אחרת או חיפוש קצר יותר.
```


**TXT-149** · `files/podcast_processor_v2.js:2136` · `render`

```text
בחר {{x.e.episodeTitle}}
```


**TXT-150** · `files/podcast_processor_v2.js:2137` · `render`

```text
אפשר לבחור עד 1000 פרקים בקובץ אחד.
```


**TXT-151** · `files/podcast_processor_v2.js:2139` · `render`

```text
ללא תאריך
```


**TXT-152** · `files/podcast_processor_v2.js:2141` · `render`

```text
הצג עוד {{Math.min(pageSize,visible.length-shown)}} פרקים
```


### שם קובץ הבחירה


**TXT-153** · `files/podcast_processor_v2.js:2144` · `file`

```text
הקבצים שבחרתי.json
```


### הקטלוג — חיפוש, בחירה, הורדה ושיתוף


**TXT-154** · `files/podcast_processor_v2.js:2147` · `podkiCatalogClient`

```text
אפשר לבחור עד 1000 פרקים בקובץ אחד.
```


**TXT-155** · `files/podcast_processor_v2.js:2148` · `podkiCatalogClient`

```text
הקובץ „הקבצים שבחרתי.json” הורד. צרף אותו למייל אל {{data.recipient}} ושלח; אפשר להשאיר את הנושא ריק.
```


**TXT-156** · `files/podcast_processor_v2.js:2150` · `podkiCatalogClient`

```text
הקבצים שבחרתי.json
```


**TXT-157** · `files/podcast_processor_v2.js:2151` · `podkiCatalogClient`

```text
בחר לפחות פרק אחד.
```


**TXT-158** · `files/podcast_processor_v2.js:2151` · `podkiCatalogClient`

```text
בחר ביישום המייל ושלח אל {{data.recipient}}. אפשר להשאיר את הנושא ריק.
```


**TXT-159** · `files/podcast_processor_v2.js:2151` · `podkiCatalogClient`

```text
השיתוף לא הושלם. אפשר להשתמש בהורדת JSON ולצרף אותו ידנית.
```


### קבועים ואתחול


**TXT-160** · `files/podcast_v2.gs:28` · `קבועים ואתחול`

```text
פודקאסטים 2.0
```


**TXT-161** · `files/podcast_v2.gs:29` · `קבועים ואתחול`

```text
קבצי מערכת
```


### setUp


**TXT-162** · `files/podcast_v2.gs:71` · `setUp`

```text
❌ פודקאסטים 2.0 — שגיאה קריטית
```


**TXT-163** · `files/podcast_v2.gs:72` · `setUp`

```text
שגיאה בריצה: {{e.message}}
{{e.stack}}
```


### דף התקנה — העתקת קוד


**TXT-164** · `index.htm:596` · `copyGsCode`

```text
טוען קוד…
```


**TXT-165** · `index.htm:605` · `copyGsCode`

```text
הקוד הועתק!
```


**TXT-166** · `index.htm:606` · `copyGsCode`

```text
הקוד הועתק. כעת מדביקים אותו בפרויקט Apps Script.
```


**TXT-167** · `index.htm:609` · `copyGsCode`

```text
העתקת קוד המערכת
```


**TXT-168** · `index.htm:613` · `copyGsCode`

```text
ההעתקה נכשלה — נסו שוב
```


**TXT-169** · `index.htm:614` · `copyGsCode`

```text
אפשר לפתוח את קוד ההפעלה בקישור שמתחת לכפתור ולהעתיק ידנית.
```


**TXT-170** · `index.htm:615` · `copyGsCode`

```text
העתקת קוד המערכת
```


### דף התקנה — שמות השלבים


**TXT-171** · `index.htm:647` · `goTo`

```text
נעים להכיר
```


**TXT-172** · `index.htm:647` · `goTo`

```text
פרטיות
```


**TXT-173** · `index.htm:647` · `goTo`

```text
התקנה
```


**TXT-174** · `index.htm:648` · `goTo`

```text
שלב {{i}} מתוך 3 · {{names[i-1]}}
```


## הודעות שגיאה ובדיקת בקשות


### scanFeed


**TXT-175** · `files/podcast_processor_v2.js:218` · `scanFeed`

```text
קוד תגובה {{response.getResponseCode()}}
```


**TXT-176** · `files/podcast_processor_v2.js:224` · `scanFeed`

```text
לא נמצא אלמנט
```


### parsePodcastsFiles


**TXT-177** · `files/podcast_processor_v2.js:389` · `parsePodcastsFiles`

```text
לא ניתן לקרוא קובץ מינויים: {{e.message}}
```


### מייל עדכון מינויים


**TXT-178** · `files/podcast_processor_v2.js:1248` · `sendSubscriptionEmail`

```text
RSS לא תקין
```


### podkiWriteStateFile


**TXT-179** · `files/podcast_processor_v2.js:1683` · `podkiWriteStateFile`

```text
תיקיית המערכת אינה זמינה לשמירת מצב.
```


### שם השולח ותצוגת טקסט חלופית


**TXT-180** · `files/podcast_processor_v2.js:1730` · `podkiSendEmail`

```text
מכסת שליחת המיילים להיום הסתיימה; אנסה שוב בריצה הבאה.
```


**TXT-181** · `files/podcast_processor_v2.js:1731` · `podkiSendEmail`

```text
גוף ההודעה גדול מדי לשליחה בטוחה.
```


### בדיקת קובץ הבחירה


**TXT-182** · `files/podcast_processor_v2.js:1747` · `podkiSelection`

```text
גרסת קובץ הבקשה אינה נתמכת. יש לייצא בחירה חדשה מהקטלוג.
```


**TXT-183** · `files/podcast_processor_v2.js:1749` · `podkiSelection`

```text
לא נמצאה בקובץ רשימת פרקים מוכרת. יש לצרף את קובץ ה-JSON שהקטלוג ייצר.
```


**TXT-184** · `files/podcast_processor_v2.js:1750` · `podkiSelection`

```text
קובץ הבחירה ריק. יש לסמן לפחות פרק אחד בקטלוג.
```


**TXT-185** · `files/podcast_processor_v2.js:1751` · `podkiSelection`

```text
אפשר לבקש עד {{PODKI_MAX_SELECTION}} פרקים בקובץ אחד. פצל את הבחירה.
```


### processGetEpisodeEmail


**TXT-186** · `files/podcast_processor_v2.js:1778` · `processGetEpisodeEmail`

```text
הקובץ גדול מ-2MiB. פצל את הבחירה.
```


**TXT-187** · `files/podcast_processor_v2.js:1780` · `processGetEpisodeEmail`

```text
הקובץ גדול מ-2MiB. פצל את הבחירה.
```


### קריאת פיד פרקים


**TXT-188** · `files/podcast_processor_v2.js:1813` · `podkiReadFeed`

```text
לא ניתן לקרוא את פיד הערוץ (HTTP {{resp.getResponseCode()}}).
```


**TXT-189** · `files/podcast_processor_v2.js:1815` · `podkiReadFeed`

```text
הכתובת אינה פיד RSS נתמך.
```


### מייל קיבלתי את הבחירה שלך


**TXT-190** · `files/podcast_processor_v2.js:1935` · `podkiSendRequestSummary`

```text
אישור הבקשה יימשך בריצה הבאה.
```


### חיפוש פרקים באפל


**TXT-191** · `files/podcast_processor_v2.js:1945` · `podkiSearchEpisodes`

```text
חיפוש הפרקים באפל לא זמין כרגע (HTTP {{resp.getResponseCode()}}).
```


### podkiPackBlocks


**TXT-192** · `files/podcast_processor_v2.js:2012` · `podkiPackBlocks`

```text
פריט בודד גדול מדי לדוח; יש לקצר את תיאורו.
```


### מייל הקטלוג המצורף


**TXT-193** · `files/podcast_processor_v2.js:2081` · `sendEpisodeCatalogEmail`

```text
תיקיית המערכת אינה זמינה לשמירת קטלוג גדול.
```


## נספח — הודעות לוג וכלי שורת הפקודה


### main


**TXT-194** · `files/podcast_processor_v2.js:52` · `main`

```text
⏸️ ריצה אחרת פעילה; ממשיכים בשעה הבאה.
```


### runPodcastMain


**TXT-195** · `files/podcast_processor_v2.js:61` · `runPodcastMain`

```text
🚀 פודקאסטים v2 — {{formatDate(startTime)}}
```


**TXT-196** · `files/podcast_processor_v2.js:73` · `runPodcastMain`

```text
📦 {{queue.length}} פריטים בתור.
```


**TXT-197** · `files/podcast_processor_v2.js:100` · `runPodcastMain`

```text
⚠️ רשימת ערוצים ריקה.
```


**TXT-198** · `files/podcast_processor_v2.js:107` · `runPodcastMain`

```text
📋 נטענו {{rssList.length}} כתובות RSS.
```


**TXT-199** · `files/podcast_processor_v2.js:110` · `runPodcastMain`

```text
⏰ מגבלת זמן בסריקה.
```


**TXT-200** · `files/podcast_processor_v2.js:115` · `runPodcastMain`

```text
❌ סריקה {{rssList[f].url}}: {{e.message}}
```


**TXT-201** · `files/podcast_processor_v2.js:118` · `runPodcastMain`

```text
📊 {{queue.length}} פרקים בתור.
```


**TXT-202** · `files/podcast_processor_v2.js:126` · `runPodcastMain`

```text
⏰ מגבלת זמן — עוצר הורדות.
```


**TXT-203** · `files/podcast_processor_v2.js:130` · `runPodcastMain`

```text
⏸️ פריט ישן ללא זיהוי ערוץ ודאי ממתין לסריקה: {{item.episodeTitle}}
```


**TXT-204** · `files/podcast_processor_v2.js:134` · `runPodcastMain`

```text
🔁 קיים: {{item.fileName}}
```


**TXT-205** · `files/podcast_processor_v2.js:138` · `runPodcastMain`

```text
💾 נפח נמוך — דוחה: {{item.episodeTitle}}
```


**TXT-206** · `files/podcast_processor_v2.js:141` · `runPodcastMain`

```text
(ממשיך)
```


**TXT-207** · `files/podcast_processor_v2.js:160` · `runPodcastMain`

```text
⏸️ הושהה: {{item.episodeTitle}}
```


**TXT-208** · `files/podcast_processor_v2.js:165` · `runPodcastMain`

```text
❌ ניסיון {{item.retryCount}}/{{MAX_RETRIES}}: {{result.error}}
```


**TXT-209** · `files/podcast_processor_v2.js:173` · `runPodcastMain`

```text
📥 הורדו בריצה זו: {{downloaded}}
```


**TXT-210** · `files/podcast_processor_v2.js:180` · `runPodcastMain`

```text
💾 {{queue.length}} פרקים בתור.
```


**TXT-211** · `files/podcast_processor_v2.js:192` · `runPodcastMain`

```text
⏰ אין מספיק זמן לשליחת מיילים — יטופלו בריצה הבאה.
```


**TXT-212** · `files/podcast_processor_v2.js:201` · `runPodcastMain`

```text
⏰ סיכום פרקים ידחה לריצה הבאה ({{_emailsData.pendingEpisodeSummary.length}} פרקים).
```


### scanFeed


**TXT-213** · `files/podcast_processor_v2.js:214` · `scanFeed`

```text
🔍 סורק: {{rssUrl}}
```


**TXT-214** · `files/podcast_processor_v2.js:233` · `scanFeed`

```text
🎙️ ערוץ: {{channelTitle}} (מ-{{days}} הימים האחרונים)
```


**TXT-215** · `files/podcast_processor_v2.js:326` · `scanFeed`

```text
📋 {{newOnes}} פרקים חדשים נוספו לתור מערוץ זה.
```


### loadStatusQueue


**TXT-216** · `files/podcast_processor_v2.js:342` · `loadStatusQueue`

```text
⚠️ קובץ תור פגום, מתעלם: {{e.message}}
```


### sendFailureEmail


**TXT-217** · `files/podcast_processor_v2.js:364` · `sendFailureEmail`

```text
⚠️ שליחת מייל כשלון נכשלה: {{e.message}}
```


### mergePodcastsFiles


**TXT-218** · `files/podcast_processor_v2.js:447` · `mergePodcastsFiles`

```text
🔀 נמצאו {{files.length}} קבצי {{RSS_FILE_NAME}} — ממזג...
```


**TXT-219** · `files/podcast_processor_v2.js:450` · `mergePodcastsFiles`

```text
✅ מיזוג הושלם: {{merged.order.length}} ערוצים ייחודיים בקובץ אחד.
```


### ensureRssFileExists


**TXT-220** · `files/podcast_processor_v2.js:472` · `ensureRssFileExists`

```text
⏳ קובץ {{RSS_FILE_NAME}} חסר בתיקייה 'קבצי מערכת'.
```


**TXT-221** · `files/podcast_processor_v2.js:474` · `ensureRssFileExists`

```text
📄 נוצר קובץ {{RSS_FILE_NAME}} ריק.
```


### מייל פתיחה והדרכה


**TXT-222** · `files/podcast_processor_v2.js:521` · `sendMissingRssFileEmail`

```text
⚠️ מייל ברוך הבא נכשל: {{e.message}}
```


### downloadAndSaveAudio


**TXT-223** · `files/podcast_processor_v2.js:547` · `downloadAndSaveAudio`

```text
⚠️ בדיקת גודל נכשלה, מנסה הורדה רגילה: {{e.message}}
```


**TXT-224** · `files/podcast_processor_v2.js:554` · `downloadAndSaveAudio`

```text
📦 קובץ גדול: {{Math.round(contentLength / 1024 / 1024)}}MB
```


**TXT-225** · `files/podcast_processor_v2.js:556` · `downloadAndSaveAudio`

```text
⚠️ השרת לא תומך ב-Range. מנסה הורדה רגילה בכל זאת...
```


### downloadChunked


**TXT-226** · `files/podcast_processor_v2.js:612` · `downloadChunked`

```text
📡 chunks: {{totalChunks}} | התחלה מ-{{Math.round(offset/1048576)}}MB
```


**TXT-227** · `files/podcast_processor_v2.js:617` · `downloadChunked`

```text
⏰ מגבלת זמן — משהה chunked download ב-{{Math.round(offset/1048576)}}MB.
```


### getOrCreateFolder


**TXT-228** · `files/podcast_processor_v2.js:674` · `getOrCreateFolder`

```text
📂 יוצר תיקייה חדשה: {{folderName}}
```


### savePodcastCoverArt


**TXT-229** · `files/podcast_processor_v2.js:809` · `savePodcastCoverArt`

```text
⚠️ לא נמצאה תמונת כריכה בפיד.
```


**TXT-230** · `files/podcast_processor_v2.js:816` · `savePodcastCoverArt`

```text
⚠️ שגיאת HTTP {{resp.getResponseCode()}} בהורדת תמונת כריכה.
```


**TXT-231** · `files/podcast_processor_v2.js:828` · `savePodcastCoverArt`

```text
🖼️ תמונת כריכה נשמרה: folder.{{ext}}
```


**TXT-232** · `files/podcast_processor_v2.js:830` · `savePodcastCoverArt`

```text
⚠️ שגיאה בשמירת תמונת כריכה: {{e.message}}
```


### getFreeStorageBytes


**TXT-233** · `files/podcast_processor_v2.js:1023` · `getFreeStorageBytes`

```text
⚠️ בדיקת נפח נכשלה: {{e.message}}
```


### מייל אחסון נמוך


**TXT-234** · `files/podcast_processor_v2.js:1231` · `sendStorageEmail`

```text
⚠️ מייל אחסון נכשל: {{e.message}}
```


### מייל עדכון מינויים


**TXT-235** · `files/podcast_processor_v2.js:1264` · `sendSubscriptionEmail`

```text
⚠️ מייל מינויים נכשל: {{e.message}}
```


### checkSentMailbox


**TXT-236** · `files/podcast_processor_v2.js:1320` · `checkSentMailbox`

```text
⚠️ עיבוד מייל בקרה נכשל: {{e.message}}
```


### removeFromPodcastsFile


**TXT-237** · `files/podcast_processor_v2.js:1346` · `removeFromPodcastsFile`

```text
🗑️ ערוץ הוסר מהרשימה: {{urlToRemove}}
```


### מייל תוצאות חיפוש ערוצים


**TXT-238** · `files/podcast_processor_v2.js:1451` · `sendPodcastSearchResultsEmail`

```text
⚠️ מייל חיפוש: {{e.message}}
```


### addSpecificEpisodeToQueueEx


**TXT-239** · `files/podcast_processor_v2.js:1526` · `addSpecificEpisodeToQueueEx`

```text
📌 פרק ספציפי נוסף: {{title}}
```


### sendProcessedEmailsSummary


**TXT-240** · `files/podcast_processor_v2.js:1558` · `sendProcessedEmailsSummary`

```text
⚠️ סיכום פרקים: {{e.message}}
```


### podkiPumpJobs


**TXT-241** · `files/podcast_processor_v2.js:1904` · `podkiPumpJobs`

```text
⚠️ פודקי — משימה ממתינה: {{e.message}}
```


### מייל סיכום שבועי


**TXT-242** · `files/podcast_processor_v2.js:2057` · `sendWeeklyEmail`

```text
⚠️ פודקי — משלוח הדוח יימשך בריצה הבאה: {{e.message}}
```


### setUp


**TXT-243** · `files/podcast_v2.gs:49` · `setUp`

```text
✅ טריגר שעתי נוצר.
```


**TXT-244** · `files/podcast_v2.gs:66` · `setUp`

```text
🕐 נותרו משימות — יטופלו בריצה הבאה.
```


**TXT-245** · `files/podcast_v2.gs:68` · `setUp`

```text
❌ שגיאה: {{e.message}}
```


### עדכון מאגר הפודקאסטים — כלי שורת פקודה


**TXT-246** · `update_podcasts.py:66` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
לא נמצאו מילות מפתח לחיפוש.
```


**TXT-247** · `update_podcasts.py:108` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
לא נמצאו פודקאסטים חדשים לעדכון.
```


**TXT-248** · `update_podcasts.py:14` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
שגיאה: הקובץ
```


**TXT-249** · `update_podcasts.py:14` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
לא נמצא.
```


**TXT-250** · `update_podcasts.py:75` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
] מחפש באפל עבור: '
```


**TXT-251** · `update_podcasts.py:105` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
סך הכל נוספו
```


**TXT-252** · `update_podcasts.py:105` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
פודקאסטים חדשים. שומר את הקובץ...
```


**TXT-253** · `update_podcasts.py:99` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
-> נמצא פודקאסט חדש:
```


**TXT-254** · `update_podcasts.py:25` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
קובץ ה-JSON ריק או לא תקין, יוצר רשימה חדשה.
```


**TXT-255** · `update_podcasts.py:58` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
שגיאה כללית בחיפוש עבור '
```


**TXT-256** · `update_podcasts.py:50` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
שגיאת 429 (בקשות רבות מדי) עבור המילה '
```


**TXT-257** · `update_podcasts.py:50` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
'. ניסיון
```


**TXT-258** · `update_podcasts.py:50` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
מתוך
```


**TXT-259** · `update_podcasts.py:51` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
ממתין
```


**TXT-260** · `update_podcasts.py:51` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
שניות לפני ניסיון נוסף...
```


**TXT-261** · `update_podcasts.py:55` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
שגיאת HTTP
```


**TXT-262** · `update_podcasts.py:55` · `עדכון מאגר הפודקאסטים — כלי שורת פקודה`

```text
עבור המילה '
```



## אופן החזרת הניסוחים

לכל שינוי אפשר לציין `TXT-מספר` או `WEB-מספר`, את הנוסח הרצוי ואת החריגים לפי הצורך. בטקסט המלא של דף ההתקנה אפשר להפנות לכותרת ולמשפט הקיים. יש לשמור על כתובות השליחה, משתנים דינמיים ושמות טכניים הנחוצים לתפעול (`JSON`, `HTML`, `RSS`, `--notify-only`).
