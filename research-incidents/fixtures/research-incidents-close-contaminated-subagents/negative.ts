// Negative fixture for research-incidents-close-contaminated-subagents.
// This file should NOT trigger the rule: it is a plain synchronous worker with
// no subagent concepts.
export class Worker {
  async run(task: unknown): Promise<unknown> {
    return task;
  }
}
