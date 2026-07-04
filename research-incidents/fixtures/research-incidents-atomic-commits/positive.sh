#!/usr/bin/env bash
# Positive fixture for research-incidents-atomic-commits.
# This script SHOULD trigger the rule because it batches unrelated changes with
# `git commit -a` rather than committing atomically.
set -euo pipefail

git add .
git commit -a -m "batch all changes"
git commit -am "also batch"
git commit *
