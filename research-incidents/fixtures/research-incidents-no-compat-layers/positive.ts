// Positive fixture for research-incidents-no-compat-layers.
// This file SHOULD trigger the rule because it introduces backward-compatibility,
// legacy paths, migration code, and transition layers during consolidation.
export function backwardsCompatMigrationLayer(): void {
  compat();
  legacy();
  migration();
  transition();
  backwards();
}

function compat(): void {}
function legacy(): void {}
function migration(): void {}
function transition(): void {}
function backwards(): void {}
