<script setup lang="ts">
const props = defineProps<{ hitErrors?: number[] | null }>()
const ticks = (props.hitErrors || []).slice(0, 400) // safety cap
</script>

<template>
  <div class="relative h-10 w-full overflow-hidden rounded-xl border border-white/10 bg-black/60 px-3 py-2">
    <div class="absolute left-1/2 top-0 bottom-0 w-px bg-white/30" />
    <div class="absolute inset-0 flex items-center justify-between opacity-50">
      <span class="text-[10px] text-zinc-500">Early</span>
      <span class="text-[10px] text-zinc-500">Late</span>
    </div>
    <div class="relative flex h-full items-center">
      <span
        v-for="(v, idx) in ticks"
        :key="idx"
        class="absolute bottom-1/2 h-6 w-[1px] bg-white"
        :style="{ left: `calc(50% + ${Math.max(-120, Math.min(120, v))}%)` }"
      />
    </div>
  </div>
</template>
