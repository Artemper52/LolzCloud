#!/bin/sh
set -eu
umask 077
test "$#" -ge 7 || exit 2
parent=$1
parent_start=$2
image=$3
staged=$4
old_hash=$5
new_hash=$6
update_id=$7
shift 7
working=$(dirname "$staged")
image_parent=$(dirname "$image")
lock="$image.lolzcloud-update.lock"
backup="$working/previous.AppImage"
locked=0
result() { printf '%s\n' "$1" > "$working/result.txt"; }
cleanup() { if test "$locked" = 1;then rmdir "$lock" 2>/dev/null || true;fi; }
trap cleanup EXIT
case "$parent" in ''|0*|*[!0-9]*) exit 2;;esac
case "$parent_start" in ''|0*|*[!0-9]*) exit 2;;esac
test ${#old_hash} -eq 64 && test ${#new_hash} -eq 64 && test ${#update_id} -eq 32 || exit 2
case "$old_hash$new_hash$update_id" in *[!0-9a-f]*) exit 2;;esac
case "$image" in /*) ;; *) exit 2;;esac
case "$working" in "$image_parent/.lolzcloud-update-$update_id-"*) ;; *) exit 2;;esac
test "$(basename "$staged")" = update.AppImage && test "$image_parent" != / || exit 2
test -f "$image" && test ! -L "$image" && test -f "$staged" && test ! -L "$staged" || exit 2
digest() { sha256sum < "$1" | cut -d ' ' -f 1; }
test "$(digest "$image")" = "$old_hash" || { result old-image-changed;exit 1; }
test "$(digest "$staged")" = "$new_hash" || { result staged-image-changed;exit 1; }
test ! -e "$backup" || { result backup-exists;exit 1; }
mkdir -m 0700 "$lock" 2>/dev/null || { result update-already-running;exit 1; }
locked=1
if ! ln "$image" "$backup";then
  cp -p "$image" "$backup" || { result backup-failed;exit 1; }
fi
test "$(digest "$backup")" = "$old_hash" || { result backup-failed;exit 1; }
test ! -f "$working/cancel" || { result cancelled;exit 1; }
printf '%s\n' ready > "$working/ready"
count=0
while test -r "/proc/$parent/stat";do
  test ! -f "$working/cancel" || { result cancelled;exit 1; }
  observed=$(awk '{ sub(/.*\) /, ""); print $20 }' "/proc/$parent/stat" 2>/dev/null || true)
  test "$observed" = "$parent_start" || break
  count=$((count + 1))
  test "$count" -le 120 || { result parent-still-running;exit 1; }
  sleep 1
done
test ! -f "$working/cancel" || { result cancelled;exit 1; }
test -f "$image" && test ! -L "$image" && test "$(digest "$image")" = "$old_hash" || { result old-image-changed;exit 1; }
test -f "$staged" && test ! -L "$staged" && test "$(digest "$staged")" = "$new_hash" || { result staged-image-changed;exit 1; }
if ! mv -f "$staged" "$image";then
  "$image" "$@" > "$working/relaunch.log" 2>&1 &
  result replacement-failed;exit 1
fi
"$image" "$@" > "$working/relaunch.log" 2>&1 &
restarted=$!
sleep 2
if kill -0 "$restarted" 2>/dev/null;then
  result updated
elif wait "$restarted";then
  result updated
else
  if test "$(digest "$image")" = "$new_hash" && test "$(digest "$backup")" = "$old_hash";then
    mv -f "$backup" "$image"
    "$image" "$@" > "$working/rollback.log" 2>&1 &
    result rolled-back
  else result changed-after-restart;exit 1
  fi
fi
