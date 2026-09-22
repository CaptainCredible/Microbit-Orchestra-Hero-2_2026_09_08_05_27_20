#!/bin/bash
# Builds site/ and uploads what changed to the web host over SFTP.
#
#   tools/publish.sh                  the game, and the highscore page if it has
#                                     a folder set in publish.conf
#   tools/publish.sh game             only the game
#   tools/publish.sh highscore        only the highscore page
#   tools/publish.sh --delete [...]   also remove files from the server that are
#                                     no longer part of the site (shows them
#                                     first and asks before deleting anything)
#
# Connection details live in tools/publish.conf (see publish.conf.example).
# Needs lftp: brew install lftp

set -euo pipefail
cd "$(dirname "$0")/.."

CONF=tools/publish.conf
if [ ! -f "$CONF" ]; then
  echo "Missing $CONF. Copy tools/publish.conf.example to $CONF and fill it in." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONF"
: "${SFTP_HOST:?set SFTP_HOST in $CONF}"
: "${SFTP_USER:?set SFTP_USER in $CONF}"
: "${REMOTE_DIR:?set REMOTE_DIR in $CONF}"
HIGHSCORE_DIR="${HIGHSCORE_DIR:-}"

DELETE=no
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --delete) DELETE=yes ;;
    game|highscore) TARGETS+=("$arg") ;;
    *) echo "Unknown argument '$arg'. Use: game, highscore, --delete" >&2; exit 1 ;;
  esac
done
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(game)
  if [ -n "$HIGHSCORE_DIR" ]; then TARGETS+=(highscore); fi
fi
# Asked for by name but with nowhere to go: said now, before building anything
# or asking for a password.
for target in "${TARGETS[@]}"; do
  if [ "$target" = highscore ] && [ -z "$HIGHSCORE_DIR" ]; then
    echo "Set HIGHSCORE_DIR in $CONF to publish the highscore page." >&2
    exit 1
  fi
done

remote_for() {
  case "$1" in
    game) echo "$REMOTE_DIR" ;;
    highscore) echo "$HIGHSCORE_DIR" ;;
  esac
}

# Each site gets a folder of its own. Uploading into the web root itself could
# mix it up with everything else on the domain, and --delete would wipe that.
for dir in "$REMOTE_DIR" ${HIGHSCORE_DIR:+"$HIGHSCORE_DIR"}; do
  case "${dir%/}" in
    ""|"/"|"/www"|"www"|"/public_html"|"public_html")
      echo "Each folder in $CONF must be a folder of its own, e.g. /www/MBOH2BETA — not '$dir'." >&2
      exit 1 ;;
  esac
done
# And not each other's, or inside each other's: a --delete of one would take
# the other with it, since it is not part of the site being mirrored.
if [ -n "$HIGHSCORE_DIR" ]; then
  g="${REMOTE_DIR%/}/"; h="${HIGHSCORE_DIR%/}/"
  case "$g" in "$h"*) bad=yes ;; *) case "$h" in "$g"*) bad=yes ;; *) bad=no ;; esac ;; esac
  if [ "$bad" = yes ]; then
    echo "REMOTE_DIR and HIGHSCORE_DIR must be separate folders, neither inside the other." >&2
    exit 1
  fi
fi

command -v lftp >/dev/null || { echo "lftp is missing: brew install lftp" >&2; exit 1; }

python3 tools/build-site.py "${TARGETS[@]}"

# Password: asked for each time unless an SSH key is set up (SFTP_KEY=yes).
# The password goes to lftp through the environment, so any character works.
if [ "${SFTP_KEY:-no}" = yes ]; then export LFTP_PASSWORD=""; else
  read -r -s -p "Password for $SFTP_USER@$SFTP_HOST: " LFTP_PASSWORD; echo
  export LFTP_PASSWORD
fi

run_lftp() {
  lftp --env-password -u "$SFTP_USER" "sftp://$SFTP_HOST" -e "
    set sftp:auto-confirm yes
    set net:max-retries 3
    set net:timeout 20
    mkdir -p -f '$1'
    $2
    bye"
}

for target in "${TARGETS[@]}"; do
  dir="$(remote_for "$target")"
  MIRROR="mirror --reverse --no-perms --parallel=4 site/$target/ '$dir'"
  echo
  echo "== $target -> $SFTP_HOST:$dir"

  delete_this=$DELETE
  if [ "$delete_this" = yes ]; then
    echo "Files on the server that are no longer part of the $target site:"
    STALE=$(run_lftp "$dir" "$MIRROR --delete --dry-run" | grep -E '^rm ' || true)
    if [ -z "$STALE" ]; then
      echo "  none"
    else
      echo "$STALE" | sed 's/^/  /'
      read -r -p "Delete these from the server? [y/N] " OK
      [ "$OK" = y ] || [ "$OK" = Y ] || { echo "Nothing deleted; uploading only."; delete_this=no; }
    fi
  fi

  if [ "$delete_this" = yes ]; then
    run_lftp "$dir" "$MIRROR --delete --verbose"
  else
    run_lftp "$dir" "$MIRROR --verbose"
  fi
  echo "Done: $SFTP_HOST:$dir"
done
