<template>
  <div ref="containerEl" class="surface-plot">
    <svg
      ref="svgEl"
      class="surface-svg"
      role="img"
      aria-label="Adaptive Desired Retention distribution surface"
      @mousemove="handleMouseMove"
      @mouseleave="hideTooltip"
    ></svg>
    <div
      v-if="tooltip.visible"
      class="tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <div>Stability: {{ tooltip.stability }}</div>
      <div>Difficulty: {{ tooltip.difficulty }}</div>
      <div>DR: {{ tooltip.retention }}</div>
      <div>Interval: {{ tooltip.interval }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import * as d3 from "d3";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  D_MAX,
  D_MIN,
  type CostAdrPolicy,
  evaluateRetention,
  nextInterval,
  validatePolicy,
} from "./costAdr";

const props = defineProps<{
  policy: CostAdrPolicy;
  costWeight: number;
  fsrsDecay: number;
}>();

interface ProjectedPoint {
  x: number;
  y: number;
}

interface PlotPoint extends ProjectedPoint {
  stability: number;
  difficulty: number;
  retention: number;
  xNorm: number;
  yNorm: number;
  zNorm: number;
}

interface ContourSegment {
  start: ProjectedPoint;
  end: ProjectedPoint;
  depth: number;
  level: number;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  stability: string;
  difficulty: string;
  retention: string;
  interval: string;
}

const containerEl = ref<HTMLDivElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const plotWidth = ref(0);
const plotHeight = ref(0);
const tooltip = ref<TooltipState>({
  visible: false,
  x: 0,
  y: 0,
  stability: "",
  difficulty: "",
  retention: "",
  interval: "",
});

let resizeObserver: ResizeObserver | null = null;
let hoverPoints: PlotPoint[] = [];
let delaunay: d3.Delaunay<PlotPoint> | null = null;

