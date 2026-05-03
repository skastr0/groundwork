import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUARD_CONFIG,
  evaluateBashCommand,
} from "../../groundwork/risk/index.ts";

describe("evaluateBashCommand", () => {
  const config = {
    ...DEFAULT_GUARD_CONFIG,
  };

  it("allows benign commands", () => {
    const result = evaluateBashCommand("echo hello", config);
    expect(result.violation).toBeNull();
  });

  it("blocks rm -rf", () => {
    const result = evaluateBashCommand("rm -rf ./src", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("blocks rm with split flags", () => {
    const result = evaluateBashCommand("rm -r -f ./tmp", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("blocks rm targeting home patterns", () => {
    const result = evaluateBashCommand("rm -rf ~", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force-root-home");
  });

  it("allows rm -rf under /tmp when configured", () => {
    const result = evaluateBashCommand("rm -rf /tmp/build-cache", {
      ...config,
      allowTempRecursiveForceRm: true,
    });
    expect(result.violation).toBeNull();
  });

  it("blocks rm -rf using unresolved TMPDIR variable", () => {
    const result = evaluateBashCommand("rm -rf $TMPDIR/project", {
      ...config,
      allowTempRecursiveForceRm: true,
    });
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("blocks wrapped rm -rf", () => {
    const result = evaluateBashCommand("sudo env PATH=/usr/bin rm -rf ./src", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("blocks git checkout -- path", () => {
    const result = evaluateBashCommand("git checkout -- package.json", config);
    expect(result.violation?.ruleId).toBe("git.checkout-discard");
  });

  it("blocks git checkout .", () => {
    const result = evaluateBashCommand("git checkout .", config);
    expect(result.violation?.ruleId).toBe("git.checkout-discard");
  });

  it("allows git checkout -b", () => {
    const result = evaluateBashCommand("git checkout -b feature/safe", config);
    expect(result.violation).toBeNull();
  });

  it("blocks git reset --hard", () => {
    const result = evaluateBashCommand("git reset --hard HEAD~1", config);
    expect(result.violation?.ruleId).toBe("git.reset-hard");
  });

  it("blocks git clean with force", () => {
    const result = evaluateBashCommand("git clean -fdx", config);
    expect(result.violation?.ruleId).toBe("git.clean-force");
  });

  it("allows git clean dry run", () => {
    const result = evaluateBashCommand("git clean -nfd", config);
    expect(result.violation).toBeNull();
  });

  it("blocks git restore path", () => {
    const result = evaluateBashCommand("git restore src/main.ts", config);
    expect(result.violation?.ruleId).toBe("git.restore-path");
  });

  it("allows git restore --staged", () => {
    const result = evaluateBashCommand("git restore --staged src/main.ts", config);
    expect(result.violation).toBeNull();
  });

  it("detects destructive command in chained shell", () => {
    const result = evaluateBashCommand("echo ok && rm -rf ./dist", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("detects destructive command through xargs wrapper", () => {
    const result = evaluateBashCommand("xargs rm -rf ./cache", config);
    expect(result.violation?.ruleId).toBe("rm.recursive-force");
  });

  it("detects destructive command in bash -c payload", () => {
    const result = evaluateBashCommand("bash -c 'git checkout -- README.md'", config);
    expect(result.violation?.ruleId).toBe("git.checkout-discard");
  });

  it("blocks docker system prune when extended rules are enabled", () => {
    const result = evaluateBashCommand("docker system prune -af", {
      ...config,
      includeExtendedRules: true,
    });
    expect(result.violation?.ruleId).toBe("docker.system-prune");
  });

  it("allows docker system prune when extended rules are disabled", () => {
    const result = evaluateBashCommand("docker system prune -af", {
      ...config,
      includeExtendedRules: false,
    });
    expect(result.violation).toBeNull();
  });

  it("blocks kubectl delete namespace", () => {
    const result = evaluateBashCommand("kubectl delete namespace production", config);
    expect(result.violation?.ruleId).toBe("kubectl.delete-namespace");
  });

  it("does not treat kubectl -a as kubectl -A", () => {
    const result = evaluateBashCommand("kubectl delete pod nginx -a", config);
    expect(result.violation).toBeNull();
  });
});
