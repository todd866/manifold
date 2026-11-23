#!/bin/bash
# Publish a sanitized snapshot of this repo to the public GitHub repo.
#
# The working repo (origin, private) keeps full history. The public repo never
# receives that history: each publish exports REF via `git archive` and commits
# a single snapshot on top of origin/main in PUBLIC_DIR. No force push, ever.
#
#   scripts/publish-public.sh            # dry run: run all 6 gates + show diff
#   scripts/publish-public.sh --push     # commit with noreply identity & push
set -euo pipefail

PUSH=0
if [ $# -gt 1 ]; then
  echo "Usage: $0 [--push]" >&2
  exit 2
fi
case "${1:-}" in
  "") ;;
  --push) PUSH=1 ;;
  *)
    echo "Usage: $0 [--push]" >&2
    exit 2
    ;;
esac

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."

REF=${REF:-main}
REPO=$(git rev-parse --show-toplevel)
PUBLIC_DIR=${MANIFOLD_PUBLIC_DIR:-$HOME/Projects/manifold-public}
IDENT_NAME="todd866"
IDENT_EMAIL="todd866@users.noreply.github.com"

# Resolve external denylist (read-only; never print its contents).
if [ -n "${PUBLIC_DENYLIST:-}" ] && [ ! -f "$PUBLIC_DENYLIST" ]; then
  echo "BLOCKED: PUBLIC_DENYLIST not found: $PUBLIC_DENYLIST" >&2
  exit 2
fi
DENYLIST="${PUBLIC_DENYLIST:-$HOME/.config/manifold/public-denylist.txt}"
if [ -f "$DENYLIST" ] && ! grep -qvE '^(#|[[:space:]]*$)' "$DENYLIST"; then
  echo "BLOCKED: denylist $DENYLIST contains no active patterns" >&2
  exit 2
fi

IMAGES_OK="${PUBLIC_IMAGES_OK:-$REPO/scripts/public-images-approved.txt}"
if [ ! -f "$IMAGES_OK" ]; then
  echo "BLOCKED: missing image allowlist: $IMAGES_OK" >&2
  exit 2
fi

# Pre-flight repo safety checks.
if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
  echo "BLOCKED: tracked files in $REPO have uncommitted changes." >&2
  exit 1
fi
if ! git -C "$REPO" rev-parse --verify "${REF}^{commit}" >/dev/null 2>&1; then
  echo "BLOCKED: ref '$REF' does not resolve to a commit in $REPO" >&2
  exit 1
fi
if [ ! -e "$PUBLIC_DIR/.git" ]; then
  echo "BLOCKED: public checkout missing .git at $PUBLIC_DIR" >&2
  exit 1
fi
if [ "$(cd "$PUBLIC_DIR" && pwd -P)" = "$(cd "$REPO" && pwd -P)" ]; then
  echo "BLOCKED: PUBLIC_DIR resolves to private REPO ($REPO)" >&2
  exit 1
fi

PRIV_ORIGIN=$(git -C "$REPO" remote get-url origin 2>/dev/null || true)
PUB_ORIGIN=$(git -C "$PUBLIC_DIR" remote get-url origin 2>/dev/null || true)
if [ -z "$PUB_ORIGIN" ]; then
  echo "BLOCKED: $PUBLIC_DIR has no origin remote" >&2
  exit 1
fi
if [ -n "$PRIV_ORIGIN" ] && [ "$PUB_ORIGIN" = "$PRIV_ORIGIN" ]; then
  echo "BLOCKED: $PUBLIC_DIR origin ($PUB_ORIGIN) equals private repo origin" >&2
  exit 1
fi
case "$PUB_ORIGIN" in
  *-private*)
    echo "BLOCKED: $PUBLIC_DIR origin ($PUB_ORIGIN) matches *-private*" >&2
    exit 1
    ;;
esac

EXPORT=$(mktemp -d "${TMPDIR:-/tmp}/manifold-public.XXXXXX")
trap 'rm -rf "$EXPORT"' EXIT
git -C "$REPO" archive "$REF" | tar -x -C "$EXPORT"

