# Fork Strategy — openchamber fork

Personal fork of [openchamber/openchamber](https://github.com/openchamber/openchamber)
using the **revert-then-repatch** strategy (same model as the WaveTerm fork; see
`~/.config/devin/skills/fork-sync-strategy/` for the full reference).

## Branch model

| Branch       | Tracks                          | Purpose                                        |
| ------------ | ------------------------------- | ---------------------------------------------- |
| `main`       | Latest upstream release tag     | Stable — only well-tested patches              |
| `dev.patch`  | `upstream/main` (latest dev)    | Unstable — carries the current patch set       |
| `feature/*`  | Branched from `dev.patch`       | Feature development (merged back when stable)  |

**Always branch from `dev.patch`**, never from `main` or `dev`.

## Current patches

| #   | Patch                              | Content                                                              | Status                                                        |
| --- | ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| 001 | `001-dev-server-labels.patch`      | Name + process label for dev servers in the browser panel            | Upstream discussion [openchamber#4748](https://github.com/openchamber/openchamber/discussions/4748); PR pending maintainer go-ahead |

Files only added by a feature (no upstream counterpart) are committed to
`dev.patch` directly — only files that exist upstream go into `.patch` files.

For 001 the new files are:

- `packages/ui/src/lib/browser/devServerLabels.ts`
- `packages/ui/src/lib/browser/devServerLabels.test.ts`
- `packages/ui/src/components/browser/DevServerLabelDialog.tsx`

## How the sync works

`.github/workflows/sync-upstream-and-fix.yml` (daily 07:00 UTC or manual):

1. Reverts every file in `PATCHED_FILES` to the upstream version.
2. Merges upstream (latest `v*` tag into `main`, `upstream/main` into `dev.patch`).
3. Re-applies all `.github/patches/*.patch` in alphabetical order.
4. Commits and pushes. A merge conflict on a non-patched file fails loudly —
   that is the point of the revert-then-repatch order.

`PATCHED_FILES` lives in the workflow `env:` block. The upstream-PR catalog
tooling (`generate_upstream_prs.py`, `update-upstream-prs.yml`, `UPSTREAM-PRS.md`)
from the reference strategy is not installed yet — add it when the patch count
justifies tracking upstream PRs.

## Developing a new patch

```bash
git checkout dev.patch
git checkout -b feature/my-change
# ... develop, direct commits ...

# Generate the patch for upstream-modified files (new files are reported but
# stay committed directly):
fork-genpatch generate \
    --branch feature/my-change \
    --base upstream/main \
    --repo ~/work/dev/github/tobiashochguertel/openchamber \
    --output .github/patches/NNN-my-change.patch \
    --validate --update-patched-files
```

Then:

```bash
# Sanity: the patch must apply to upstream AND reverse-apply on dev.patch
git apply --check .github/patches/NNN-my-change.patch           # vs base worktree
git apply --reverse --check .github/patches/NNN-my-change.patch # vs dev.patch

git checkout dev.patch
git merge --no-ff feature/my-change
git add .github/patches/NNN-my-change.patch .github/workflows/sync-upstream-and-fix.yml
git commit -m "chore: integrate <description> via .patch"
```

## Rules

1. Always branch from `dev.patch`.
2. Never edit upstream files directly on `dev.patch` without a matching `.patch` file.
3. New files don't need patches — commit them directly.
4. One logical change per `.patch` file, zero-padded `NNN-` names.
5. Verify idempotency: forward apply on upstream base, reverse apply on `dev.patch`.
6. Keep `PATCHED_FILES` in the workflow in sync with every patch's modified files.
7. When an upstream PR merges a patch's change, drop the patch and its files
   from `PATCHED_FILES` — the next sync merges the upstream version anyway.
