#!/usr/bin/env bash
# Build the web app from a clean checkout of a committed ref and publish it to the gh-pages branch.
#   usage: web/scripts/deploy-gh-pages.sh [ref]        (default: HEAD)
# GitHub Pages must be set to "Deploy from a branch: gh-pages / (root)".
# (A GitHub Actions alternative lives in docs/deploy-pages.workflow.yml; pushing it needs a token
#  with the `workflow` scope.)
set -euo pipefail
REF=${1:-HEAD}
REPO=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
BUILD="$TMP/build"
PAGES="$TMP/pages"
cleanup() { git -C "$REPO" worktree remove --force "$BUILD" 2>/dev/null || true
            git -C "$REPO" worktree remove --force "$PAGES" 2>/dev/null || true
            rm -rf "$TMP"; }
trap cleanup EXIT

echo "== building $(git -C "$REPO" rev-parse --short "$REF")"
git -C "$REPO" worktree add --detach "$BUILD" "$REF" >/dev/null
ln -s "$REPO/web/node_modules" "$BUILD/web/node_modules"
(cd "$BUILD/web" && npm run build >/dev/null)
touch "$BUILD/web/dist/.nojekyll"          # serve files as-is (no Jekyll processing)

echo "== preparing gh-pages"
if git -C "$REPO" show-ref --verify --quiet refs/heads/gh-pages; then
  git -C "$REPO" worktree add "$PAGES" gh-pages >/dev/null
elif git -C "$REPO" ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git -C "$REPO" fetch -q origin gh-pages:gh-pages
  git -C "$REPO" worktree add "$PAGES" gh-pages >/dev/null
else
  git -C "$REPO" worktree add --orphan -b gh-pages "$PAGES" >/dev/null
fi
find "$PAGES" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$BUILD/web/dist/." "$PAGES/"
git -C "$PAGES" add -A
if git -C "$PAGES" diff --cached --quiet; then
  echo "nothing changed"; exit 0
fi
git -C "$PAGES" commit -q -m "Deploy $(git -C "$REPO" rev-parse --short "$REF")"
git -C "$PAGES" -c http.postBuffer=524288000 push -q origin gh-pages
echo "== deployed $(git -C "$PAGES" rev-parse --short HEAD) to gh-pages"
