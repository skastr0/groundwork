// Positive fixture for research-incidents-close-contaminated-subagents.
// This file SHOULD trigger the rule because it references subagent spawning or
// dispatch without cleaning up stale/contaminated agents.
export function orchestrate(): void {
  subagent();
  spawnAgent();
  dispatchAgent();
}

function subagent(): void {}
function spawnAgent(): void {}
function dispatchAgent(): void {}
