#!/usr/bin/env bash
# Negative fixture for research-incidents-atomic-commits.
# This script should NOT trigger the rule: it commits specific, related files only.
set -euo pipefail

git add src/parser.ts src/parser.test.ts
git commit -m "fix(parser): handle empty input"
