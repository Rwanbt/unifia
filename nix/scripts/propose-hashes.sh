#!/usr/bin/env bash
# Assemble only complete, verified native-runner results. Never modify git.
set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }

[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || fail 'Expected a complete lowercase source commit SHA'
[[ "${EXPECTED_LOCK_SHA:-}" =~ ^[a-f0-9]{64}$ ]] || fail 'Expected a complete lowercase bun.lock SHA-256'
[[ -n "${GITHUB_REF_NAME:-}" ]] || fail 'Expected a source ref'

systems=(x86_64-linux aarch64-linux x86_64-darwin aarch64-darwin)
declare -A hashes=()
shared_nix=''
shared_bun=''
shared_run=''
shared_attempt=''

for system in "${systems[@]}"; do
  dir="hashes/hash-${system}"
  [[ -f "$dir/hash.txt" && -f "$dir/provenance.txt" ]] || fail "Missing hash or provenance for ${system}"

  mapfile -t lines < "$dir/hash.txt"
  [[ "${#lines[@]}" -eq 1 ]] || fail "Expected exactly one hash for ${system}"
  hash="${lines[0]%$'\r'}"
  [[ "$hash" =~ ^sha256-[A-Za-z0-9+/]{43}=$ ]] || fail "Invalid SHA-256 SRI hash for ${system}"
  # Syntax alone accepts non-zero unused padding bits. Decode to raw bytes,
  # re-encode, and require the exact canonical 256-bit Base64 representation.
  encoded="${hash#sha256-}"
  canonical="$(printf '%s' "$encoded" | base64 --decode | base64 | tr -d '\r\n')" || fail "Cannot decode SHA-256 SRI hash for ${system}"
  [[ "$canonical" == "$encoded" ]] || fail "Non-canonical SHA-256 SRI hash for ${system}"
  hashes["$system"]="$hash"

  declare -A fields=()
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    case "$key" in
      system|git-sha|git-ref|bun-lock-sha256|nix|bun|runner-os|runner-arch|run-id|run-attempt) ;;
      *) fail "Unexpected provenance key in ${system}: ${key}" ;;
    esac
    [[ -z "${fields[$key]+present}" ]] || fail "Duplicate provenance key ${key} in ${system}"
    fields["$key"]="$value"
  done < "$dir/provenance.txt"
  [[ "${#fields[@]}" -eq 10 ]] || fail "Incomplete provenance for ${system}"
  [[ "${fields[system]}" == "$system" ]] || fail "Wrong provenance system: ${system}"
  [[ "${fields[git-sha]}" == "$GITHUB_SHA" ]] || fail "Source SHA mismatch: ${system}"
  [[ "${fields[git-ref]}" == "$GITHUB_REF_NAME" ]] || fail "Source ref mismatch: ${system}"
  [[ "${fields[bun-lock-sha256]}" == "$EXPECTED_LOCK_SHA" ]] || fail "bun.lock mismatch: ${system}"
  [[ "${fields[nix]}" =~ ^nix\ \(Nix\)\ [0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || fail "Invalid Nix tool version: ${system}"
  [[ "${fields[bun]}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid Bun tool version: ${system}"
  [[ "${fields[run-id]}" =~ ^[0-9]+$ && "${fields[run-attempt]}" =~ ^[0-9]+$ ]] || fail "Invalid run identity: ${system}"
  if [[ "$system" == *-linux ]]; then os=Linux; else os=macOS; fi
  if [[ "$system" == aarch64-* ]]; then arch=ARM64; else arch=X64; fi
  [[ "${fields[runner-os]}" == "$os" && "${fields[runner-arch]}" == "$arch" ]] || fail "Runner platform mismatch: ${system}"
  [[ -z "$shared_nix" || "$shared_nix" == "${fields[nix]}" ]] || fail "Nix version mismatch: ${system}"
  [[ -z "$shared_bun" || "$shared_bun" == "${fields[bun]}" ]] || fail "Bun version mismatch: ${system}"
  [[ -z "$shared_run" || "$shared_run" == "${fields[run-id]}" ]] || fail "Workflow run mismatch: ${system}"
  [[ -z "$shared_attempt" || "$shared_attempt" == "${fields[run-attempt]}" ]] || fail "Workflow attempt mismatch: ${system}"
  shared_nix="${fields[nix]}"
  shared_bun="${fields[bun]}"
  shared_run="${fields[run-id]}"
  shared_attempt="${fields[run-attempt]}"
  unset fields
done

# Only after validating all four systems, emit both files atomically to this job.
mkdir -p proposed
{
  printf '{"nodeModules":{'
  for i in "${!systems[@]}"; do
    system="${systems[$i]}"
    [[ "$i" -eq 0 ]] || printf ','
    printf '"%s":"%s"' "$system" "${hashes[$system]}"
  done
  printf '}}\n'
} > proposed/nix-hashes-proposed.json

: > proposed/provenance.txt
for system in "${systems[@]}"; do
  printf '\n--- %s\n' "$system" >> proposed/provenance.txt
  cat "hashes/hash-${system}/provenance.txt" >> proposed/provenance.txt
done
cat proposed/nix-hashes-proposed.json
