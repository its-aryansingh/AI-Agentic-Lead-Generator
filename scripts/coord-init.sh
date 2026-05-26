#!/usr/bin/env bash
# scripts/coord-init.sh
#
# POSIX twin of coord-init.ps1. Clones the private team-coordination
# repo into .coord/ and copies the manifest files into the working
# tree. Re-runnable (pulls latest on subsequent runs).
#
# Usage:
#   ./scripts/coord-init.sh
#   ./scripts/coord-init.sh <repo-url>
#   COORD_FORCE=1 ./scripts/coord-init.sh <repo-url>   # re-clone

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
repo_root=$(cd -- "$script_dir/.." >/dev/null 2>&1 && pwd)
cd "$repo_root"

manifest_path="$script_dir/coord-manifest.txt"
coord_dir="$repo_root/.coord"
url_cache="$repo_root/.coord-url"

if [[ ! -f "$manifest_path" ]]; then
  echo "Missing scripts/coord-manifest.txt — cannot determine which files to sync." >&2
  exit 1
fi

repo_url="${1:-}"
if [[ -z "$repo_url" ]]; then
  if [[ -d "$coord_dir/.git" ]]; then
    repo_url=$(git -C "$coord_dir" remote get-url origin 2>/dev/null || true)
  fi
  if [[ -z "$repo_url" && -f "$url_cache" ]]; then
    repo_url=$(<"$url_cache")
  fi
  if [[ -z "$repo_url" ]]; then
    echo "Private coord repo URL (e.g. git@github.com:your-org/leadgenai-coord.git):"
    read -r repo_url
  fi
fi
if [[ -z "$repo_url" ]]; then
  echo "No private repo URL provided." >&2
  exit 1
fi

if [[ -n "${COORD_FORCE:-}" && -d "$coord_dir" ]]; then
  echo "[COORD_FORCE] Removing existing .coord/"
  rm -rf "$coord_dir"
fi

if [[ ! -d "$coord_dir" ]]; then
  echo "Cloning $repo_url -> .coord/"
  git clone --depth=1 "$repo_url" "$coord_dir"
else
  echo ".coord/ already exists — pulling latest"
  git -C "$coord_dir" pull --ff-only
fi

printf '%s' "$repo_url" >"$url_cache"

copied=0
skipped=0
while IFS= read -r line || [[ -n "$line" ]]; do
  entry="${line%%#*}"
  entry="${entry## }"
  entry="${entry%% }"
  [[ -z "$entry" ]] && continue
  src="$coord_dir/$entry"
  dst="$repo_root/$entry"
  if [[ ! -e "$src" ]]; then
    echo "  skip   $entry (not in private repo)"
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
  echo "  copy   $entry"
  copied=$((copied + 1))
done <"$manifest_path"

if [[ -d "$repo_root/.githooks" ]]; then
  git config core.hooksPath .githooks
  echo "  hooks  core.hooksPath = .githooks"
fi

echo
echo "Coordination synced — $copied file(s)/dir(s) copied, $skipped skipped."
echo "Next:"
echo "  - Read COORDINATION.md before any agent work"
echo "  - ./scripts/coord-pull.sh   to fetch teammate updates"
echo "  - ./scripts/coord-push.sh   to share your edits with the team"
