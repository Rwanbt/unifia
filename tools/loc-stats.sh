#!/usr/bin/env bash
# loc-stats.sh — Calcule les stats LOC par section
# Usage: bash tools/loc-stats.sh [--format text|json]

set -uo pipefail

FORMAT="text"
[ "${1:-}" = "--format" ] && FORMAT="${2:-text}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

declare -A stats

# Count LOC by extension
for ext in ts tsx js jsx mjs cjs jsonc json yml yaml md mdx sh bash py rs; do
    count=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./.unifia-brand-backup -prune -o -name "*.${ext}" -type f -print 2>/dev/null | xargs cat 2>/dev/null | wc -l | awk '{print $1}')
    stats[$ext]=$count
done

# Count by directory
for dir in docs packages scripts tests tools capability-packs; do
    if [ -d "$dir" ]; then
        count=$(find "$dir" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -exec cat {} \; 2>/dev/null | wc -l)
        stats["dir:$dir"]=$count
    fi
done

total=0
for key in "${!stats[@]}"; do
    total=$((total + ${stats[$key]}))
done

if [ "$FORMAT" = "json" ]; then
    echo "{"
    first=true
    for key in "${!stats[@]}"; do
        if [ "$first" = true ]; then first=false; else echo ","; fi
        echo "  "${key}": ${stats[$key]}"
    done | sort
    echo ","total": $total}"
else
    echo "================================================="
    echo "  Unifia LOC Stats"
    echo "================================================="
    echo
    echo "By extension:"
    for ext in ts tsx js jsx mjs cjs jsonc json yml yaml md mdx sh bash py rs; do
        if [ -n "${stats[$ext]:-}" ] && [ "${stats[$ext]}" -gt 0 ]; then
            printf "  %-8s %d\n" ".$ext" "${stats[$ext]}"
        fi
    done
    echo
    echo "By directory:"
    for dir in docs packages scripts tests tools capability-packs; do
        if [ -n "${stats[dir:$dir]:-}" ] && [ "${stats[dir:$dir]}" -gt 0 ]; then
            printf "  %-20s %d\n" "$dir/" "${stats[dir:$dir]}"
        fi
    done
    echo
    printf "  %-20s %d\n" "TOTAL" "$total"
fi
