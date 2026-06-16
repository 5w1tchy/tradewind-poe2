---
name: release
description: Cut a Tradewind release. Gathers commits since the last vX.Y.Z tag, infers the next version, writes both the terse dev commit body and the polished user-facing "What's new" notes into CHANGELOG.md, opens the release PR, and (after merge) tags + publishes. Use when the user wants to release, cut a version, draft release notes, or generate a changelog.
---

# Release skill

Drives a Tradewind release end-to-end, split into two phases around the
protected-`main` PR-merge gate. Releases are **tag-driven**: pushing a
`vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds the
installer and creates the GitHub Release. The auto-updater consumes that
release feed (see CLAUDE.md → Auto-update).

There are **two changelogs from the same commits**:

- **Terse dev body** — what goes in the `Release vX.Y.Z` commit message. Bullet
  points with PR refs (`#33`). For maintainers reading `git log`.
- **Polished "What's new"** — user-facing, emoji-sectioned, plain language, with
  a `compare/` link. Lives in `CHANGELOG.md` and is reused verbatim as the
  GitHub Release body. For players and the in-app updater.

`CHANGELOG.md` (repo root) is the single source of truth for the polished notes.
Follow its existing format exactly.

---

## First: figure out which phase we're in

```sh
git fetch --tags origin
git describe --tags --abbrev=0        # last release tag, e.g. v0.1.9
git rev-parse --abbrev-ref HEAD       # current branch
```

- On `main` (or a fresh clone) with **no** open `release/*` branch and the head
  is **not** a `Release vX.Y.Z` commit → **Phase A**.
- The `Release vX.Y.Z` commit for the pending version is **already merged into
  `main`** but **no tag exists yet** for it → **Phase B**.

If unsure, ask the user which phase they mean.

---

## Phase A — Prepare the release PR

1. **Collect commits since the last tag.**
   ```sh
   git log <lastTag>..HEAD --no-merges --pretty=format:'%h %s'
   ```
   Ignore merge commits and prior `Release vX.Y.Z` commits.

2. **Infer the next version** from conventional-commit prefixes:
   - any `feat:` → **minor** bump
   - only `fix:` / `perf:` / `refactor:` / `chore:` / docs → **patch** bump
   - a `!` or `BREAKING CHANGE` → **major** bump (pre-1.0: treat as minor and
     call it out — confirm with the user)
   - Propose the computed version, **show the user, let them override.** Support
     an explicit override and a `-beta.N` pre-release suffix (CI publishes
     suffixed tags to the demo/beta channel).

3. **Branch.** `git switch -c release/vX.Y.Z` off the latest `main`.

4. **Bump the version.** Use `npm version <x.y.z> --no-git-tag-version` so
   `package.json` **and** `package-lock.json` update together. Do not let it
   create a tag or commit.

5. **Write the polished "What's new" entry** and **prepend** it to
   `CHANGELOG.md` (newest on top), matching the file's existing format:
   group changes into a few player-facing themed sections with a short emoji
   heading; describe behavior, not internals; reference issues/PRs the way the
   existing entries do; end with the
   `**Full changelog:** .../compare/<lastTag>...vX.Y.Z` link. If `CHANGELOG.md`
   is missing, create it with a `# Changelog` header, then the entry.

6. **Write the terse dev body** — a few bullets summarizing the changes with
   `(#PR)` refs, in the style of the existing `Release vX.Y.Z` commits
   (e.g. `git show 991a7f5`).

7. **Commit.**
   ```sh
   git add package.json package-lock.json CHANGELOG.md
   git commit            # subject: "Release vX.Y.Z", body: the terse dev notes
   ```
   End the commit message with the `Co-Authored-By` trailer (see CLAUDE.md → Git).

8. **Push & open the PR** against `main`:
   ```sh
   git push -u origin release/vX.Y.Z
   gh pr create --base main --title "Release vX.Y.Z" --body <summary>
   ```

9. **Stop.** Tell the user the PR is up for review and that re-running `/release`
   after it merges will tag and publish (Phase B). **Do not** merge the PR or
   push a tag yourself — `main` is protected and the merge is the human gate.

---

## Phase B — Tag & publish (after the PR is merged)

1. **Sync `main`.**
   ```sh
   git switch main && git pull origin main
   ```
   Confirm `package.json`'s version matches the `Release vX.Y.Z` you expect and
   that `CHANGELOG.md`'s top entry is for vX.Y.Z.

2. **Tag & push** — this is what triggers CI:
   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Wait for the release workflow** to finish (it deletes & recreates the
   release for the tag, so editing earlier would be overwritten):
   ```sh
   gh run watch $(gh run list --workflow release.yml --branch vX.Y.Z \
     --limit 1 --json databaseId -q '.[0].databaseId')
   ```

4. **Replace the placeholder notes** with the polished CHANGELOG entry. Extract
   the top section of `CHANGELOG.md` (everything for vX.Y.Z, without the file
   header) into a temp file and:
   ```sh
   gh release edit vX.Y.Z --notes-file <that-section>
   ```
   Keep `--latest` for stable tags; for a `-beta.N` tag it's a pre-release —
   don't promote it to latest.

5. **Report** the release URL and confirm the asar/installer assets
   (`*-setup.exe`, `.blockmap`, `latest.yml`/`beta.yml`) are attached.

---

## Notes & guardrails

- Never push directly to `main`; never `gh pr merge` a protected-branch release
  PR on the user's behalf unless they explicitly ask.
- One release per invocation. If the working tree is dirty, stop and surface it.
- If there are zero releasable commits since the last tag, say so and stop.
- The version lives only in `package.json`/`package-lock.json`; there is no
  version constant in code to update.
