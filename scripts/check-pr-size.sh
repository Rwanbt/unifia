#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:-origin/dev}"
excluded_regex='(^|/)(bun\.lock|package-lock\.json|pnpm-lock\.yaml)$'
generated_regex='(^|/)(dist|build|target|generated)(/|$)'

# Fail closed. A missing base or a missing merge base must stop the check: a count taken from an unavailable base is 0, and a
# zero reads as "small enough", which would pass a governance limit that was never measured.
if ! git rev-parse --verify --quiet "${base_ref}^{commit}" >/dev/null; then
  echo "PR size check: base ref '$base_ref' is not available; fetch it before running this check" >&2
  exit 2
fi
if ! merge_base="$(git merge-base "$base_ref" HEAD)"; then
  echo "PR size check: no merge base between '$base_ref' and HEAD" >&2
  exit 2
fi

from="$merge_base"

# A pull request into dev_auto that syncs dev carries commits that each passed this check on their own pull request into dev.
# When HEAD holds the sync ref and the base does not, count from the tree the base has once it holds that ref, so only what the
# pull request changes on top of it is counted. A conflict between the two leaves no such tree, and the count from the merge
# base stays.
sync_ref="${PR_SIZE_SYNC_REF:-origin/dev}"
if git rev-parse --verify --quiet "${sync_ref}^{commit}" >/dev/null \
  && git merge-base --is-ancestor "$sync_ref" HEAD \
  && ! git merge-base --is-ancestor "$sync_ref" "$base_ref" \
  && synced_tree="$(git merge-tree --write-tree "$base_ref" "$sync_ref" 2>/dev/null)"; then
  from="$synced_tree"
  echo "Sync of $sync_ref: counting only the lines it does not already hold"
fi

changed_lines=0

# The diff runs from the merge base, so commits that reached the base after this branch started are not counted.
while IFS=$'\t' read -r added deleted path; do
  [[ -z "${path:-}" ]] && continue
  normalized_path="${path//\\//}"
  [[ "$normalized_path" =~ $excluded_regex ]] && continue
  [[ "$normalized_path" =~ $generated_regex ]] && continue
  # An assignment, not `((changed_lines += n))`: an arithmetic command whose result is 0 returns status 1, and `set -e` then
  # stops the script with no message. That happened whenever the first file counted had no added line.
  [[ "$added" =~ ^[0-9]+$ ]] && changed_lines=$((changed_lines + added))
  [[ "$deleted" =~ ^[0-9]+$ ]] && changed_lines=$((changed_lines + deleted))
done < <(git diff --numstat "$from")

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  normalized_path="${path//\\//}"
  [[ "$normalized_path" =~ $excluded_regex ]] && continue
  [[ "$normalized_path" =~ $generated_regex ]] && continue
  [[ -f "$path" ]] && changed_lines=$((changed_lines + $(wc -l < "$path")))
done < <(git ls-files --others --exclude-standard)

echo "Changed lines (excluding generated and lockfiles): $changed_lines"
if (( changed_lines > 400 )); then
  echo "PR size limit exceeded: $changed_lines lines > 400" >&2
  exit 1
fi
