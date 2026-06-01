export const COST_ADR_PARAMETER_COUNT = 15;

export const DEFAULT_COEFFICIENTS = [
  -0.202, 9.14, -0.0978, 0.226, -5.31, -7.44, 24.1, -0.375, 1.81,
  -22.9, -5.82, 22.3, 1.72, -1.99, -19.4,
] as const;

export const S_MIN = 0.001;
export const S_MAX = 36500;
export const D_MIN = 1;
export const D_MAX = 10;
export const DEFAULT_FSRS_DECAY = 0.1542;

export interface CostAdrPolicy {
  coefficients: number[];
  costWeightMin: number;
  costWeightMax: number;
  retentionMin: number;
  retentionMax: number;
}

export interface SurfacePoint {
  stability: number;
  difficulty: number;
  retention: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export const DEFAULT_POLICY: CostAdrPolicy = {
  coefficients: [...DEFAULT_COEFFICIENTS],
  costWeightMin: 0,
  costWeightMax: 1024,
  retentionMin: 0.3,
  retentionMax: 0.995,
};

export function clonePolicy(policy: CostAdrPolicy): CostAdrPolicy {
  return {
    coefficients: [...policy.coefficients],
    costWeightMin: policy.costWeightMin,
    costWeightMax: policy.costWeightMax,
    retentionMin: policy.retentionMin,
    retentionMax: policy.retentionMax,
  };
}

export function validatePolicy(policy: CostAdrPolicy): ValidationResult {
  const errors: string[] = [];
  if (policy.coefficients.length !== COST_ADR_PARAMETER_COUNT) {
    errors.push(`coefficients must contain ${COST_ADR_PARAMETER_COUNT} numbers`);
  }
  if (policy.coefficients.some((value) => !Number.isFinite(value))) {
    errors.push("coefficients must all be finite numbers");
  }
  if (!Number.isFinite(policy.costWeightMin) || policy.costWeightMin < 0) {
    errors.push("cost_weight_min must be a finite number >= 0");
  }
  if (
    !Number.isFinite(policy.costWeightMax) ||
    policy.costWeightMax <= policy.costWeightMin
  ) {
    errors.push("cost_weight_max must be greater than cost_weight_min");
  }
  if (
    !Number.isFinite(policy.retentionMin) ||
    !(0 < policy.retentionMin && policy.retentionMin < 1)
  ) {
    errors.push("retention_min must be between 0 and 1");
  }
  if (
    !Number.isFinite(policy.retentionMax) ||
    !(policy.retentionMin < policy.retentionMax && policy.retentionMax < 1)
  ) {
    errors.push("retention_max must be greater than retention_min and below 1");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function evaluateRetention(
  policy: CostAdrPolicy,
  stability: number,
  difficulty: number,
  costWeight: number,
): number {
  const phi = stateFeatures(stability, difficulty);
  const z = normalizedCostWeight(policy, costWeight);
  const base = dot(policy.coefficients.slice(0, 5), phi);
  const zEffect = softplus(dot(policy.coefficients.slice(5, 10), phi)) * z;
  const z2Effect = softplus(dot(policy.coefficients.slice(10, 15), phi)) * z * z;
  return (
    policy.retentionMin +
    (policy.retentionMax - policy.retentionMin) *
      sigmoid(base - zEffect - z2Effect)
  );
}

export function nextInterval(
  stability: number,
  desiredRetention: number,
  fsrsDecay: number = DEFAULT_FSRS_DECAY,
): number {
  if (
    !Number.isFinite(stability) ||
    !Number.isFinite(desiredRetention) ||
    !Number.isFinite(fsrsDecay) ||
    stability <= 0 ||
    !(0 < desiredRetention && desiredRetention < 1) ||
    fsrsDecay <= 0
  ) {
    return Number.NaN;
  }
  const decay = -fsrsDecay;
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return (stability / factor) * (Math.pow(desiredRetention, 1 / decay) - 1);
}

export function policyToJson(policy: CostAdrPolicy): string {
  return JSON.stringify(
    {
      coefficients: policy.coefficients,
      cost_weight_min: policy.costWeightMin,
      cost_weight_max: policy.costWeightMax,
      retention_min: policy.retentionMin,
      retention_max: policy.retentionMax,
    },
    null,
    2,
  );
}

export function policyFromJson(text: string, fallback: CostAdrPolicy): CostAdrPolicy {
  const raw = JSON.parse(text) as unknown;
  if (Array.isArray(raw)) {
    return {
      ...clonePolicy(fallback),
      coefficients: raw.map(toNumber),
    };
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Policy JSON must be an object or a coefficient array");
  }

  const obj = raw as Record<string, unknown>;
  const coefficients = Array.isArray(obj.coefficients)
    ? obj.coefficients.map(toNumber)
    : [...fallback.coefficients];

  return {
    coefficients,
    costWeightMin: readNumber(obj, "costWeightMin", "cost_weight_min", fallback.costWeightMin),
    costWeightMax: readNumber(obj, "costWeightMax", "cost_weight_max", fallback.costWeightMax),
    retentionMin: readNumber(obj, "retentionMin", "retention_min", fallback.retentionMin),
    retentionMax: readNumber(obj, "retentionMax", "retention_max", fallback.retentionMax),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function stateFeatures(stability: number, difficulty: number): [number, number, number, number, number] {
  const clampedStability = clamp(stability, S_MIN, S_MAX);
  const clampedDifficulty = clamp(difficulty, D_MIN, D_MAX);
  const logSMin = Math.log(S_MIN);
  const logSSpan = Math.log(S_MAX) - logSMin;
  const xS = clamp((Math.log(clampedStability) - logSMin) / logSSpan, 0, 1);
  const xD = clamp((clampedDifficulty - D_MIN) / (D_MAX - D_MIN), 0, 1);
  return [1, xS, xD, xS * xD, xS * xS];
}

function normalizedCostWeight(policy: CostAdrPolicy, costWeight: number): number {
  const weight = clamp(costWeight, policy.costWeightMin, policy.costWeightMax);
  const lo = Math.log1p(policy.costWeightMin);
  const hi = Math.log1p(policy.costWeightMax);
  return clamp((Math.log1p(weight) - lo) / (hi - lo), 0, 1);
}

function dot(coefficients: number[], features: readonly number[]): number {
  return coefficients.reduce((sum, coefficient, index) => sum + coefficient * features[index], 0);
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function softplus(value: number): number {
  if (value > 20) return value;
  if (value < -20) return Math.exp(value);
  return Math.log1p(Math.exp(value));
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function readNumber(
  obj: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  fallback: number,
): number {
  if (camelKey in obj) return toNumber(obj[camelKey]);
  if (snakeKey in obj) return toNumber(obj[snakeKey]);
  return fallback;
}
