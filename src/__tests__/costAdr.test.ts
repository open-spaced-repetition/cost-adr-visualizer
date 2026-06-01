import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  clonePolicy,
  evaluateRetention,
  nextInterval,
  policyFromJson,
  validatePolicy,
} from "../costAdr";

describe("Cost ADR policy", () => {
  it("keeps default retention inside the configured range", () => {
    const retention = evaluateRetention(DEFAULT_POLICY, 10, 5, 64);
    expect(retention).toBeGreaterThanOrEqual(DEFAULT_POLICY.retentionMin);
    expect(retention).toBeLessThanOrEqual(DEFAULT_POLICY.retentionMax);
  });

  it("lowers default retention as cost weight increases", () => {
    const lowCost = evaluateRetention(DEFAULT_POLICY, 10, 5, 0);
    const highCost = evaluateRetention(DEFAULT_POLICY, 10, 5, 1024);
    expect(lowCost).toBeGreaterThan(highCost);
  });

  it("accepts fsrs-rs snake_case policy JSON", () => {
    const parsed = policyFromJson(
      JSON.stringify({
        coefficients: Array.from({ length: 15 }, (_, index) => index),
        cost_weight_min: 1,
        cost_weight_max: 99,
        retention_min: 0.4,
        retention_max: 0.9,
        max_interval_days: 365,
      }),
      DEFAULT_POLICY,
    );

    expect(validatePolicy(parsed).valid).toBe(true);
    expect(parsed.coefficients[14]).toBe(14);
    expect(parsed.costWeightMin).toBe(1);
    expect(parsed.costWeightMax).toBe(99);
    expect(parsed.retentionMin).toBe(0.4);
    expect(parsed.retentionMax).toBe(0.9);
  });

  it("rejects malformed policies", () => {
    const policy = clonePolicy(DEFAULT_POLICY);
    policy.coefficients = [1, 2, 3];
    policy.retentionMin = 0.9;
    policy.retentionMax = 0.8;

    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("calculates FSRS interval from stability, retention, and decay", () => {
    expect(nextInterval(10, 0.9, 0.1542)).toBeCloseTo(10, 4);
    expect(nextInterval(10, 0.8, 0.1542)).toBeGreaterThan(10);
    expect(Number.isNaN(nextInterval(10, 0.9, 0))).toBe(true);
  });
});
