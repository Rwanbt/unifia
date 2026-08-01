#!/usr/bin/env bash
# test-audit-status.sh — Test que le rapport d'audit est complet
# Usage: bash tests/integration/test-audit-status.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATUS="$REPO_ROOT/AUDIT-FINDINGS-STATUS.md"
REPORT="$REPO_ROOT/AUDIT_REPORT.md"

echo "=== Test AUDIT-FINDINGS-STATUS ==="

# === Test 1: fichier existe ===
if [ -f "$STATUS" ]; then
    pass "AUDIT-FINDINGS-STATUS.md exists"
else
    fail "AUDIT-FINDINGS-STATUS.md missing"
    exit 1
fi

# === Test 2: AUDIT_REPORT.md existe ===
if [ -f "$REPORT" ]; then
    pass "AUDIT_REPORT.md exists"
else
    fail "AUDIT_REPORT.md missing"
    exit 1
fi

# === Test 3: 20 findings ===
N=$(grep -cE "^### A\.[0-9]+" "$REPORT")
if [ "$N" -ge 20 ]; then
    pass "AUDIT_REPORT has $N findings (>= 20)"
else
    fail "Only $N findings"
fi

# === Test 4: STATUS liste tous les findings ===
N_STATUS=$(grep -cE "A\.[0-9]+" "$STATUS")
if [ "$N_STATUS" -ge "$N" ]; then
    pass "STATUS covers all $N findings"
else
    fail "STATUS only covers $N_STATUS findings"
fi

# === Test 5: STATUS a un résumé par statut ===
for status in "Fixed" "Warning" "To verify"; do
    if grep -q "$status" "$STATUS"; then
        pass "STATUS has '$status' section"
    else
        fail "STATUS missing '$status' section"
    fi
done

# === Test 6: STATUS mentionne les 3 audits source ===
for src in "AUDIT_REPORT" "SECURITY_AUDIT" "ANDROID_AUDIT"; do
    if grep -q "$src" "$STATUS"; then
        pass "STATUS mentions $src"
    else
        fail "STATUS missing $src mention"
    fi
done

# === Summary ===
echo
echo "=== Summary ==="
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${RED}FAIL${NC}: $FAIL"

if [ "$FAIL" -gt 0 ]; then
    exit 1
else
    echo -e "${GREEN}✅ All tests PASSED${NC}"
    exit 0
fi
