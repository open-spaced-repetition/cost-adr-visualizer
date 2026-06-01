<template>
  <label class="slider">
    <span class="slider-name">{{ info.name }}</span>
    <input
      class="slider-number"
      type="number"
      autocomplete="off"
      :step="info.step"
      :min="info.min"
      :max="info.max"
      v-model.number="model"
    />
    <span class="slider-range-container">
      <span class="minmax minmax-right">{{ formatBound(info.min) }}</span>
      <input
        class="slider-range-input"
        type="range"
        autocomplete="off"
        :step="info.step"
        :min="info.min"
        :max="info.max"
        v-model.number="model"
      />
      <span class="minmax">{{ formatBound(info.max) }}</span>
    </span>
  </label>
</template>

<script lang="ts" setup>
import type { SliderInfo } from "./sliderInfo";

defineProps<{
  info: SliderInfo;
}>();

const model = defineModel<number>({ required: true });

function formatBound(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toString();
}
</script>

<style scoped src="./assets/slider.css"></style>
