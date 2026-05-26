# Team Coordination — Setup Guide

This repo is public. The agent-coordination files (`COORDINATION.md`,
`CLAUDE.md`, `plan.md`, `AGENTS.md`, `.githooks/`) are **gitignored**
here and live in a **private companion repo** that only you and your
teammates can access. The scripts in this directory keep the two
repos in sync.

```
its-aryansingh/AI-Agentic-Lead-Generator  ← PUBLIC. Code only.
its-aryansingh/leadgenai-coord            ← PRIVATE. Coordination files.
        │
        ▼   (clone into .coord/, copy files into working tree)
your local working tree
```

---

## One-time setup (Aryan, the project owner)

1. **Create the private repo on GitHub.**
   - https://github.com/new → owner: you, name: `leadgenai-coord` (or any
     name you like), visibility: **Private**, no README/license/.gitignore.
2. **Populate it from your current working tree.**
   ```powershell
   # From the public repo root (this one):
   git clone <empty-private-repo-url> ../leadgenai-coord
   Copy-Item COORDINATION.md, CLAUDE.md, AGENTS.md, plan.md, GEMINI.md ../leadgenai-coord/ -ErrorAction SilentlyContinue
   if (Test-Path .githooks) { Copy-Item -Recurse .githooks ../leadgenai-coord/ }
   cd ../leadgenai-coord
   git add -A
   git commit -m "initial: coord files from working tree"
   git push -u origin master
   cd -
   ```
3. **Switch THIS repo over to using the synced copy.**
   ```powershell
   pwsh ./scripts/coord-init.ps1 -RepoUrl <private-repo-url>
   ```
   This clones the private repo into `.coord/` and re-copies the files
   into the working tree. From now on, every coordination edit you make
   should be pushed back via `coord-push.ps1` so teammates see it.
4. **Add teammates as collaborators on the private repo.**
   - https://github.com/<owner>/leadgenai-coord/settings/access
   - Add each teammate's GitHub username with **Write** access (they need
     to push log entries back).

## Onboarding a teammate

Send them this. (They need write access to the private repo first.)

```powershell
# Windows PowerShell
git clone https://github.com/its-aryansingh/AI-Agentic-Lead-Generator
cd AI-Agentic-Lead-Generator
pwsh ./scripts/coord-init.ps1 -RepoUrl <private-repo-url-Aryan-shares>
```

```bash
# macOS / Linux
git clone https://github.com/its-aryansingh/AI-Agentic-Lead-Generator
cd AI-Agentic-Lead-Generator
./scripts/coord-init.sh <private-repo-url-Aryan-shares>
```

After init, the teammate's working tree has `COORDINATION.md`,
`CLAUDE.md`, `plan.md` etc. — identical to yours. Their AI agent will
read the same coordination instructions you wrote.

## Daily workflow

Before any agent work:

```powershell
pwsh ./scripts/coord-pull.ps1
```

After making agent changes that updated `COORDINATION.md` (Section 13
log appends, 0.2 file claims, etc.) or `plan.md`:

```powershell
pwsh ./scripts/coord-push.ps1
# (Optional) pass a message:
pwsh ./scripts/coord-push.ps1 -Message "log: alice claimed app/api/foo"
```

That's it. The coordination files never touch the public repo —
`.gitignore` blocks them, and the scripts only ever push to `.coord/`'s
private origin.

## What's in the manifest

`scripts/coord-manifest.txt` is the single source of truth for which
files are synced. Edit it to add/remove files; the change applies on
the next `coord-init` / `coord-pull` / `coord-push`.

Default manifest:
- `COORDINATION.md` — master coordination doc
- `CLAUDE.md` — project-level Claude CLI rules
- `AGENTS.md` — universal AI context
- `plan.md` — phase tracker
- `GEMINI.md` — (if present) Gemini Code Assist rules
- `.githooks/` — auto-push hook + commit hooks

## Troubleshooting

**"Permission denied" on `git clone`**: your GitHub token / SSH key
isn't on the private repo. Ask Aryan to add you as a collaborator.

**".coord/ not found"**: you haven't run `coord-init` yet.

**Merge conflicts in `.coord/`**: someone else pushed while you were
editing. Open `.coord/`, resolve the conflict manually with `git
merge` / `git rebase`, then re-run `coord-push.ps1`.

**Need to switch private repo URL**: run `coord-init.ps1 -Force
-RepoUrl <new-url>` to wipe `.coord/` and re-clone.

**Hooks aren't firing**: confirm `git config core.hooksPath` reports
`.githooks`. The init script sets this automatically once `.githooks/`
syncs in.

## Security notes

- The private repo URL itself isn't a secret; access is gated by your
  GitHub permissions. Don't paste production API keys into the coord
  files — they're for coordination metadata only.
- The `.coord/` directory and `.coord-url` cache are gitignored here,
  so they cannot accidentally leak into a public push.
- Teammates with write access can edit your COORDINATION.md. Treat the
  private repo's collaborator list like a sensitive permission set.

## Why this design

- **One source of truth.** Every teammate's agent reads the same coord
  files at the same paths.
- **Zero public exposure.** Public repo never carries the coord files.
- **Standard git.** No submodules, no encryption, no external tools —
  just two repos and a copy script.
- **Round-trips edits.** Agents log to `COORDINATION.md` Section 13
  locally; `coord-push` shares the log with the team.
