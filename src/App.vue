<template>
  <main class="app-shell">
    <section class="topbar">
      <div class="title-block">
        <h1>Cost ADR Policy Visualizer</h1>
        <div class="subtitle">Adaptive Desired Retention from stability, difficulty, and cost weight</div>
      </div>
      <div class="cost-control">
        <Slider :info="costWeightSlider" v-model="costWeight" />
        <output class="cost-value">Weight: {{ costWeight.toFixed(2) }}</output>
      </div>
    </section>

    <section class="workspace">
      <SurfacePlot :policy="policy" :cost-weight="costWeight" :fsrs-decay="fsrsDecay" />
      <aside class="controls">
        <section class="panel">
          <div class="panel-header">
            <h2>Policy JSON</h2>
            <div class="button-row">
              <button type="button" @click="applyJson">Apply JSON</button>
              <button type="button" @click="resetPolicy">Reset</button>
            </div>
          </div>
          <textarea
            v-model="policyJson"
            class="policy-json"
            spellcheck="false"
            aria-label="Cost ADR policy JSON"
          ></textarea>
          <div v-if="jsonError" class="error-message">{{ jsonError }}</div>
        </section>

        <section class="panel">
          <h2>Bounds</h2>
          <div class="bounds-grid">
            <label>
              cost min
              <input type="number" step="1" min="0" v-model.number="policy.costWeightMin" />
            </label>
            <label>
              cost max
              <input type="number" step="1" min="0" v-model.number="policy.costWeightMax" />
            </label>
            <label>
              DR min
              <input type="number" step="0.001" min="0.001" max="0.999" v-model.number="policy.retentionMin" />
            </label>
            <label>
              DR max
              <input type="number" step="0.001" min="0.001" max="0.999" v-model.number="policy.retentionMax" />
            </label>
            <label>
              FSRS decay / w[20]
              <input type="number" step="0.0001" min="0.0001" v-model.number="fsrsDecay" />
            </label>
          </div>
          <div v-if="fsrsDecayError" class="error-list">{{ fsrsDecayError }}</div>
          <div v-if="validation.errors.length" class="error-list">
            <div v-for="error in validation.errors" :key="error">{{ error }}</div>
          </div>
        </section>

        <section class="panel coefficients-panel">
          <h2>Coefficients</h2>
          <Slider
            v-for="info in coefficientSliders"
            :key="info.index"
            :info="info"
            v-model="policy.coefficients[info.index]"
          />
        </section>
      </aside>
    </section>
  </main>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";

import Slider from "./Slider.vue";
import SurfacePlot from "./SurfacePlot.vue";
import {
  DEFAULT_POLICY,
  DEFAULT_FSRS_DECAY,
  type CostAdrPolicy,
  clamp,
  clonePolicy,
  policyFromJson,
  policyToJson,
  validatePolicy,
} from "./costAdr";
import type { SliderInfo } from "./sliderInfo";

interface CoefficientSliderInfo extends SliderInfo {
  index: number;
}

const initialState = readStateFromUrl();
const policy = ref<CostAdrPolicy>(initialState.policy);
const costWeight = ref(initialState.costWeight);
const fsrsDecay = ref(initialState.fsrsDecay);
const policyJson = ref(policyToJson(policy.value));
const jsonError = ref("");

const coefficientSliders: CoefficientSliderInfo[] = Array.from({ length: 15 }, (_, index) => ({
  index,
  name: `c${index}`,
  min: -64,
  max: 64,
  step: 0.0001,
}));

const validation = computed(() => validatePolicy(policy.value));
const fsrsDecayError = computed(() =>
  Number.isFinite(fsrsDecay.value) && fsrsDecay.value > 0
    ? ""
    : "FSRS decay / w[20] must be greater than 0",
);

const costWeightSlider = computed<SliderInfo>(() => {
  const validRange = policy.value.costWeightMax > policy.value.costWeightMin;
  const min = validRange ? policy.value.costWeightMin : DEFAULT_POLICY.costWeightMin;
  const max = validRange ? policy.value.costWeightMax : DEFAULT_POLICY.costWeightMax;
  return {
    name: "cost weight",
    min,
    max,
    step: Math.max((max - min) / 1024, 0.01),
  };
});

watch(
  policy,
  () => {
    const validRange = policy.value.costWeightMax > policy.value.costWeightMin;
    if (validRange) {
      costWeight.value = clamp(costWeight.value, policy.value.costWeightMin, policy.value.costWeightMax);
    }
    policyJson.value = policyToJson(policy.value);
    writeStateToUrl(policy.value, costWeight.value, fsrsDecay.value);
  },
  { deep: true },
);

watch(costWeight, (value) => {
  if (policy.value.costWeightMax > policy.value.costWeightMin) {
    costWeight.value = clamp(value, policy.value.costWeightMin, policy.value.costWeightMax);
  }
  writeStateToUrl(policy.value, costWeight.value, fsrsDecay.value);
});

watch(fsrsDecay, () => {
  writeStateToUrl(policy.value, costWeight.value, fsrsDecay.value);
});

