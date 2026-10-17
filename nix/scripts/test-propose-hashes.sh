#!/usr/bin/env bash
set -euo pipefail

script="${PROPOSER:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/propose-hashes.sh}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

GITHUB_SHA="$(printf 'a%.0s' {1..40})"
export GITHUB_SHA
export GITHUB_REF_NAME=dev
EXPECTED_LOCK_SHA="$(printf 'b%.0s' {1..64})"
export EXPECTED_LOCK_SHA
systems=(x86_64-linux aarch64-linux x86_64-darwin aarch64-darwin)

artifact() {
  local system="$1" hash="${2:-sha256-$(printf 'A%.0s' {1..43})=}" sha="${3:-$GITHUB_SHA}" lock="${4:-$EXPECTED_LOCK_SHA}"
  mkdir -p "hashes/hash-${system}"
  printf '%s\n' "$hash" > "hashes/hash-${system}/hash.txt"
  cat > "hashes/hash-${system}/provenance.txt" <<EOF
system=${system}
git-sha=${sha}
git-ref=${GITHUB_REF_NAME}
bun-lock-sha256=${lock}
nix=nix (Nix) 2.31.2
bun=1.3.11
runner-os=$([[ "$system" == *-linux ]] && echo Linux || echo macOS)
runner-arch=$([[ "$system" == aarch64-* ]] && echo ARM64 || echo X64)
run-id=123
run-attempt=1
EOF
}

case_run() {
  local name="$1" expected="$2" actual
  mkdir -p "$root/$name"
  pushd "$root/$name" >/dev/null
  if bash "$script" > run.log 2>&1; then actual=0; else actual=$?; fi
  if [[ "$expected" == failure && "$actual" -eq 0 ]] || [[ "$expected" == success && "$actual" -ne 0 ]]; then
    echo "FAIL $name: expected $expected, got exit $actual" >&2
    cat run.log >&2
    exit 1
  fi
  if [[ "$expected" == failure && -e proposed/nix-hashes-proposed.json ]]; then
    echo "FAIL $name: failed assembly emitted a proposed hash file" >&2
    exit 1
  fi
  if [[ "$expected" == success ]]; then
    [[ -s proposed/provenance.txt ]] || { echo "FAIL $name: missing provenance" >&2; exit 1; }
    for system in "${systems[@]}"; do
      grep -Fq '"'"$system"'"' proposed/nix-hashes-proposed.json || exit 1
      grep -Fxq -- "--- ${system}" proposed/provenance.txt || exit 1
    done
  fi
  popd >/dev/null
  echo "PASS $name"
}

mkdir -p "$root/empty"
case_run empty failure

mkdir -p "$root/partial"
pushd "$root/partial" >/dev/null
artifact x86_64-linux
popd >/dev/null
case_run partial failure

mkdir -p "$root/full"
pushd "$root/full" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
popd >/dev/null
case_run full success

mkdir -p "$root/invalid-sri"
pushd "$root/invalid-sri" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
printf 'sha256-NOT-VALID\n' > hashes/hash-aarch64-linux/hash.txt
popd >/dev/null
case_run invalid-sri failure

mkdir -p "$root/invalid-provenance"
pushd "$root/invalid-provenance" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
rm hashes/hash-x86_64-darwin/provenance.txt
popd >/dev/null
case_run invalid-provenance failure

mkdir -p "$root/mismatched-lock"
pushd "$root/mismatched-lock" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
artifact aarch64-darwin "sha256-$(printf 'A%.0s' {1..43})=" "$GITHUB_SHA" "$(printf 'c%.0s' {1..64})"
popd >/dev/null
case_run mismatched-lock failure

mkdir -p "$root/mismatched-sha"
pushd "$root/mismatched-sha" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
artifact aarch64-linux "sha256-$(printf 'A%.0s' {1..43})=" "$(printf 'c%.0s' {1..40})" "$EXPECTED_LOCK_SHA"
popd >/dev/null
case_run mismatched-sha failure

mkdir -p "$root/mismatched-bun"
pushd "$root/mismatched-bun" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
sed -i 's/^bun=1.3.11$/bun=1.3.12/' hashes/hash-aarch64-darwin/provenance.txt
popd >/dev/null
case_run mismatched-bun failure

mkdir -p "$root/mismatched-run"
pushd "$root/mismatched-run" >/dev/null
for system in "${systems[@]}"; do artifact "$system"; done
sed -i 's/^run-id=123$/run-id=456/' hashes/hash-aarch64-darwin/provenance.txt
popd >/dev/null
case_run mismatched-run failure

echo 'All deterministic hash-proposal fixtures passed'
