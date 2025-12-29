<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    errors?: number[] | null
    stamina?: number[] | null
  }>(),
  {
    errors: null,
    stamina: null
  }
)

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const derivedErrors = computed(() => {
  const raw = (props.errors || []).filter((v) => Number.isFinite(v))
  if (raw.length) return raw

  // Fallback: derive a pseudo-offset distribution from click-interval jitter.
  const intervals = (props.stamina || []).filter((v) => Number.isFinite(v)).slice(0, 800)
  if (!intervals.length) return [] as number[]

  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length
  const variance = intervals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / intervals.length
  const std = Math.sqrt(Math.max(variance, 1))

  // Map interval deviation into a roughly [-50, +50] ms visual range.
  return intervals.map((dt) => clamp(((dt - mean) / std) * 12, -50, 50))
})

type Bin = { x0: number; x1: number; count: number; side: 'early' | 'late' | 'center' }

const bins = computed(() => {
  const values = derivedErrors.value
  if (!values.length) return [] as Bin[]

  const min = -50
  const max = 50
  const binCount = 40
  const width = (max - min) / binCount
  const counts = Array.from({ length: binCount }, () => 0)

  for (const v of values) {
    const clamped = clamp(v, min, max - 1e-6)
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((clamped - min) / width)))
    counts[idx] = (counts[idx] ?? 0) + 1
  }

  const maxCount = Math.max(1, ...counts)
  return counts.map((c, i) => {
    const x0 = min + i * width
    const x1 = min + (i + 1) * width
    const mid = (x0 + x1) / 2
    const side: Bin['side'] = Math.abs(mid) < width ? 'center' : mid < 0 ? 'early' : 'late'
    return { x0, x1, count: Math.round((c / maxCount) * 100), side }
  })
})
</script>

<template>
  <div class="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
    <div class="mb-2 flex items-center justify-between gap-4">
      <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Hit Error Distribution</p>
      <p class="text-[11px] text-zinc-500">
        <span v-if="(errors || []).length">From replay (hit errors)</span>
        <span v-else-if="(stamina || []).length">Estimated from click intervals</span>
        <span v-else>—</span>
      </p>
    </div>

    <div class="relative h-32 w-full overflow-hidden rounded-xl bg-black/40">
      <!-- Center + 300g guides -->
      <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/25" />
      <div class="absolute top-0 bottom-0 left-1/2 -translate-x-[calc(20%)] border-l border-dashed border-white/15" />
      <div class="absolute top-0 bottom-0 left-1/2 translate-x-[calc(20%)] border-l border-dashed border-white/15" />

      <div class="absolute inset-0 flex items-center justify-between px-2 text-[10px] text-zinc-500">
        <span>-50ms</span>
        <span>0ms</span>
        <span>+50ms</span>
      </div>

      <div class="relative flex h-full items-end justify-between px-2 gap-0.75">
        <div
          v-for="(b, idx) in bins"
          :key="idx"
          class="flex-1 rounded-sm transition-all duration-200"
          :class="[
            b.side === 'early' ? 'bg-cyan-300/80' : '',
            b.side === 'late' ? 'bg-orange-300/80' : '',
            b.side === 'center' ? 'bg-white/80' : ''
          ]"
          :style="{ height: `${Math.min(100, b.count) * 0.9}%` }"
        />
      </div>

      <div v-if="!bins.length" class="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
        No timing data
      </div>
    </div>
  </div>
</template>
