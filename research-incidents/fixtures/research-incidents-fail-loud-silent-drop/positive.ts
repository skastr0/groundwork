// Positive fixture for research-incidents-fail-loud-silent-drop.
// This file SHOULD trigger the rule because it silently drops an error path
// instead of failing loudly.
export function processJob(job: unknown): boolean {
  try {
    run(job);
    return true;
  } catch (err) {
    swallow(err);
    silent();
    acknowledge();
    return true;
  }
}

function run(_job: unknown): void {
  throw new Error("fail");
}
function swallow(_err: unknown): void {}
function silent(): void {}
function acknowledge(): void {}
