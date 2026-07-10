import os
import json
import urllib.request
import urllib.parse
import urllib.error
import time

# נתיבים לקבצים בתיקיית files
KEYWORDS_FILE = os.path.join("files", "keywords.txt")
DATABASE_FILE = os.path.join("files", "israeli_podcasts_database.json")

def load_keywords():
    if not os.path.exists(KEYWORDS_FILE):
        print(f"שגיאה: הקובץ {KEYWORDS_FILE} לא נמצא.")
        return []
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
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
    encoded_keyword = urllib.parse.quote(keyword)
    url = f"https://itunes.apple.com/search?term={encoded_keyword}&media=podcast&country=il"
    
    # הגדרת משתנים לניסיונות חוזרים
    retries = 3
    backoff_time = 5  # שניות המתנה ראשוניות במקרה של שגיאה
    
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                return res_data.get("results", [])
                
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"שגיאת 429 (בקשות רבות מדי) עבור המילה '{keyword}'. ניסיון {attempt + 1} מתוך {retries}...")
                print(f"ממתין {backoff_time} שניות לפני ניסיון נוסף...")
                time.sleep(backoff_time)
                backoff_time *= 2  # הכפלת זמן ההמתנה בניסיון הבא
            else:
                print(f"שגיאת HTTP {e.code} עבור המילה '{keyword}': {e.reason}")
                break
        except Exception as e:
            print(f"שגיאה כללית בחיפוש עבור '{keyword}': {e}")
            break
            
    return []

def main():
    keywords = load_keywords()
    if not keywords:
        print("לא נמצאו מילות מפתח לחיפוש.")
        return

    current_db = load_database()
    existing_ids = {int(podcast["id"]) for podcast in current_db if "id" in podcast}
    
    new_podcasts_count = 0

    for i, keyword in enumerate(keywords):
        print(f"[{i+1}/{len(keywords)}] מחפש באפל עבור: '{keyword}'...")
        results = search_apple_podcasts(keyword)
        
        for track in results:
            podcast_id = track.get("collectionId")
            if not podcast_id or podcast_id in existing_ids:
                continue
            
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
            print(f" -> נמצא פודקאסט חדש: {new_podcast['title']}")

        # השהיה קבועה של 1.5 שניות בין בקשה לבקשה כדי למנוע חסימה מראש
        time.sleep(1.5)

    if new_podcasts_count > 0:
        print(f"\nסך הכל נוספו {new_podcasts_count} פודקאסטים חדשים. שומר את הקובץ...")
        save_database(current_db)
    else:
        print("\nלא נמצאו פודקאסטים חדשים לעדכון.")

if __name__ == "__main__":
    main()
