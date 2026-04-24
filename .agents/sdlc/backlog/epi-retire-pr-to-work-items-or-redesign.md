# Retire or redesign pr_to_work_items

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-retire-pr-to-work-items-or-redesign

## Context

The old `pr_to_work_items` implementation generates simplistic SDLC files directly from PR comments. That is close to lifecycle work-item behavior and should not be copied as-is into EPI.

## Acceptance Criteria

- [ ] AC-1: Compare `pr_to_work_items` with current lifecycle-core work-item tools.
- [ ] AC-2: Decide whether EPI should emit structured findings only, leaving work-item creation to lifecycle tools.
- [ ] AC-3: If a bridge is needed, design it around generated lifecycle tools rather than direct file writes.
- [ ] AC-4: Old `pr_to_work_items` is retired unless a stronger canonical contract is documented.

## Notes

[2026-04-24]: Bias toward retirement. Direct file-writing work-item generation is the wrong shape unless redesigned.
[2026-04-24]: Rejected as-is during review-plugin cleanup. `pr_to_work_items` directly writes `.agents/sdlc/committed/` files from PR comments, which bypasses lifecycle work-item contracts and overlaps with SDLC tooling ownership. If needed later, EPI should emit structured PR review findings/provenance only; lifecycle-core should own any conversion into work items.