const policySignature = computed(() =>
  [
    props.policy.coefficients.join(","),
    props.policy.costWeightMin,
    props.policy.costWeightMax,
    props.policy.retentionMin,
    props.policy.retentionMax,
    props.costWeight,
    props.fsrsDecay,
  ].join("|"),
);

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    plotWidth.value = entry.contentRect.width;
    plotHeight.value = entry.contentRect.height;
  });
  if (containerEl.value) {
    resizeObserver.observe(containerEl.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

watch([policySignature, plotWidth, plotHeight], () => {
  void nextTick(draw);
});

function draw(): void {
  if (!svgEl.value || plotWidth.value < 320 || plotHeight.value < 260) return;

  const width = plotWidth.value;
  const height = plotHeight.value;
  const validation = validatePolicy(props.policy);
  const svg = d3.select(svgEl.value);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  hoverPoints = [];
  delaunay = null;

  if (!validation.valid) {
    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#d7dde5")
      .attr("font-size", 16)
      .text("Fix policy inputs to render the DR surface.");
    return;
  }

  const project = createProjection(width, height);
  const columns = 61;
  const rows = 61;
  const stabilityLogMin = -1;
  const stabilityLogMax = 3;
  const stabilityLogSpan = stabilityLogMax - stabilityLogMin;
  const retentionSpan = props.policy.retentionMax - props.policy.retentionMin;
  const grid: PlotPoint[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const yNorm = row / (rows - 1);
    const difficulty = D_MAX - yNorm * (D_MAX - D_MIN);
    const line: PlotPoint[] = [];
    for (let column = 0; column < columns; column += 1) {
      const xNorm = column / (columns - 1);
      const stability = 10 ** (stabilityLogMin + xNorm * stabilityLogSpan);
      const retention = evaluateRetention(props.policy, stability, difficulty, props.costWeight);
      const zNorm = (retention - props.policy.retentionMin) / retentionSpan;
      const projected = project(xNorm, yNorm, zNorm);
      const point = {
        ...projected,
        stability,
        difficulty,
        retention,
        xNorm,
        yNorm,
        zNorm,
      };
      line.push(point);
      hoverPoints.push(point);
    }
    grid.push(line);
  }

  delaunay = d3.Delaunay.from(
    hoverPoints,
    (point) => point.x,
    (point) => point.y,
  );

  drawSurface(svg, grid);
  drawGrid(svg, grid);
  drawContours(svg, grid, project);
  drawAxes(svg, project, props.policy);
  drawLegend(svg, width, props.policy);
}

function drawSurface(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  grid: PlotPoint[][],
): void {
  const cells = [];
  for (let row = 0; row < grid.length - 1; row += 1) {
    for (let column = 0; column < grid[row].length - 1; column += 1) {
      const points = [
        grid[row][column],
        grid[row][column + 1],
        grid[row + 1][column + 1],
        grid[row + 1][column],
      ];
      cells.push({
        points,
        depth: row + column,
        zNorm: d3.mean(points, (point) => point.zNorm) ?? 0,
      });
    }
  }

  svg
    .append("g")
    .attr("class", "surface-cells")
    .selectAll("polygon")
    .data(cells.sort((left, right) => left.depth - right.depth))
    .join("polygon")
    .attr("points", (cell) => cell.points.map((point) => `${point.x},${point.y}`).join(" "))
    .attr("fill", (cell) => d3.interpolateViridis(cell.zNorm))
    .attr("stroke", "rgba(0, 0, 0, 0.16)")
    .attr("stroke-width", 0.45)
    .attr("shape-rendering", "geometricPrecision");
}

function drawGrid(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  grid: PlotPoint[][],
): void {
  const lines: PlotPoint[][] = [];
  for (let row = 0; row < grid.length; row += 5) lines.push(grid[row]);
  for (let column = 0; column < grid[0].length; column += 5) {
    lines.push(grid.map((row) => row[column]));
  }

  svg
    .append("g")
    .attr("class", "surface-grid")
    .selectAll("path")
    .data(lines)
    .join("path")
    .attr("d", (line) => linePath(line))
    .attr("fill", "none")
    .attr("stroke", "rgba(12, 38, 42, 0.35)")
    .attr("stroke-width", 0.7);
}

function drawContours(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  grid: PlotPoint[][],
  project: (x: number, y: number, z: number) => ProjectedPoint,
): void {
  const segments = contourSegments(grid, contourLevels(), project);

  svg
    .append("g")
    .attr("class", "surface-contours")
    .selectAll("line")
    .data(segments)
    .join("line")
    .attr("class", "dr-contour")
    .attr("x1", (segment) => segment.start.x)
    .attr("y1", (segment) => segment.start.y)
    .attr("x2", (segment) => segment.end.x)
    .attr("y2", (segment) => segment.end.y)
    .attr("stroke", "rgba(255, 255, 255, 0.82)")
    .attr("stroke-dasharray", "7 5")
    .attr("stroke-linecap", "round")
    .attr("stroke-width", 1.6);
}

function drawAxes(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  project: (x: number, y: number, z: number) => ProjectedPoint,
  policy: CostAdrPolicy,
): void {
  const axis = svg.append("g").attr("class", "axes");
  const origin = project(0, 0, 0);
  drawAxisLine(axis, origin, project(1.05, 0, 0));
  drawAxisLine(axis, origin, project(0, 1.05, 0));
  drawAxisLine(axis, origin, project(0, 0, 1.08));

  for (const stability of [0.1, 1, 10, 100, 1000]) {
    const xNorm = (Math.log10(stability) + 1) / 4;
    const point = project(xNorm, 0, 0);
    const atOrigin = stability === 0.1;
    drawTick(
      axis,
      point,
      formatStabilityTick(stability),
      atOrigin ? "end" : "middle",
      atOrigin ? -4 : 0,
      atOrigin ? 28 : 20,
    );
  }

  for (const difficulty of [1, 5, 10]) {
    const yNorm = (D_MAX - difficulty) / (D_MAX - D_MIN);
    const point = project(0, yNorm, 0);
    drawTick(axis, point, difficulty.toString(), "start", 12, -8);
  }

  for (const retention of [
    policy.retentionMin,
    (policy.retentionMin + policy.retentionMax) / 2,
    policy.retentionMax,
  ]) {
    const zNorm = (retention - policy.retentionMin) / (policy.retentionMax - policy.retentionMin);
    const point = project(0, 0, zNorm);
    drawTick(axis, point, formatPercent(retention), "end", -58);
  }

  drawAxisLabel(axis, project(1.1, 0, 0), "S");
  drawAxisLabel(axis, project(0, 1.1, 0), "D");
  drawAxisLabel(axis, project(0, 0, 1.15), "DR");
}

function drawLegend(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  width: number,
  policy: CostAdrPolicy,
): void {
  const legendWidth = Math.min(360, Math.max(220, width * 0.24));
  const legendHeight = 18;
  const x = width - legendWidth - 34;
  const y = 48;
  const gradientId = "adr-retention-gradient";
  const defs = svg.append("defs");
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.001, 0.1).forEach((stop) => {
    gradient
      .append("stop")
      .attr("offset", `${stop * 100}%`)
      .attr("stop-color", d3.interpolateViridis(stop));
  });

  const legend = svg.append("g").attr("class", "legend");
  legend
    .append("rect")
    .attr("x", x)
    .attr("y", y)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", `url(#${gradientId})`);
  legend
    .append("text")
    .attr("x", x)
    .attr("y", y - 10)
    .attr("fill", "#eef4f8")
    .attr("font-size", 13)
    .attr("font-weight", 650)
    .text(formatPercent(policy.retentionMin));
  legend
    .append("text")
    .attr("x", x + legendWidth)
    .attr("y", y - 10)
    .attr("fill", "#eef4f8")
    .attr("font-size", 13)
    .attr("font-weight", 650)
    .attr("text-anchor", "end")
    .text(formatPercent(policy.retentionMax));
}

function handleMouseMove(event: MouseEvent): void {
  if (!svgEl.value || !delaunay || hoverPoints.length === 0) return;
  const rect = svgEl.value.getBoundingClientRect();
  const viewX = ((event.clientX - rect.left) / rect.width) * plotWidth.value;
  const viewY = ((event.clientY - rect.top) / rect.height) * plotHeight.value;
  const index = delaunay.find(viewX, viewY);
  const point = hoverPoints[index];
  const distance = Math.hypot(point.x - viewX, point.y - viewY);
  if (distance > 70) {
    hideTooltip();
    return;
  }

  tooltip.value = {
    visible: true,
    x: event.clientX - rect.left + 14,
    y: event.clientY - rect.top + 14,
    stability: `${formatNumber(point.stability)} d`,
    difficulty: `${point.difficulty.toFixed(2)} / 10`,
    retention: formatPercent(point.retention),
    interval: formatInterval(nextInterval(point.stability, point.retention, props.fsrsDecay)),
  };
}

function hideTooltip(): void {
  tooltip.value.visible = false;
}

function createProjection(width: number, height: number) {
  const scale = Math.min(width * 0.62, height * 0.68);
  const origin = {
    x: width * 0.16,
    y: height * 0.62,
  };
  const sAxis = {
    x: scale * 0.55,
    y: scale * 0.42,
  };
  const dAxis = {
    x: scale * 0.88,
    y: -scale * 0.28,
  };
  const drAxis = {
    x: 0,
    y: -scale * 0.72,
  };

  return (x: number, y: number, z: number): ProjectedPoint => ({
    x: origin.x + x * sAxis.x + y * dAxis.x + z * drAxis.x,
    y: origin.y + x * sAxis.y + y * dAxis.y + z * drAxis.y,
  });
}

function linePath(points: ProjectedPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

function contourLevels(): number[] {
  const first = Math.ceil((props.policy.retentionMin + 0.000001) * 10) / 10;
  const last = Math.floor((props.policy.retentionMax - 0.000001) * 10) / 10;
  return d3.range(first, last + 0.001, 0.1);
}

function contourSegments(
  grid: PlotPoint[][],
  levels: number[],
  project: (x: number, y: number, z: number) => ProjectedPoint,
): ContourSegment[] {
  const segments: ContourSegment[] = [];
  for (let row = 0; row < grid.length - 1; row += 1) {
    for (let column = 0; column < grid[row].length - 1; column += 1) {
      const corners = [
        grid[row][column],
        grid[row][column + 1],
        grid[row + 1][column + 1],
        grid[row + 1][column],
      ];
      for (const level of levels) {
        const intersections = contourIntersections(corners, level);
        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const start = project(intersections[index].xNorm, intersections[index].yNorm, intersections[index].zNorm);
          const end = project(
            intersections[index + 1].xNorm,
            intersections[index + 1].yNorm,
            intersections[index + 1].zNorm,
          );
          segments.push({
            start,
            end,
            depth:
              intersections[index].xNorm +
              intersections[index].yNorm +
              intersections[index + 1].xNorm +
              intersections[index + 1].yNorm,
            level,
          });
        }
      }
    }
  }
  return segments.sort((left, right) => left.depth - right.depth);
}

function contourIntersections(corners: PlotPoint[], level: number): PlotPoint[] {
  const intersections: PlotPoint[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    if ((level - start.retention) * (level - end.retention) > 0 || start.retention === end.retention) {
      continue;
    }
    const t = (level - start.retention) / (end.retention - start.retention);
    if (t < 0 || t > 1) continue;
    intersections.push(interpolatePoint(start, end, t, level));
  }
  return uniquePoints(intersections);
}

function interpolatePoint(start: PlotPoint, end: PlotPoint, t: number, retention: number): PlotPoint {
  const xNorm = start.xNorm + (end.xNorm - start.xNorm) * t;
  const yNorm = start.yNorm + (end.yNorm - start.yNorm) * t;
  const zNorm = start.zNorm + (end.zNorm - start.zNorm) * t;
  const projected = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
  return {
    ...projected,
    xNorm,
    yNorm,
    zNorm,
    stability: start.stability + (end.stability - start.stability) * t,
    difficulty: start.difficulty + (end.difficulty - start.difficulty) * t,
    retention,
  };
}

function uniquePoints(points: PlotPoint[]): PlotPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.xNorm.toFixed(5)},${point.yNorm.toFixed(5)},${point.zNorm.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function drawAxisLine(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  start: ProjectedPoint,
  end: ProjectedPoint,
): void {
  group
    .append("line")
    .attr("x1", start.x)
    .attr("y1", start.y)
    .attr("x2", end.x)
    .attr("y2", end.y)
    .attr("stroke", "rgba(255, 255, 255, 0.9)")
    .attr("stroke-width", 2);
}

function drawTick(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  point: ProjectedPoint,
  label: string,
  anchor: "start" | "middle" | "end" = "middle",
  dx = 0,
  dy = 20,
): void {
  group
    .append("text")
    .attr("x", point.x + dx)
    .attr("y", point.y + dy)
    .attr("fill", "#f1f5f9")
    .attr("font-size", 13)
    .attr("font-weight", 650)
    .attr("text-anchor", anchor)
    .text(label);
}

function drawAxisLabel(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  point: ProjectedPoint,
  label: string,
): void {
  group
    .append("text")
    .attr("x", point.x)
    .attr("y", point.y)
    .attr("fill", "#ffffff")
    .attr("font-size", 16)
    .attr("font-weight", 750)
    .attr("text-anchor", "middle")
    .text(label);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatInterval(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 365) return `${(value / 365).toFixed(1)} yr`;
  if (value >= 100) return `${value.toFixed(0)} d`;
  if (value >= 10) return `${value.toFixed(1)} d`;
  return `${value.toFixed(2)} d`;
}

function formatStabilityTick(value: number): string {
  return value < 1 ? value.toFixed(1) : value.toFixed(0);
}
</script>

<style scoped>
.surface-plot {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  border: 1px solid #343b44;
  border-radius: 8px;
  background: #252628;
}

.surface-svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.tooltip {
  position: absolute;
  z-index: 4;
  min-width: 13rem;
  padding: 0.7rem 0.85rem;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
  background: rgba(8, 10, 12, 0.78);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
  color: #f5f7fa;
  font-weight: 650;
}

@media (max-width: 760px) {
  .surface-plot {
    min-height: 440px;
  }
}
</style>