# Gate 1: .public-exclude + .DS_Store
EXCLUDE_FILE="$EXPORT/.public-exclude"
[ -f "$EXCLUDE_FILE" ] || EXCLUDE_FILE="$REPO/.public-exclude"
if [ ! -f "$EXCLUDE_FILE" ]; then
  echo "BLOCKED [Gate 1]: missing .public-exclude" >&2
  exit 1
fi

while IFS= read -r pat || [ -n "$pat" ]; do
  pat="${pat#"${pat%%[![:space:]]*}"}"
  pat="${pat%"${pat##*[![:space:]]}"}"
  case "$pat" in ''|\#*) continue ;; esac
  (
    cd "$EXPORT"
    shopt -s nullglob dotglob
    for p in $pat; do
      if [ -e "$p" ] || [ -L "$p" ]; then
        rm -rf "$p"
      fi
    done
  )
  if (
    cd "$EXPORT"
    shopt -s nullglob dotglob
    for p in $pat; do
      if [ -e "$p" ] || [ -L "$p" ]; then
        exit 0
      fi
    done
    exit 1
  ); then
    echo "BLOCKED [Gate 1]: excluded path still present: $pat" >&2
    exit 1
  fi
done < "$EXCLUDE_FILE"

find "$EXPORT" -name '.DS_Store' -delete
if [ -n "$(find "$EXPORT" -name '.DS_Store' -print -quit)" ]; then
  echo "BLOCKED [Gate 1]: .DS_Store survives in export" >&2
  exit 1
fi

fail=0

# Gate 2: External denylist scan (filenames only; never print patterns).
if [ -f "$DENYLIST" ]; then
  set +e
  hits=$(cd "$EXPORT" && rg -P -i -l --hidden -f <(grep -v '^#' "$DENYLIST" | grep -v '^[[:space:]]*$') .)
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "BLOCKED [Gate 2]: private denylist term matched in:" >&2
    echo "$hits" | sed 's/^/  /' >&2
    fail=1
  elif [ "$rc" -eq 1 ]; then
    :
  else
    echo "ERROR [Gate 2]: denylist ripgrep scan failed (exit $rc)" >&2
    exit "$rc"
  fi
else
  echo "NOTE [Gate 2]: optional denylist not found at $DENYLIST; proceeding cleanly to Gates 3-6."
fi

# Gate 3: Generic leak regexes (inline Python).
if ! python3 - "$EXPORT" <<'PY'
import os
import re
import sys

root = sys.argv[1]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
USER_PATH_RE = re.compile(r"/Users/([A-Za-z0-9._-]+)")
TS_RE = re.compile(r"tail[0-9a-f]+\.ts\.net", re.IGNORECASE)
LOCAL_HOST_RE = re.compile(r"iantodds" + r"[-]macbook" + r"[-]air", re.IGNORECASE)
PRIV_KEY_RE = re.compile(r"-----BEGIN " + r"[A-Z ]*PRIVATE KEY-----")
R2_RE = re.compile(r"[0-9a-f]{32}\.r2\.cloudflarestorage\.com", re.IGNORECASE)
GOOGLE_KEY_RE = re.compile(r"(?<![A-Za-z0-9])AIza" + r"[0-9A-Za-z_-]{30,}")
SK_KEY_RE = re.compile(r"(?<![A-Za-z0-9])sk-" + r"[0-9A-Za-z]{20,}")

ALLOWED_EMAIL_SUFFIXES = ("@users.noreply.github.com", "@example.com")
ALLOWED_USERS = {"example"}

findings = []

for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d != ".git"]
    for name in sorted(filenames):
        if name == "package-lock.json":
            continue
        full_path = os.path.join(dirpath, name)
        if os.path.islink(full_path):
            continue
        rel_path = os.path.relpath(full_path, root)
        try:
            with open(full_path, "rb") as f:
                raw = f.read()
        except OSError as exc:
            findings.append(f"{rel_path}: unreadable ({exc})")
            continue
        if b"\x00" in raw:
            continue
        text = raw.decode("utf-8", errors="ignore")
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in EMAIL_RE.finditer(line):
                email = m.group(0).lower()
                if not email.endswith(ALLOWED_EMAIL_SUFFIXES):
                    findings.append(f"{rel_path}:{lineno}: personal email")
            for m in USER_PATH_RE.finditer(line):
                user = m.group(1)
                if user.lower() not in ALLOWED_USERS:
                    findings.append(f"{rel_path}:{lineno}: literal /Users/{user} path")
            if TS_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: Tailscale hostname")
            if LOCAL_HOST_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: local hostname pattern")
            if PRIV_KEY_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: private key header")
            if R2_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: R2 storage endpoint")
            if GOOGLE_KEY_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: Google API key pattern")
            if SK_KEY_RE.search(line):
                findings.append(f"{rel_path}:{lineno}: sk- secret pattern")

