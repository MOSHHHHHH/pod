import os
import json
import urllib.request
import urllib.parse

# נתיבים לקבצים בתיקיית files
KEYWORDS_FILE = os.path.join("files", "keywords.txt")
DATABASE_FILE = os.path.join("files", "israeli_podcasts_database.json")

def load_keywords():
    if not os.path.exists(KEYWORDS_FILE):
        print(f"שגיאה: הקובץ {KEYWORDS_FILE} לא נמצא.")
        return []
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        # קריאת השורות, ניקוי רווחים וסינון שורות ריקות
        return [line.strip() for line in f if line.strip()]

def load_database():
    if os.path.exists(DATABASE_FILE):
        with open(DATABASE_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                print("קובץ ה-JSON ריק או לא תקין, יוצר רשימה חדשה.")
                return []
    return []

def save_database(data):
    with open(DATABASE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def search_apple_podcasts(keyword):
    print(f"מחפש באפל עבור מילת המפתח: '{keyword}'...")
    # קידוד מילת המפתח ל-URL ותוספת פרמטרים (מדיה: פודקאסט, מדינה: ישראל)
    encoded_keyword = urllib.parse.quote(keyword)
    url = f"https://itunes.apple.com/search?term={encoded_keyword}&media=podcast&country=il"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            return res_data.get("results", [])
    except Exception as e:
        print(f"שגיאה בחיפוש עבור '{keyword}': {e}")
        return []

def main():
    keywords = load_keywords()
    if not keywords:
        print("לא נמצאו מילות מפתח לחיפוש.")
        return

    current_db = load_database()
    # יצירת סט של מזהים קיימים כדי לבדוק כפילויות במהירות
    existing_ids = {int(podcast["id"]) for podcast in current_db if "id" in podcast}
    
    new_podcasts_count = 0

    for keyword in keywords:
        results = search_apple_podcasts(keyword)
        for track in results:
            podcast_id = track.get("collectionId")
            
            # אם הפודקאסט כבר קיים במאגר, נדלג עליו
            if not podcast_id or podcast_id in existing_ids:
                continue
            
            # בניית האובייקט לפי המבנה של המאגר הקיים שלך
            new_podcast = {
                "id": podcast_id,
                "title": track.get("collectionName"),
                "author": track.get("artistName"),
                "rss_url": track.get("feedUrl"),
                "apple_url": track.get("collectionViewUrl"),
                "image_url": track.get("artworkUrl600"),
                "primary_genre": track.get("primaryGenreName"),
                "track_count": track.get("trackCount"),
                "content_advisory": track.get("contentAdvisoryRating"),
                "country": track.get("country", "ISR")
            }
            
            current_db.append(new_podcast)
            existing_ids.add(podcast_id)
            new_podcasts_count += 1
            print(f"נמצא פודקאסט חדש: {new_podcast['title']} (ID: {podcast_id})")

    if new_podcasts_count > 0:
        print(f"סך הכל נוספו {new_podcasts_count} פודקאסטים חדשים. שומר את הקובץ...")
        save_database(current_db)
    else:
        print("לא נמצאו פודקאסטים חדשים לעדכון.")

if __name__ == "__main__":
    main()
