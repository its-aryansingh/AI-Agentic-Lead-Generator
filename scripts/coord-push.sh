#!/usr/bin/env bash
# scripts/coord-push.sh
#
# POSIX twin of coord-push.ps1.

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
repo_root=$(cd -- "$script_dir/.." >/dev/null 2>&1 && pwd)
cd "$repo_root"

coord_dir="$repo_root/.coord"
manifest_path="$script_dir/coord-manifest.txt"
message="${1:-}"

if [[ ! -d "$coord_dir" ]]; then
  echo ".coord/ not found — run ./scripts/coord-init.sh first." >&2
  exit 1
fi

echo "Refreshing .coord/ ..."
git -C "$coord_dir" pull --ff-only

changed=()
while IFS= read -r line || [[ -n "$line" ]]; do
  entry="${line%%#*}"
  entry="${entry## }"
  entry="${entry%% }"
  [[ -z "$entry" ]] && continue
  src="$repo_root/$entry"
  dst="$coord_dir/$entry"
  if [[ ! -e "$src" ]]; then continue; fi
  mkdir -p "$(dirname "$dst")"
  if [[ -d "$src" ]]; then
    rm -rf "$dst"
    cp -R "$src" "$dst"
  else
    cp -f "$src" "$dst"
  fi
  changed+=("$entry")
done <"$manifest_path"

git -C "$coord_dir" add -A
if git -C "$coord_dir" diff --cached --quiet; then
  echo "Nothing to push — coord is already up to date."
  exit 0
fi

if [[ -z "$message" ]]; then
  stamp=$(date '+%Y-%m-%d %H:%M')
  author=$(git config user.name 2>/dev/null || echo team)
  default_msg="coord sync from $author @ $stamp"
  echo "Commit message (default: '$default_msg'):"
  read -r entered || true
  if [[ -z "${entered:-}" ]]; then message="$default_msg"; else message="$entered"; fi
fi

git -C "$coord_dir" commit -m "$message"
git -C "$coord_dir" push

echo
echo "Pushed:"
for f in "${changed[@]}"; do echo "  $f"; done
echo "Teammates pull with: ./scripts/coord-pull.sh"