if findings:
    print("BLOCKED [Gate 3]: generic leak check failed:", file=sys.stderr)
    for item in findings:
        print(f"  {item}", file=sys.stderr)
    sys.exit(1)
PY
then
  fail=1
fi

# Gate 4: Image SHA-256 allowlist.
while IFS= read -r -d '' img; do
  sum=$(shasum -a 256 "$img" | cut -d' ' -f1)
  if ! grep -Eiq "^${sum}([[:space:]]|$)" "$IMAGES_OK"; then
    echo "BLOCKED [Gate 4]: unreviewed image ${img#$EXPORT/} ($sum)" >&2
    fail=1
  fi
done < <(find "$EXPORT" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.icns' -o -iname '*.svg' \) -print0)

# Gate 5: gitleaks secret scan on exported tree.
if ! gitleaks dir "$EXPORT" --no-banner --exit-code 1; then
  echo "BLOCKED [Gate 5]: gitleaks reported findings in $EXPORT" >&2
  fail=1
fi

# Gate 6: Standalone tests on exported tree (no node_modules required).
if ! node --test --experimental-strip-types "$EXPORT/tests/manifold.test.ts" "$EXPORT/tests/sync_cli.test.ts"; then
  echo "BLOCKED [Gate 6]: standalone test suite failed in export" >&2
  fail=1
fi

[ "$fail" -eq 0 ] || { echo "Publish aborted: one or more gates failed." >&2; exit 1; }

file_count=$(cd "$EXPORT" && find . -type f | wc -l | tr -d ' ')
ref_short=$(git -C "$REPO" rev-parse --short "$REF")
echo "All 6 gates passed: $file_count files from $REF ($ref_short)."

# Stage exported snapshot cleanly onto origin/main in PUBLIC_DIR.
git -C "$PUBLIC_DIR" fetch -q origin main
git -C "$PUBLIC_DIR" checkout -q main
git -C "$PUBLIC_DIR" reset -q --hard origin/main
rsync -a --delete --exclude .git "$EXPORT"/ "$PUBLIC_DIR"/
git -C "$PUBLIC_DIR" add -A

if git -C "$PUBLIC_DIR" diff --cached --quiet; then
  echo "Public repo already matches $REF ($ref_short)."
  exit 0
fi

git -C "$PUBLIC_DIR" diff --cached --stat
if [ "$PUSH" -eq 0 ]; then
  git -C "$PUBLIC_DIR" reset -q --hard origin/main
  if [ -n "$(git -C "$PUBLIC_DIR" status --porcelain)" ]; then
    echo "ERROR: $PUBLIC_DIR working tree not empty after dry-run reset" >&2
    exit 1
  fi
  echo "Dry run complete ($PUBLIC_DIR clean). Re-run with --push to commit and push."
  exit 0
fi

GIT_AUTHOR_NAME="$IDENT_NAME" GIT_AUTHOR_EMAIL="$IDENT_EMAIL" \
GIT_COMMITTER_NAME="$IDENT_NAME" GIT_COMMITTER_EMAIL="$IDENT_EMAIL" \
  git -C "$PUBLIC_DIR" -c commit.gpgsign=false commit -q -m "Snapshot of $ref_short ($(date -u +%Y-%m-%d))"
git -C "$PUBLIC_DIR" log -1 --format='%an <%ae> / %cn <%ce>' | grep -qv gmail
git -C "$PUBLIC_DIR" push origin main
