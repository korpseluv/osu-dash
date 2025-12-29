<script setup lang="ts">
import { ref, watchEffect } from 'vue'

const props = defineProps<{ id: string | number; alt?: string }>()

const failed = ref(false)
const src = ref('')

watchEffect(() => {
  src.value = `/api/cover?id=${encodeURIComponent(props.id ?? '')}`
  failed.value = false
})

const onError = () => {
  failed.value = true
  src.value = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
}
</script>

<template>
  <div class="absolute inset-0 overflow-hidden bg-zinc-900">
    <img
      v-if="!failed"
      :src="src"
      :alt="alt || 'beatmap cover'"
      loading="lazy"
      class="absolute inset-0 h-full w-full object-cover grayscale opacity-40 transition-all duration-500 group-hover:scale-105 group-hover:grayscale-0 group-hover:opacity-100"
      @error="onError"
    />
    <div v-else class="absolute inset-0 bg-zinc-800" />
  </div>
</template>