function applyJson(): void {
  jsonError.value = "";
  try {
    const parsed = policyFromJson(policyJson.value, policy.value);
    const result = validatePolicy(parsed);
    if (!result.valid) {
      jsonError.value = result.errors.join("; ");
      return;
    }
    policy.value = parsed;
    costWeight.value = clamp(costWeight.value, parsed.costWeightMin, parsed.costWeightMax);
    policyJson.value = policyToJson(parsed);
    writeStateToUrl(parsed, costWeight.value, fsrsDecay.value);
  } catch (error) {
    jsonError.value = error instanceof Error ? error.message : "Invalid policy JSON";
  }
}

function resetPolicy(): void {
  policy.value = clonePolicy(DEFAULT_POLICY);
  costWeight.value = 64;
  fsrsDecay.value = DEFAULT_FSRS_DECAY;
  jsonError.value = "";
  policyJson.value = policyToJson(policy.value);
  writeStateToUrl(policy.value, costWeight.value, fsrsDecay.value);
}

function readStateFromUrl(): { policy: CostAdrPolicy; costWeight: number; fsrsDecay: number } {
  const params = new URLSearchParams(window.location.search);
  const nextPolicy = clonePolicy(DEFAULT_POLICY);
  const coefficientText = params.get("c");
  if (coefficientText) {
    const values = parseNumberList(coefficientText);
    if (values.length === 15 && values.every(Number.isFinite)) {
      nextPolicy.coefficients = values;
    }
  }

  nextPolicy.costWeightMin = parseQueryNumber(params, "cwmin", nextPolicy.costWeightMin);
  nextPolicy.costWeightMax = parseQueryNumber(params, "cwmax", nextPolicy.costWeightMax);
  nextPolicy.retentionMin = parseQueryNumber(params, "rmin", nextPolicy.retentionMin);
  nextPolicy.retentionMax = parseQueryNumber(params, "rmax", nextPolicy.retentionMax);

  const result = validatePolicy(nextPolicy);
  const safePolicy = result.valid ? nextPolicy : clonePolicy(DEFAULT_POLICY);
  const costWeight = clamp(
    parseQueryNumber(params, "cw", 64),
    safePolicy.costWeightMin,
    safePolicy.costWeightMax,
  );
  const fsrsDecay = parsePositiveQueryNumber(params, "decay", DEFAULT_FSRS_DECAY);
  return { policy: safePolicy, costWeight, fsrsDecay };
}

function writeStateToUrl(nextPolicy: CostAdrPolicy, nextCostWeight: number, nextFsrsDecay: number): void {
  const result = validatePolicy(nextPolicy);
  if (!result.valid || !Number.isFinite(nextFsrsDecay) || nextFsrsDecay <= 0) return;

  const params = new URLSearchParams();
  params.set("c", nextPolicy.coefficients.map((value) => formatQueryNumber(value, 4)).join(","));
  params.set("cw", formatQueryNumber(nextCostWeight, 4));
  params.set("cwmin", formatQueryNumber(nextPolicy.costWeightMin, 4));
  params.set("cwmax", formatQueryNumber(nextPolicy.costWeightMax, 4));
  params.set("rmin", formatQueryNumber(nextPolicy.retentionMin, 4));
  params.set("rmax", formatQueryNumber(nextPolicy.retentionMax, 4));
  params.set("decay", formatQueryNumber(nextFsrsDecay, 4));
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function parseNumberList(text: string): number[] {
  return text.split(",").map((value) => Number(value.trim()));
}

function parseQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parsePositiveQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
  const value = parseQueryNumber(params, key, fallback);
  return value > 0 ? value : fallback;
}

function formatQueryNumber(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  min-height: 100vh;
  padding: 1rem;
}

.topbar {
  display: grid;
  grid-template-columns: minmax(18rem, 1fr) minmax(28rem, 0.9fr);
  align-items: end;
  gap: 1rem;
}

.title-block {
  min-width: 0;
}

h1,
h2 {
  margin: 0;
  letter-spacing: 0;
}

h1 {
  font-size: 1.8rem;
  line-height: 1.1;
}

h2 {
  font-size: 0.95rem;
}

.subtitle {
  margin-top: 0.25rem;
  color: #a6b0ba;
  font-size: 0.92rem;
}

.cost-control {
  display: grid;
  gap: 0.45rem;
}

.cost-value {
  justify-self: end;
  color: #eaf1f8;
  font-weight: 750;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(24rem, 31rem);
  gap: 1rem;
  flex: 1;
  min-height: 0;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.panel {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid #343b44;
  border-radius: 8px;
  background: rgba(29, 33, 39, 0.82);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.policy-json {
  width: 100%;
  min-height: 10rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.35;
}

.bounds-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.bounds-grid label {
  display: grid;
  gap: 0.25rem;
  color: #aab4bd;
  font-size: 0.78rem;
}

.coefficients-panel {
  max-height: 42vh;
  overflow: auto;
}

.error-message,
.error-list {
  color: #ffb4a8;
  font-size: 0.82rem;
}

@media (max-width: 1180px) {
  .workspace,
  .topbar {
    grid-template-columns: 1fr;
  }

  .controls {
    order: 2;
  }
}

@media (max-width: 760px) {
  .app-shell {
    padding: 0.7rem;
  }

  .bounds-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 1.45rem;
  }
}
</style>
