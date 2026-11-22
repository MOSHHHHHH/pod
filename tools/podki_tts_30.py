#!/usr/bin/env python3
"""30 one-word Podki Gemini 3.8 TTS experiments, executed in six serial batches.
Writes each successful WAV, a manifest, and a ZIP. Stops at quota exhaustion.
Does NOT modify the Podki application. Do not log the API key.
"""
import io, json, os, re, time, wave, zipfile, subprocess
from pathlib import Path
from google import genai
from google.genai import types

MODEL="gemini-3.8-flash-tts"
WORD="פּוֹדְקִי"
STYLES=[
  [
    "Warm sonic logo",
    "Kore",
    "Warm young Hebrew brand voice; sing the two syllables in a gentle ascending major-third interval, 1.5 seconds. Clear human tone, no extra words."
  ],
  [
    "Friendly smile",
    "Puck",
    "An audible bright smile, speak-sing two short notes, light upward lift on the second syllable, close cleanly."
  ],
  [
    "Deep confident",
    "Charon",
    "Deep resonant male radio-ident timbre. Two measured musical pitches, firm and premium, no announcer lead-in."
  ],
  [
    "Playful cartoon",
    "Aoede",
    "Playful animated character voice, high buoyant rising two-note sing-song, playful crisp cut."
  ],
  [
    "Elegant feminine",
    "Leda",
    "Elegant delicate female studio jingle, graceful legato rise then soft release, intimate dry vocal."
  ],
  [
    "Opera soprano",
    "Kore",
    "Extreme operatic soprano coloratura: two syllables on distinct high notes with vibrato, absolutely no added words."
  ],
  [
    "Opera basso",
    "Charon",
    "Extreme dramatic basso profundo, two pitched low notes, grand resonant operatic phonation."
  ],
  [
    "Beatbox-like",
    "Puck",
    "Speak the name with percussive rhythmic articulation like a miniature beatbox hook; vocal sound only, no extra syllables."
  ],
  [
    "Whisper melody",
    "Zephyr",
    "Almost-whispered breathy voice that still traces two musical pitches, intimate sonic signature."
  ],
  [
    "Robot vocoder",
    "Orus",
    "Hyper-clean robotic synthetic vocoder timbre, two precisely quantized notes, futuristic yet understandable Hebrew."
  ],
  [
    "Children cartoon",
    "Leda",
    "Cartoonishly tiny squeaky mascot voice with a wildly ascending pitch bend across the two syllables."
  ],
  [
    "Retro radio",
    "Charon",
    "1950s radio-jingle crooner, warm vinyl-like vocal coloration, two swung notes and tight ending, no speech before or after."
  ],
  [
    "Pop hook",
    "Aoede",
    "Catchy modern pop-vocal two-note hook, upbeat, energetic, perfect intonation, no instruments, only the name."
  ],
  [
    "Jazz scat mimic",
    "Puck",
    "Jazz scat-style swung articulation but MUST sing exactly the Hebrew name, no scat filler or added phonemes."
  ],
  [
    "R&B run",
    "Kore",
    "Soulful expressive R&B singer; first syllable grounded, second syllable glides with a short tasteful melisma."
  ],
  [
    "Epic trailer",
    "Orus",
    "Epic cinematic trailer voice with two dramatic down-up pitches, massive vocal projection and brief reverb tail."
  ],
  [
    "Glitch pop",
    "Zephyr",
    "Experimental glitch-pop chopped vocal cadence, two syllables in a syncopated stutter-like effect without repetition or extra sounds."
  ],
  [
    "ASMR close",
    "Leda",
    "Extreme close-mic ASMR half-sung whisper, subtle pitch up on the second syllable, minimal breath."
  ],
  [
    "Metal growl",
    "Charon",
    "Extreme gritty heavy-metal growl sung in two discernible musical pitches, still unmistakably pronouncing the exact Hebrew name."
  ],
  [
    "Yodel",
    "Puck",
    "One brief Swiss yodel-style register break exactly at the syllable boundary, no extra notes or additional vocalizations."
  ],
  [
    "Baroque ornament",
    "Kore",
    "Baroque classical soprano ornament, small upper mordent on the second syllable, two syllables only."
  ],
  [
    "Gregorian chant",
    "Orus",
    "Solo Gregorian-chant-like modal intonation, solemn resonant church acoustics but absolutely one voice and one name."
  ],
  [
    "Chiptune vocal",
    "Zephyr",
    "8-bit game character voice impression, pixelated tone with two square-wave-like vocal pitches; readable Hebrew."
  ],
  [
    "Space alien",
    "Aoede",
    "Extreme alien cartoon voice, formant-shifted impression, a two-tone otherworldly sonic logo; intelligible word."
  ],
  [
    "Emergency siren",
    "Charon",
    "Musical siren-shaped pitch portamento sung with a human voice, one smooth rise between the syllables, no actual alarm sound."
  ],
  [
    "SSML experiment",
    "Kore",
    "Experimental formatting request: <speak><prosody pitch='+5st' rate='fast'>two sung syllables</prosody></speak>. This is performance guidance only; speak solely supplied Hebrew transcript."
  ],
  [
    "Score notation",
    "Aoede",
    "Treat the two syllables as quarter notes C5 then G5 in 4/4 at 112 BPM; articulate as a polished tiny human vocal ident."
  ],
  [
    "IPA style",
    "Puck",
    "Use this guide only for performance: [ˈpod.ki] as two pitched segments, major-sixth leap; preserve the exact supplied Hebrew spoken text."
  ],
  [
    "Inverted song",
    "Leda",
    "Avant-garde inverse sonic logo: start with a high sung note, fall a full octave on second syllable, stark and experimental."
  ],
  [
    "Extreme falsetto",
    "Zephyr",
    "Extreme airy falsetto musical emblem, huge upward glissando on the last vowel, brief shimmering release; no extra utterance."
  ]
]
ROOT=Path("podki-tts-30")
ROOT.mkdir(exist_ok=True)
# Resume from committed results; a quota failure may be retried on a later run.
MANIFEST_PATH=ROOT/"manifest.json"
MANIFEST=json.loads(MANIFEST_PATH.read_text(encoding="utf-8")).get("items",[]) if MANIFEST_PATH.exists() else []
def save():
    (ROOT/"manifest.json").write_text(json.dumps({"model":MODEL,"spoken_text":WORD,"items":MANIFEST},ensure_ascii=False,indent=2),encoding="utf-8")
    with zipfile.ZipFile(ROOT/"podki-tts-results.zip","w",zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ROOT.iterdir()):
            if p.is_file() and p.name!="podki-tts-results.zip":z.write(p,p.name)
