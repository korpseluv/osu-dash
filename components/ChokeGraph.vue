<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  duration: number
  chokeTimestamp: number | null
  stressFactor?: number | null
}>()

const safeDuration = computed(() => Math.max(1, props.duration || 1))
const chokePercent = computed(() => {
  if (props.chokeTimestamp == null) return null
  const pct = (props.chokeTimestamp / safeDuration.value) * 100
  return Math.max(0, Math.min(100, pct))
})
</script>

<template>
  <div class="space-y-2">
    <div class="relative h-4 w-full overflow-hidden rounded-full bg-zinc-800">
      <div class="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900" />
      <div v-if="chokePercent != null" class="absolute top-0 bottom-0 w-[2px] bg-rose-400" :style="{ left: `${chokePercent}%` }">
        <div class="absolute -top-6 left-1/2 -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-[3px] text-[11px] text-rose-100 shadow">
          The Heartbreak
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between text-[11px] text-zinc-400">
      <span>0s</span>
      <span>Duration: {{ safeDuration.toFixed(1) }}s</span>
      <span v-if="stressFactor != null">Stress: {{ stressFactor.toFixed(2) }}</span>
    </div>
  </div>
</template>
