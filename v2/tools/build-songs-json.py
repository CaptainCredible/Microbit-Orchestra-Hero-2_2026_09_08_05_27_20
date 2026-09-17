#!/usr/bin/env python3
"""Write songs/songs.json from what is actually in the songs folders.

    python3 tools/build-songs-json.py           # write it
    python3 tools/build-songs-json.py --check    # say what would change, write nothing
    python3 tools/build-songs-json.py --all      # also add folders not yet listed

WHICH SONGS APPEAR is the manifest's business, not this script's. By default it
rewrites the entries already listed and leaves the membership exactly as it
found it - a folder sitting in songs/ that nobody listed stays unlisted, and is
only mentioned so you know it is there. Adding cards to a menu behind somebody's
back is not a thing a housekeeping script should do. --all opts into it.

WHY THIS EXISTS

A browser cannot list a directory over http, so the game has to guess what is
in a song folder: for every part it does not find, it tries each spelling in
turn - Pads.mid, Pads.midi, Pads.MID, pads.mid - and every guess that is wrong
is a request that goes out and comes back 404.

Off a local disk that costs nothing. Off a web server it is a round trip
apiece, and on a host that redirects its 404s it is worse than that, because
the redirect goes to another hostname and the browser has to open a fresh
connection for it. Measured against a real deployment: a file that exists comes
back in 30ms, one that does not takes 100-450ms.

This writes the answers down. With a manifest listing what each folder really
holds, the game asks for exactly the files that are there and not one more.

WHAT IT WRITES

The old format - a plain array of folder names - still works, and a folder
named that way is still probed as before. This writes the richer form:

    { "songs": [ { "id": "The-OG",
                   "setup": "song.setup",
                   "parts": { "drums": "Drums.mid", "pads": "Pads.mid" },
                   "sounds": "sound-settings.txt" } ] }

A part that is not listed is a part the song does not have, and the game does
not go looking for it. `null` for setup or sounds means the same.

RUN IT WHENEVER THE FOLDERS CHANGE. A manifest that disagrees with the disk is
worse than none: a part listed but missing is one wasted request, and a part
present but unlisted is silently dropped from the song. --check is there to be
run before a deploy.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
SONGS_DIR = os.path.join(APP, "songs")
MANIFEST = os.path.join(SONGS_DIR, "songs.json")
CONFIG = os.path.join(APP, "config.js")

# Fallbacks, used only if config.js cannot be read. They are the values that
# were in it when this was written; the parser below is what keeps the two in
# step, and it says so out loud when it has to fall back.
DEFAULT_PARTS = [("drums", "Drums.mid"), ("pads", "Pads.mid"),
                 ("bass", "Bass.mid"), ("keys", "Keys.mid")]
DEFAULT_SETUP_FILES = ["song.setup", "song-setup.txt", "songSetup.txt",
                       "song_setup.txt", "setup.txt"]
DEFAULT_SOUND_FILES = ["sound-settings.txt", "sound_settings.txt", "sounds.txt"]


def read_config():
    """Pull the three lists the game uses out of config.js.

    Read rather than copied, because a copy goes stale silently: rename a part
    in config.js and a duplicated list here would keep writing the old name
    into the manifest, and the song would lose an instrument with nothing said.
    """
    try:
        text = open(CONFIG, encoding="utf-8").read()
    except OSError:
        print("! could not read config.js - using built-in defaults")
        return DEFAULT_PARTS, DEFAULT_SETUP_FILES, DEFAULT_SOUND_FILES

    def string_list(name, fallback):
        m = re.search(r"const\s+%s\s*=\s*\[(.*?)\]" % name, text, re.S)
        if not m:
            print("! could not find %s in config.js - using the built-in list" % name)
            return fallback
        return re.findall(r'"([^"]+)"', m.group(1))

    parts = DEFAULT_PARTS
    m = re.search(r"const\s+SONG_PARTS\s*=\s*\[(.*?)\n\];", text, re.S)
    if m:
        found = re.findall(r'file:\s*"([^"]+)"\s*,\s*voice:\s*"([^"]+)"', m.group(1))
        if found:
            parts = [(voice, filename) for filename, voice in found]
        else:
            print("! could not read SONG_PARTS from config.js - using the built-in list")
    else:
        print("! could not find SONG_PARTS in config.js - using the built-in list")

    return (parts,
            string_list("SONG_SETUP_FILES", DEFAULT_SETUP_FILES),
            string_list("SOUND_SETTINGS_FILES", DEFAULT_SOUND_FILES))


def pick(entries, wanted):
    """The real filename for `wanted`, matched the way the game matches it.

    Case-insensitively, and the exact spelling on disk is what gets written -
    that is the point. A web server is case-sensitive even when the machine
    this runs on is not.
    """
    for name in wanted:
        for entry in entries:
            if entry.lower() == name.lower():
                return entry
    return None


def part_names(filename):
    """The spellings the game would try for one part, most likely first."""
    stem = re.sub(r"\.mid$", "", filename, flags=re.I)
    names = []
    for s in (stem, stem.lower()):
        for ext in (".mid", ".midi", ".MID"):
            if s + ext not in names:
                names.append(s + ext)
    return names


def scan(folder, parts_spec, setup_files, sound_files):
    """What one song folder actually holds."""
    path = os.path.join(SONGS_DIR, folder)
    entries = [e for e in os.listdir(path) if os.path.isfile(os.path.join(path, e))]

    parts = {}
    for voice, filename in parts_spec:
        hit = pick(entries, part_names(filename))
        if hit:
            parts[voice] = hit

    return {
        "id": folder,
        "setup": pick(entries, setup_files),
        "parts": parts,
        "sounds": pick(entries, sound_files),
    }


def existing_order():
    """The order songs.json already lists, so the menu does not get reshuffled.

    Works with either format, since the old one is a plain array of names.
    """
    try:
        data = json.load(open(MANIFEST, encoding="utf-8"))
    except (OSError, ValueError):
        return []
    songs = data if isinstance(data, list) else data.get("songs", [])
    order = []
    for entry in songs:
        if isinstance(entry, str):
            order.append(entry)
        elif isinstance(entry, dict) and isinstance(entry.get("id"), str):
            order.append(entry["id"])
    return order


def requests_for(song, parts_spec, setup_files, sound_files):
    """Requests the game makes for this song, probing versus declared.

    The probing figure is what it costs today: every part the folder does not
    have burns the whole spelling list before giving up.
    """
    probed = 0
    probed += setup_files.index(song["setup"]) + 1 if song["setup"] in setup_files \
        else len(setup_files)
    for voice, filename in parts_spec:
        names = part_names(filename)
        hit = song["parts"].get(voice)
        probed += names.index(hit) + 1 if hit in names else len(names)
    probed += sound_files.index(song["sounds"]) + 1 if song["sounds"] in sound_files \
        else len(sound_files)

    declared = bool(song["setup"]) + len(song["parts"]) + bool(song["sounds"])
    return probed, declared


def main():
    check_only = "--check" in sys.argv
    add_new = "--all" in sys.argv

    if not os.path.isdir(SONGS_DIR):
        print("! no songs folder at %s" % SONGS_DIR)
        return 1

    parts_spec, setup_files, sound_files = read_config()

    folders = sorted(f for f in os.listdir(SONGS_DIR)
                     if os.path.isdir(os.path.join(SONGS_DIR, f))
                     and not f.startswith("."))

    # Folders already in the manifest keep their places. The order here is the
    # order of the cards on the menu, and so is the membership: both are
    # decisions somebody made, not something to re-sort or top up behind their
    # back. --all is how you ask for the new ones.
    known = existing_order()
    listed = [f for f in known if f in folders]
    unlisted = [f for f in folders if f not in known]
    missing = [f for f in known if f not in folders]

    ordered = listed + (unlisted if add_new else [])

    songs, skipped = [], []
    total_probed = total_declared = 0

    print("%-16s %-22s %-16s %s" % ("folder", "parts", "setup", "sounds"))
    print("-" * 72)

    for folder in ordered:
        song = scan(folder, parts_spec, setup_files, sound_files)
        if not song["parts"]:
            # No parts at all is not a song. Left out of the manifest and said
            # out loud, rather than written in as a card that plays silence.
            skipped.append(folder)
            print("%-16s %s" % (folder, "- no .mid files, left out"))
            continue

        probed, declared = requests_for(song, parts_spec, setup_files, sound_files)
        total_probed += probed
        total_declared += declared

        songs.append(song)
        print("%-16s %-22s %-16s %s" % (
            folder,
            "+".join(song["parts"].keys()),
            song["setup"] or "-",
            song["sounds"] or "-"))

    print()
    print("%d song(s); requests at startup: %d probing -> %d declared (%d fewer)"
          % (len(songs), total_probed, total_declared, total_probed - total_declared))
    if skipped:
        print("skipped, no .mid files: %s" % ", ".join(skipped))
    if missing:
        print("listed but not on disk, dropped: %s" % ", ".join(missing))
    if unlisted and not add_new:
        print("on disk but not listed: %s" % ", ".join(unlisted))
        print("  (left alone - run with --all to add them to the menu)")

    payload = json.dumps({"songs": songs}, indent=2) + "\n"

    try:
        current = open(MANIFEST, encoding="utf-8").read()
    except OSError:
        current = None

    if current == payload:
        print("\nsongs.json is already up to date")
        return 0

    if check_only:
        print("\n--check: songs.json is OUT OF DATE; run without --check to write it")
        return 1

    open(MANIFEST, "w", encoding="utf-8").write(payload)
    print("\nwrote %s" % os.path.relpath(MANIFEST, APP))
    return 0


if __name__ == "__main__":
    sys.exit(main())
