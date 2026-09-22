#!/usr/bin/env python3
"""
Puts exactly what the website needs into site/, ready to upload.

    python3 tools/build-site.py

Two sites, each in a folder of its own under site/:

    site/game/        the game, from v2/     -> REMOTE_DIR in publish.conf
    site/highscore/   the standalone list    -> HIGHSCORE_DIR in publish.conf

Only what is listed in GAME below goes into the game, so anything new in v2/
stays on this computer until it is added here. That keeps the README, the
Firestore rules, audioOLD.js, the one-off import tool and the songs script off
the web. The highscore page is the whole of highscore/ - it is built to be
copied as it stands.

Before anything is copied it checks the two things that have broken a deploy
of this game before and gone unnoticed until someone opened the page:

  - songs/songs.json has to match the song folders. A stale one asks for files
    that are not there, or quietly drops a part from a song.
    (v2/tools/build-songs-json.py --check)
  - every local file index.html loads has to be in the site. A script missing
    from the list below would upload a page that dies on load.

Files keep their modification times and unchanged files are not copied again,
so tools/publish.sh only uploads what really changed. Files that are no longer
part of a site are removed from site/.
"""

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")

# What the game needs, relative to v2/. A folder means everything in it.
GAME = [
    "index.html",
    "style.css",
    # The scripts, in the order index.html loads them.
    "config.js", "perf.js", "dap.umd.js", "ubitwebusb.js", "midi-io.js",
    "songs.js", "audio.js", "game.js", "editor.js", "scene3d.js",
    "shaderbg.js", "soundpanel.js", "timing.js", "highscores.js",
    "scoreboard.js", "leaderboard.js", "sketch.js",
    # What they load.
    "fonts",
    "songs",
    "shaders",
    "videos",
    "mBorchLOGO.svg",
    "CalibrateBackdrop.jpeg",
    "conductor gamemaster.hex",
    # Linked from the game's highscores page: asking to be an operator, and the
    # admin's tool. Both are safe in public - the database rules decide what
    # anyone can do, not whether they can open the page.
    "tools/request-operator.html",
    "tools/manage-highscores.html",
    "tools/tools.css",
    # The shader bench. Linked from nowhere, so nobody finds it by accident;
    # take it out here to keep it off the site entirely.
    "shaderonly.html",
]

SITES = [
    ("game", os.path.join(ROOT, "v2"), GAME),
    ("highscore", os.path.join(ROOT, "highscore"), None),   # None: the whole folder
]

SKIP_NAMES = {".DS_Store", "Thumbs.db"}


def wanted(src_root, include):
    """Relative path -> source path, for every file that belongs on a site."""
    files = {}
    for item in (include if include is not None else ["."]):
        src = os.path.normpath(os.path.join(src_root, item))
        if os.path.isfile(src):
            files[os.path.relpath(src, src_root)] = src
            continue
        if not os.path.isdir(src):
            sys.exit(f"build-site: {os.path.relpath(src, ROOT)} is missing")
        for folder, dirs, names in os.walk(src):
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            for name in sorted(names):
                if name in SKIP_NAMES or name.startswith("."):
                    continue
                path = os.path.join(folder, name)
                files[os.path.relpath(path, src_root)] = path
    return files


def check_songs():
    """Stops the build if songs.json disagrees with the song folders."""
    script = os.path.join(ROOT, "v2", "tools", "build-songs-json.py")
    result = subprocess.run([sys.executable, script, "--check"],
                            capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, end="")
        sys.exit("build-site: songs/songs.json is out of date.\n"
                 "  Run: python3 v2/tools/build-songs-json.py   then publish again.")


def check_page(name, src_root, files):
    """Every local src= and href= in index.html has to be part of the site."""
    page = os.path.join(src_root, "index.html")
    if not os.path.exists(page):
        return
    html = open(page, encoding="utf-8").read()
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)       # commented-out tags load nothing
    missing = []
    for ref in re.findall(r'''(?:src|href)\s*=\s*["']([^"'#?]+)''', html):
        if re.match(r"^[a-z]+:|^//", ref, re.I):              # http:, https:, data:, mailto:
            continue
        rel = os.path.normpath(ref.replace("%20", " "))
        if rel not in files:
            missing.append(ref)
    if missing:
        sys.exit(f"build-site: {name}/index.html loads files that are not in the site:\n  "
                 + "\n  ".join(missing) + "\n  Add them to the list in tools/build-site.py.")


def build(name, src_root, include):
    out = os.path.join(SITE, name)
    files = wanted(src_root, include)
    check_page(name, src_root, files)
    copied = removed = 0

    for rel, src in files.items():
        dst = os.path.join(out, rel)
        s = os.stat(src)
        if os.path.exists(dst):
            d = os.stat(dst)
            if d.st_size == s.st_size and int(d.st_mtime) == int(s.st_mtime):
                continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    keep = {os.path.normpath(os.path.join(out, rel)) for rel in files}
    for folder, dirs, names in os.walk(out, topdown=False):
        for n in names:
            path = os.path.join(folder, n)
            if path not in keep:
                os.remove(path)
                removed += 1
        if folder != out and not os.listdir(folder):
            os.rmdir(folder)

    size = sum(os.path.getsize(p) for p in files.values())
    print(f"site/{name}/: {len(files)} files, {size / 1e6:.1f} MB "
          f"({copied} copied, {removed} removed)")


def main():
    check_songs()
    only = sys.argv[1:]
    for name, src_root, include in SITES:
        if not only or name in only:
            build(name, src_root, include)


if __name__ == "__main__":
    main()
