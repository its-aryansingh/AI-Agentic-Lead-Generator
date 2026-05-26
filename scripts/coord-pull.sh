#!/usr/bin/env bash
# scripts/coord-pull.sh
#
# POSIX twin of coord-pull.ps1.

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
repo_root=$(cd -- "$script_dir/.." >/dev/null 2>&1 && pwd)
cd "$repo_root"

coord_dir="$repo_root/.coord"
manifest_path="$script_dir/coord-manifest.txt"

if [[ ! -d "$coord_dir" ]]; then
  echo ".coord/ not found — run ./scripts/coord-init.sh first." >&2
  exit 1
fi
if [[ ! -f "$manifest_path" ]]; then
  echo "Missing scripts/coord-manifest.txt." >&2
  exit 1
fi

echo "Pulling .coord/ ..."
git -C "$coord_dir" pull --ff-only

copied=0; skipped=0
while IFS= read -r line || [[ -n "$line" ]]; do
  entry="${line%%#*}"
  entry="${entry## }"
  entry="${entry%% }"
  [[ -z "$entry" ]] && continue
  src="$coord_dir/$entry"
  dst="$repo_root/$entry"
  if [[ ! -e "$src" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -d "$src" ]]; then
    rm -rf "$dst"
    cp -R "$src" "$dst"
  else
    cp -f "$src" "$dst"
  fi
  echo "  pull   $entry"
  copied=$((copied + 1))
done <"$manifest_path"

echo "Pulled — $copied file(s)/dir(s), $skipped skipped."
