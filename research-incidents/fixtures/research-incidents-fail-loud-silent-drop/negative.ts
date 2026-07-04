// Negative fixture for research-incidents-fail-loud-silent-drop.
// This file should NOT trigger the rule: errors are surfaced with a clear
// failure rather than being swallowed or silently dropped.
export function processJob(job: unknown): void {
  try {
    run(job);
  } catch (err) {
    throw new Error("job failed", { cause: err });
  }
}

function run(_job: unknown): void {
  throw new Error("fail");
}