def err_type(exc):
    code=getattr(exc,"code",None) or getattr(exc,"status_code",None)
    message=str(exc).lower()
    if str(code)=="429" or "resource_exhausted" in message or "quota" in message or "rate limit" in message:return "quota"
    if str(code) in ("401","403") or "permission_denied" in message:return "permission"
    return "other"
def main():
    if not os.getenv("GEMINI_API_KEY"):raise SystemExit("Missing secret GEMINI_API_KEY")
    client=genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    for n,(title,voice,style) in enumerate(STYLES,1):
        previous=next((x for x in MANIFEST if x.get("n")==n),None)
        if previous and previous.get("status")=="ok" and (ROOT/previous.get("file","")).is_file():
            print(f"SKIP {n}: previous WAV already saved",flush=True)
            continue
        # Failed attempts are not successes and must be replaced rather than duplicated.
        MANIFEST[:]=[x for x in MANIFEST if x.get("n")!=n]
        batch=(n-1)//5+1
        print(f"BATCH {batch}/6; example {n}/30: {title}; voice={voice}",flush=True)
        item={"n":n,"batch":batch,"title":title,"voice":voice,"style":style,"transcript":WORD}
        try:
            # Transcript is a separate, exact field. All extreme directions are metadata,
            # never the actual words to be synthesized.
            content=types.Content(role="user",parts=[
                types.Part(text=WORD,speech_metadata=types.SpeechMetadata(
                  style="Pronounce only the one Hebrew word supplied, no other words or syllables. "+style
                ))
            ])
            response=client.models.generate_content(
                model=MODEL,contents=content,
                config=types.GenerateContentConfig(
                  response_modalities=["AUDIO"],
                  speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(voice=voice)),
                )
            )
            raw=next((p.inline_data.data for p in (response.parts or []) if p.inline_data and p.inline_data.data),None)
            if not raw:raise RuntimeError("EMPTY_AUDIO")
            data=bytes(raw)
            if not data.startswith(b"RIFF"):
                with io.BytesIO() as b:
                    with wave.open(b,"wb") as wav:
                        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(data)
                    data=b.getvalue()
            name=f"{n:02d}-{re.sub('[^a-z0-9]+','-',title.lower()).strip('-')}.wav"
            path=ROOT/name;path.write_bytes(data)
            with wave.open(str(path),"rb") as wav:
                duration=wav.getnframes()/wav.getframerate()
            item.update(status="ok",file=name,seconds=round(duration,2),bytes=len(data))
            print(f"OK {name}, {duration:.2f}s",flush=True)
        except Exception as e:
            reason=err_type(e)
            item.update(status="failed",error_type=reason,error_class=type(e).__name__)
            print(f"FAILED {n}: {reason} ({type(e).__name__}), no credential info",flush=True)
            MANIFEST.append(item);save()
            if reason in ("quota","permission"):
                print("STOPPING: quota or access issue; will not switch to paid model.",flush=True)
                break
            continue
        MANIFEST.append(item)
        if n%5==0:
            print(f"Completed batch {batch}/6; saving artifact ZIP",flush=True)
            save()
        # Resume attempt 4: preserve completed assets and respect API quota. # Gentle pacing between successful requests, particularly after a previous quota failure.
        time.sleep(3)
    MANIFEST.sort(key=lambda x:x["n"])
    save()
    client.close()
if __name__=="__main__":main()
