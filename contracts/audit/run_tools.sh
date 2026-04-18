#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./run-sol-audit.sh path/to/Contract.sol
#
# Output:
#   ./audit-out/<timestamp>/*

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/Contract.sol"
  exit 1
fi

TARGET="$1"
if [[ ! -f "$TARGET" ]]; then
  echo "File not found: $TARGET"
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUTDIR="audit-out/${TS}"
mkdir -p "$OUTDIR"

echo "Target:  $TARGET"
echo "Outdir:  $OUTDIR"
echo

run_tool () {
  local name="$1"
  shift
  local outfile="${OUTDIR}/${name}.txt"

  if command -v "${1}" >/dev/null 2>&1; then
    echo "==> Running: ${name}"
    # Run tool, capture stdout+stderr, don't stop whole script on tool failure
    set +e
    "$@" >"$outfile" 2>&1
    local code=$?
    set -e
    echo "Exit: $code" >>"$outfile"
    echo "OK (exit=$code): ${name} -> ${outfile}"
  else
    echo "SKIP: ${name} (missing binary: ${1})"
    echo "Missing binary: ${1}" >"$outfile"
  fi
}

# 1) solhint (file-level lint)
run_tool "solhint" solhint "$TARGET"

# 2) semgrep (Solidity rules; auto config)
# You can replace --config auto with your own ruleset.
run_tool "semgrep" semgrep --config auto "$TARGET"

# 3) mythril (file-level analysis)
# --solv and import resolution can be tricky; this is the simplest run.
run_tool "mythril" myth analyze "$TARGET" --execution-timeout 120

# 4) slither (project-level best; tries running from repo root ".")
# If your repo uses Hardhat/Foundry, Slither may need extra flags.
# This runs on current directory and points at a compilation unit by default.
run_tool "slither" slither .

# 5) aderyn (project-level analyzer)
# Runs from project root; results depend on project structure.
run_tool "aderyn" aderyn .

echo
echo "=== Summary (files with potential findings) ==="
# Heuristic: show lines that often indicate findings; not guaranteed.
grep -RIn --color=never -E "warning|error|critical|high|medium|low|issue|vulnerability|reentranc|unchecked|overflow|underflow" "$OUTDIR" \
  | sed -e "s|^${OUTDIR}/||" \
  | head -n 200 || true

echo
echo "Done. Full outputs in: $OUTDIR"