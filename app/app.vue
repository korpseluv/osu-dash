<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import countryCodeList from 'flagpack-core/countryCodeList.json'
import BeatmapCover from '../components/BeatmapCover.vue'
import HitErrorBar from '../components/HitErrorBar.vue'
import ChokeGraph from '../components/ChokeGraph.vue'
import ReplayChart from '../components/ReplayChart.vue'

type HitErrorEvent = { offset: number; time: number; combo: number }
type UserPayload = {
  username: string
  avatar: string
  rank: number
  pp: number
  playcount: number
  country: string
  online: boolean
  accuracy?: number | null
  countryRank?: number | null
  rankHistory?: number[]
  gradeCounts?: {
    ssh?: number
    ss?: number
    sh?: number
    s?: number
    a?: number
    b?: number
    c?: number
    d?: number
  }
  source?: 'live' | 'mock' | 'cached' | 'error'
}

type ScorePayload = {
  id: string | number
  title: string
  difficulty: string
  rank: string
  pp?: number | null
  accuracy?: number | null
  created_at?: string
  beatmap_md5?: string | null
  beatmap?: {
    checksum?: string | null
    id?: number | string | null
    version?: string | null
    title?: string | null
  }
  beatmapset?: {
    id?: number | string | null
    title?: string | null
    artist?: string | null
    creator?: string | null
    covers?: Record<string, string> | null
  }
  deep_stats?: {
    ur?: number | null
    hit_errors?: number[]
    stamina?: number[]
    hit_error_events?: HitErrorEvent[]
    choke_timestamp?: number | null
    stress_factor?: number | null
  }
}

type MostPlayedPayload = {
  id: string | number
  title: string
  difficulty: string
  playcount: number
}

type ActivityPayload = {
  id: string | number
  type: string
  text: string
  created_at?: string
}

const runtimeConfig = useRuntimeConfig()
const appVersion = computed(() => String((runtimeConfig.public as any)?.gitHash || 'unknown'))

const fallbackUser: UserPayload = {
  username: 'chlokun',
  avatar: 'https://a.ppy.sh/6829235?1680000000.jpeg',
  rank: 852341,
  pp: 1450,
  playcount: 12840,
  country: 'KR',
  online: true,
  accuracy: 97.42,
  countryRank: 512,
  rankHistory: [930000, 890000, 870000, 860000, 855000, 852341],
  gradeCounts: { ssh: 2, ss: 14, sh: 8, s: 42, a: 120, b: 64, c: 32, d: 18 },
  source: 'mock'
}

const fallbackRecent: ScorePayload[] = [
  { id: 'r1', title: 'Blue Zenith', difficulty: 'FOUR DIMENSIONS', rank: 'A', pp: 238.5, accuracy: 98.42 },
  { id: 'r2', title: 'Freedom Dive', difficulty: 'Another', rank: 'F', pp: 0, accuracy: 76.13 }
]

const fallbackBest: ScorePayload[] = [
  { id: 'b1', title: 'The Big Black', difficulty: 'Black Another', rank: 'SS', pp: 412.7, accuracy: 99.31 },
  { id: 'b2', title: 'Hollow Wings', difficulty: 'Recollection', rank: 'S', pp: 368.2, accuracy: 98.77 }
]

const fallbackPinned: ScorePayload[] = []

const fallbackMostPlayed: MostPlayedPayload[] = [
  { id: 'm1', title: 'Blue Zenith', difficulty: 'FOUR DIMENSIONS', playcount: 1204 },
  { id: 'm2', title: 'Freedom Dive', difficulty: 'Another', playcount: 987 },
  { id: 'm3', title: 'Hollow Wings', difficulty: 'Recollection', playcount: 612 }
]

const fallbackFirsts: ScorePayload[] = []

const fallbackActivity: ActivityPayload[] = [
  { id: 'a1', type: 'medal', text: 'Unlocked medal: Medal of Tenacity', created_at: '2024-06-01T00:00:00Z' },
  { id: 'a2', type: 'play', text: 'Set a new top play on Galaxy Collapse', created_at: '2024-06-03T00:00:00Z' }
]

type ApiPayload = {
  user: UserPayload
  recent: ScorePayload[]
  best: ScorePayload[]
  pinned: ScorePayload[]
  firsts: ScorePayload[]
  most_played: MostPlayedPayload[]
  activity: ActivityPayload[]
  last_updated?: number
  errors?: string[]
  source: 'live' | 'mock' | 'cached'
}

const { data, pending, error, refresh } = await useAsyncData<ApiPayload>('osu-user', () => $fetch<ApiPayload>('/api/user'), {
  default: () => ({
    user: fallbackUser,
    recent: fallbackRecent,
    best: fallbackBest,
    pinned: fallbackPinned,
    firsts: fallbackFirsts,
    most_played: fallbackMostPlayed,
    activity: fallbackActivity,
    last_updated: Date.now(),
    errors: [],
    source: 'mock'
  } satisfies ApiPayload)
})

const isDev = import.meta.dev
const isProdBuild = !import.meta.dev
const refreshIntervalMs = isDev ? 0 : 10 * 60_000
let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  if (refreshIntervalMs > 0) {
    refreshTimer = setInterval(() => refresh(), refreshIntervalMs)
  }
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('keydown', handleKeydown)
})

const user = computed(() => data.value?.user ?? fallbackUser)
const recent = computed(() => data.value?.recent ?? fallbackRecent)
const best = computed(() => data.value?.best ?? fallbackBest)
const pinned = computed(() => data.value?.pinned ?? fallbackPinned)
const firsts = computed(() => data.value?.firsts ?? fallbackFirsts)
const mostPlayed = computed(() => data.value?.most_played ?? fallbackMostPlayed)
const activity = computed(() => data.value?.activity ?? fallbackActivity)
const errorsList = computed(() => data.value?.errors ?? [])
const lastUpdated = computed(() => data.value?.last_updated)
const statusMeta = computed(() => {
  const ts = lastUpdated.value
  const minutes = ts ? Math.floor((Date.now() - ts) / 60000) : null
  const isCached = data.value?.source === 'cached'
  return {
    label: isCached ? 'Cached' : 'Live',
    detail: isCached && minutes !== null ? `Updated ${minutes}m ago` : 'Fresh pull',
    tone: isCached ? 'cached' : 'live'
  }
})

const flagSvgs = import.meta.glob('../node_modules/flagpack-core/svg/m/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>
const flagMap = Object.fromEntries(
  Object.entries(flagSvgs).map(([path, url]) => {
    const match = path.match(/\/([A-Za-z]{2})\.svg$/)
    const code = match?.[1]
    return [code ? code.toUpperCase() : path, url as string]
  })
) as Record<string, string>

const countryNameMap = Object.fromEntries(
  (countryCodeList as any[]).map((entry) => {
    const code = String(entry?.alpha2 || '').toUpperCase()
    return [code, entry?.countryName || code]
  })
)

const countryCode = computed(() => (user.value?.country || '').trim().toUpperCase())
const countryFlagUrl = computed(() => {
  const code = countryCode.value
  if (!code) return ''
  return flagMap[code] ?? ''
})
const countryFlagEmoji = computed(() => countryToFlag(countryCode.value))
const countryName = computed(() => {
  const code = countryCode.value
  if (!code) return ''
  return countryNameMap[code] || code
})
const profileUrl = computed(() => {
  const u = user.value
  if (!u) return 'https://osu.ppy.sh/users'
  if ((u as any).id != null) return `https://osu.ppy.sh/users/${(u as any).id}`
  const name = u.username || ''
  return `https://osu.ppy.sh/users/${encodeURIComponent(name)}`
})

function countryToFlag(country?: string | null) {
  if (!country) return ''
  const cc = country.trim().toUpperCase()
  if (cc.length !== 2) return cc
  const A = 0x1F1E6
  const offset = 'A'.charCodeAt(0)
  return String.fromCodePoint(...cc.split('').map((c) => A + c.charCodeAt(0) - offset))
}

const gradeCounts = computed(() => user.value.gradeCounts ?? {})

const gradeBadges = computed(() => [
  { label: 'SSH', value: gradeCounts.value.ssh ?? 0, tone: 'badge-ss' },
  { label: 'SS', value: gradeCounts.value.ss ?? 0, tone: 'badge-ss' },
  { label: 'SH', value: gradeCounts.value.sh ?? 0, tone: 'badge-s' },
  { label: 'S', value: gradeCounts.value.s ?? 0, tone: 'badge-s' },
  { label: 'A', value: gradeCounts.value.a ?? 0, tone: 'badge-a' },
  { label: 'B', value: gradeCounts.value.b ?? 0, tone: 'badge-b' },
  { label: 'C', value: gradeCounts.value.c ?? 0, tone: 'badge-c' },
  { label: 'D', value: gradeCounts.value.d ?? 0, tone: 'badge-d' }
])

const stats = computed(() => [
  { label: 'Performance', value: `${Math.round(user.value.pp ?? 0)} pp` },
  { label: 'Accuracy', value: user.value.accuracy != null ? `${user.value.accuracy.toFixed(2)}%` : '—' },
  { label: 'Playcount', value: user.value.playcount?.toLocaleString() ?? '—' },
  { label: 'Country Rank', value: user.value.countryRank ? `#${user.value.countryRank.toLocaleString()} (${user.value.country})` : '—' }
])

const milestoneStatus = computed(() => {
  const rank = user.value.rank ?? 0
  const windowStart = Math.max(1, Math.floor(rank / 10000) * 10000)
  const distance = Math.max(0, rank - windowStart)
  const progressPercent = Math.min(100, (10000 - distance) / 100)
  return {
    label: `Toward top ${windowStart.toLocaleString()}`,
    distance,
    progressPercent
  }
})

const rankClass = (rank: string | null | undefined) => {
  const base = 'inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold'
  const tone: Record<string, string> = {
    SSH: 'bg-white text-black',
    SS: 'bg-white text-black',
    SH: 'bg-zinc-200 text-black',
    S: 'bg-zinc-200 text-black',
    A: 'bg-emerald-200 text-emerald-900',
    B: 'bg-blue-200 text-blue-900',
    C: 'bg-amber-200 text-amber-900',
    D: 'bg-rose-200 text-rose-900',
    F: 'bg-rose-200 text-rose-900'
  }
  return `${base} ${tone[rank ?? ''] || 'bg-zinc-200 text-black'}`
}

const isFail = (rank: string | null | undefined) => rank === 'F'

const scoreMods = (score: any): string[] => {
  const arr = score?.mods_list
  if (Array.isArray(arr)) return arr.filter((m: any) => typeof m === 'string' && m)

  // Fallback: bitmask
  const mods = typeof score?.mods === 'number' ? score.mods : Number(score?.mods)
  if (!Number.isFinite(mods) || !mods) return []
  const table: Record<number, string> = {
    1: 'NF', 2: 'EZ', 4: 'TD', 8: 'HD', 16: 'HR', 32: 'SD', 64: 'DT', 128: 'RL', 256: 'HT', 512: 'NC',
    1024: 'FL', 2048: 'AT', 4096: 'SO', 8192: 'AP', 16384: 'PF'
  }
  const out: string[] = []
  Object.entries(table).forEach(([mask, label]) => {
    if (mods & Number(mask)) out.push(label)
  })
  return out.includes('NC') ? out.filter((m) => m !== 'DT') : out
}

const modBadgeClass = (mod: string) => {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border'
  const tone: Record<string, string> = {
    DT: 'border-purple-200/40 bg-purple-500/20 text-purple-100',
    NC: 'border-purple-200/40 bg-purple-500/20 text-purple-100',
    HR: 'border-red-200/40 bg-red-500/20 text-red-100',
    HD: 'border-yellow-200/40 bg-yellow-500/20 text-yellow-100',
    FL: 'border-cyan-200/40 bg-cyan-500/20 text-cyan-100',
    EZ: 'border-emerald-200/40 bg-emerald-500/20 text-emerald-100',
    HT: 'border-indigo-200/40 bg-indigo-500/20 text-indigo-100',
    NF: 'border-zinc-200/30 bg-white/10 text-zinc-200'
  }
  return `${base} ${tone[mod] || 'border-white/15 bg-white/5 text-white/80'}`
}

const rankHistory = computed(() => user.value.rankHistory || [])

const chartRef = ref<HTMLElement | null>(null)
const graphHover = ref<{
  index: number
  xPercent: number
  yPercent: number
  dateLabel: string
  rankLabel: string
} | null>(null)

const filteredRecent = computed(() => {
  // Deduplicate by beatmap checksum as the primary key.
  // If multiple entries exist for the same map, keep the most recent.
  const byChecksum = new Map<string, ScorePayload>()
  const fallback: ScorePayload[] = []

  for (const s of recent.value) {
    const checksum = String((s as any)?.beatmap?.checksum || (s as any)?.beatmap_md5 || '').toLowerCase()
    if (!checksum) {
      fallback.push(s)
      continue
    }

    const prev = byChecksum.get(checksum)
    if (!prev) {
      byChecksum.set(checksum, s)
      continue
    }

    const tPrev = prev.created_at ? Date.parse(prev.created_at) : 0
    const tCur = s.created_at ? Date.parse(s.created_at) : 0
    if (tCur >= tPrev) byChecksum.set(checksum, s)
  }

  const deduped = [...byChecksum.values(), ...fallback]
  return deduped.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })
})
const firstsHighlighted = computed(() => firsts.value)
const totalPlaycount = computed(() => {
  const userTotal = user.value.playcount ?? 0
  const listTotal = mostPlayed.value.reduce((sum, m) => sum + m.playcount, 0)
  return Math.max(1, userTotal || listTotal)
})

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'top', label: 'Top Ranks' },
  { id: 'history', label: 'History' },
  { id: 'deep', label: 'Deep Stats' }
]

const activeTab = ref<'overview' | 'top' | 'history' | 'deep'>('overview')

const deepScores = computed(() => {
  const pool = [
    ...filteredRecent.value,
    ...best.value,
    ...pinned.value,
    ...firsts.value
  ]
  const withStats = pool.filter((s) => s.deep_stats)

  // Primary key: beatmap checksum. Keep the newest entry per map.
  const byChecksum = new Map<string, typeof withStats[number]>()
  const fallbacks: typeof withStats = [] as any

  for (const s of withStats) {
    const checksum = String((s as any)?.beatmap?.checksum || (s as any)?.beatmap_md5 || '').toLowerCase()
    if (!checksum) {
      fallbacks.push(s)
      continue
    }

    const prev = byChecksum.get(checksum)
    if (!prev) {
      byChecksum.set(checksum, s)
      continue
    }

    const tPrev = prev.created_at ? Date.parse(prev.created_at) : 0
    const tCur = s.created_at ? Date.parse(s.created_at) : 0
    if (tCur >= tPrev) byChecksum.set(checksum, s)
  }

  const dedup = [...byChecksum.values(), ...fallbacks]
  return dedup.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })
})

const scoreTitle = (s: ScorePayload) => s.beatmapset?.title || s.beatmap?.title || s.title
const scoreVersion = (s: ScorePayload) => s.beatmap?.version || s.difficulty

const selectedScore = ref<ScorePayload | null>(null)
const detailTab = ref<'timing' | 'stamina' | 'choke'>('timing')

const openDetail = (score: ScorePayload) => {
  if (!score.deep_stats) return
  selectedScore.value = score
  detailTab.value = 'timing'
}

const closeDetail = () => {
  selectedScore.value = null
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeDetail()
}

const detailHitErrors = computed(() => selectedScore.value?.deep_stats?.hit_errors || [])
const detailStamina = computed(() => selectedScore.value?.deep_stats?.stamina || [])
const detailEvents = computed(() => selectedScore.value?.deep_stats?.hit_error_events || [])
const detailDuration = computed(() => {
  if (detailEvents.value.length) {
    const last = detailEvents.value.at(-1)
    return Math.max(last?.time || 0, detailEvents.value.length * 0.4)
  }
  return detailHitErrors.value.length * 0.4
})

const chokeTimestamp = computed(() => selectedScore.value?.deep_stats?.choke_timestamp ?? null)
const stressFactor = computed(() => selectedScore.value?.deep_stats?.stress_factor ?? null)

const hitErrorHistogram = computed(() => {
  const values = detailHitErrors.value
  if (!values.length) return [] as { x0: number; x1: number; count: number }[]
  const min = -150
  const max = 150
  const bins = 20
  const width = (max - min) / bins
  const counts = Array.from({ length: bins }, () => 0)
  values.forEach((v) => {
    const clamped = Math.max(min, Math.min(max, v))
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((clamped - min) / width)))
    counts[idx] = (counts[idx] ?? 0) + 1
  })
  return counts.map((c, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: c }))
})

const heatmapBuckets = computed(() => {
  const events = detailEvents.value
  if (!events.length) return [] as { start: number; end: number; variance: number }[]
  const bucketCount = 16
  const duration = detailDuration.value || 1
  const bucketSize = duration / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_v, idx) => ({ start: idx * bucketSize, end: (idx + 1) * bucketSize, values: [] as number[] }))
  events.forEach((ev) => {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(ev.time / bucketSize)))
    const bucket = buckets[idx]
    if (!bucket) return
    bucket.values.push(ev.offset)
  })
  return buckets.map((b) => {
    if (!b.values.length) return { start: b.start, end: b.end, variance: 0 }
    const mean = b.values.reduce((s, v) => s + v, 0) / b.values.length
    const variance = b.values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / b.values.length
    return { start: b.start, end: b.end, variance }
  })
})

const maxHeatVariance = computed(() => Math.max(1, ...heatmapBuckets.value.map((b) => b.variance)))
const hottestBucketIndex = computed(() => {
  let idx = -1
  let best = -1
  heatmapBuckets.value.forEach((b, i) => {
    if (b.variance > best) {
      best = b.variance
      idx = i
    }
  })
  return idx
})

const staminaSeries = computed(() => {
  const events = detailEvents.value
  if (events.length > 1) {
    return events
      .slice(1)
      .map((ev, idx) => {
        const prev = events[idx]
        if (!prev) return null
        const delta = Math.max(0.01, ev.time - prev.time)
        const bpm = 60 / delta
        return { t: ev.time, bpm }
      })
      .filter((v): v is { t: number; bpm: number } => v != null)
  }
  const spacing = detailHitErrors.value.length ? detailDuration.value / Math.max(1, detailHitErrors.value.length) : 0.4
  return detailHitErrors.value.map((_v, idx) => ({ t: idx * spacing, bpm: 60 / Math.max(0.01, spacing) }))
})

const chartWidth = 360
const chartHeight = 140

const rankPaths = computed(() => {
  const data = rankHistory.value
  if (!data.length) return { line: '', fill: '', dots: [], viewBox: `0 0 ${chartWidth} ${chartHeight}`, points: [], width: chartWidth, height: chartHeight, ticks: [] }

  const max = Math.max(...data)
  const min = Math.min(...data)
  const spread = Math.max(1, max - min)
  const padding = 16
  const dynamicWidth = Math.max(chartWidth, padding * 2 + Math.max(1, data.length - 1) * 40)
  const dynamicHeight = chartHeight

  const scaleY = (v: number) => ((v - min) / spread) * (dynamicHeight - padding * 2) + padding

  const points = data.map((v, i) => {
    const x = data.length === 1 ? dynamicWidth / 2 : (i / (data.length - 1)) * (dynamicWidth - padding * 2) + padding
    const y = scaleY(v)
    return { x, y, index: i, value: v }
  })

  const firstPoint = points[0]
  const lastPoint = points.at(-1)
  if (!firstPoint || !lastPoint) {
    return { line: '', fill: '', dots: [], viewBox: `0 0 ${dynamicWidth} ${dynamicHeight}`, points: [], width: dynamicWidth, height: dynamicHeight, ticks: [] }
  }

  const tickCount = 5
  const tickStep = spread / Math.max(1, tickCount - 1)
  const ticks = Array.from({ length: tickCount }, (_v, idx) => {
    const raw = max - tickStep * idx
    const rounded = Math.round(raw / 1000) * 1000
    return {
      value: rounded,
      y: scaleY(rounded),
      label: formatRankCompact(rounded)
    }
  })

  const { path: line } = getSmoothPath(points)
  const fill = `${line} L${lastPoint.x.toFixed(2)},${dynamicHeight - padding} L${firstPoint.x.toFixed(2)},${dynamicHeight - padding} Z`

  const dots = [firstPoint, lastPoint].filter((p): p is typeof firstPoint => Boolean(p))
  return { line, fill, dots, viewBox: `0 0 ${dynamicWidth} ${dynamicHeight}`, points, width: dynamicWidth, height: dynamicHeight, ticks }
})

const getSmoothPath = (pts: { x: number; y: number }[]) => {
  if (pts.length < 2) return { path: '' }
  const d: string[] = []
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]
    if (!p1) continue
    const p0 = pts[i - 1] ?? p1
    const p2 = pts[i + 1] ?? p1
    const p3 = pts[i + 2] ?? p2
    if (i === 0) {
      d.push(`M${p1.x.toFixed(2)},${p1.y.toFixed(2)}`)
    }
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`)
  }
  return { path: d.join(' ') }
}

const formatRankCompact = (val: number) => {
  if (val >= 1000) return `${Math.round(val / 1000)}k`
  return `${val}`
}

const formatDateLabel = (date: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)

const dateForIndex = (idx: number) => {
  const len = rankHistory.value.length
  if (len <= 1) return new Date()
  const totalDays = 90
  const stepDays = totalDays / Math.max(1, len - 1)
  const daysAgo = (len - 1 - idx) * stepDays
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d
}

const onGraphMove = (event: MouseEvent) => {
  const meta = rankPaths.value
  if (!meta.points?.length) return
  const firstPoint = meta.points[0]
  if (!firstPoint) return

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const xPx = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
  const xRatio = rect.width ? xPx / rect.width : 0
  const targetX = xRatio * meta.width

  let nearest = firstPoint
  let minDist = Math.abs(firstPoint.x - targetX)
  for (let i = 1; i < meta.points.length; i++) {
    const p = meta.points[i]
    if (!p) continue
    const dist = Math.abs(p.x - targetX)
    if (dist < minDist) {
      minDist = dist
      nearest = p
    }
  }

  const date = dateForIndex(nearest.index)
  const rankLabel = `#${(nearest.value ?? 0).toLocaleString()}`
  graphHover.value = {
    index: nearest.index,
    xPercent: (nearest.x / meta.width) * 100,
    yPercent: (nearest.y / meta.height) * 100,
    dateLabel: formatDateLabel(date),
    rankLabel
  }
}

const onGraphLeave = () => {
  graphHover.value = null
}
</script>

<template>
  <div class="min-h-screen bg-black text-white">
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-12">
      <div class="w-full space-y-8">
        <div
          v-if="isProdBuild"
          class="silky-in rounded-2xl border border-orange-400/35 bg-orange-500/10 px-5 py-4 text-orange-50 backdrop-blur"
          style="--i: 0"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold tracking-tight">osu!dash is still in development</p>
              <p class="mt-1 text-xs leading-relaxed text-orange-100/90">
                Production disables live data pulling in favor of cached data to reduce Osu!'s api load.
              </p>
            </div>
            <!-- <span class="inline-flex items-center rounded-full border border-orange-300/30 bg-orange-400/10 px-3 py-1 text-[11px] font-semibold text-orange-100">
              Production Build
            </span> -->
          </div>
        </div>

        <div class="silky-card silky-in rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl" style="--i: 0">
          <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex items-center gap-4">
              <div class="relative h-20 w-20 overflow-hidden rounded-full border border-white/15 bg-black shadow-[0_0_40px_rgba(255,255,255,0.06)]">
                <img :src="user.avatar" :alt="user.username" class="h-full w-full object-cover" />
                <span
                  class="absolute bottom-1 right-1 h-3 w-3 rounded-full"
                  :class="user.online ? 'bg-emerald-400 shadow-[0_0_0_6px_rgba(16,185,129,0.18)]' : 'bg-rose-400 shadow-[0_0_0_6px_rgba(248,113,113,0.18)]'"
                />
              </div>
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-3xl font-semibold tracking-tight flex items-center gap-2">
                    <a :href="profileUrl" target="_blank" rel="noreferrer" class="hover:underline decoration-white/30">
                      {{ user.username }}
                    </a>
                    <span v-if="countryFlagUrl || countryFlagEmoji" class="relative inline-flex items-center group">
                      <img
                        v-if="countryFlagUrl"
                        :src="countryFlagUrl"
                        :alt="countryName || countryCode || 'Country flag'"
                        class="h-7 w-10 rounded-lg border border-white/25 shadow-sm shrink-0"
                        loading="lazy"
                      />
                      <span v-else-if="countryFlagEmoji" aria-hidden="true" class="text-xl leading-none">{{ countryFlagEmoji }}</span>
                      <span
                        v-if="countryName"
                        class="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg border border-white/20 bg-black/90 px-4 py-2 text-[12px] font-semibold text-white opacity-0 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100"
                      >
                        {{ countryName }}
                      </span>
                    </span>
                  </h1>
                  
                </div>
                <!-- <p class="text-sm text-zinc-500">Single target profile; live only.</p> -->
              </div>
            </div>
            <div class="flex flex-col items-end gap-2 text-right">
              <div class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[13px] text-zinc-200 transition-all duration-500 ease-out hover:border-white/30">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="user.online ? 'bg-emerald-400 shadow-[0_0_0_6px_rgba(16,185,129,0.18)]' : 'bg-rose-400 shadow-[0_0_0_6px_rgba(248,113,113,0.18)]'"
                />
                <span>{{ user.online ? 'Online' : 'Offline' }}</span>
              </div>
            </div>
          </div>

          <div class="mt-8 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
            <div class="space-y-4">
              <p class="text-sm text-zinc-400">Global Rank</p>
              <p class="text-6xl font-semibold tracking-tighter text-white">{{ user.rank ? `#${user.rank.toLocaleString()}` : '—' }}</p>
              <!-- <p class="text-sm text-zinc-500">Precision-cut hero card with breathable spacing.</p> -->
            </div>
            <div class="space-y-3">
              <p class="text-sm text-zinc-400">Next milestone</p>
              <div class="relative isolate rounded-full border border-white/10 bg-zinc-950/60 p-1.5 transition-all duration-500 ease-out hover:border-white/20">
                <div class="relative h-7 overflow-hidden rounded-full bg-zinc-950/80">
                  <div
                    class="absolute inset-y-0 left-0 z-0 rounded-full bg-white/35 transition-all duration-700 ease-out"
                    :style="{ width: `${milestoneStatus.progressPercent.toFixed(1)}%` }"
                  />
                  <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-5 text-sm font-semibold text-zinc-200 drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]">
                    <span>{{ milestoneStatus.label }}</span>
                    <span>{{ milestoneStatus.distance.toLocaleString() }} to go</span>
                  </div>
                </div>
              </div>
              <p class="text-xs text-zinc-500">Progress measured within the current 10k window.</p>
            </div>
          </div>
        </div>

        <Transition name="silky-fade">
          <div
            v-if="errorsList.length"
            class="silky-in rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            style="--i: 0.5"
          >
            <p class="font-semibold">Some data failed to load:</p>
            <ul class="mt-2 space-y-1 text-amber-200">
              <li v-for="err in errorsList" :key="err">• {{ err }}</li>
            </ul>
          </div>
        </Transition>

        <div class="grid gap-4 md:grid-cols-4">
          <div
            v-for="(stat, idx) in stats"
            :key="stat.label"
            class="silky-card silky-in rounded-2xl border border-white/10 bg-zinc-900/60 p-5 text-left"
            :style="{ '--i': idx + 1 }"
          >
            <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">{{ stat.label }}</p>
            <p class="mt-3 text-2xl font-semibold tracking-tight text-white">{{ stat.value }}</p>
          </div>
        </div>

        <div class="flex flex-row flex-wrap gap-2">
          <div
            v-for="badge in gradeBadges"
            :key="badge.label"
            class="silky-in rounded-full px-3 py-1 text-xs font-slim transition-all duration-500 ease-out"
            :class="[
              badge.tone === 'badge-ss' ? 'bg-white text-black border border-white' : '',
              badge.tone === 'badge-s' ? 'bg-white text-black border border-white' : '',
              badge.tone === 'badge-a' ? 'border border-white/50 text-white' : '',
              badge.tone === 'badge-s' ? '' : '',
              badge.tone === 'badge-ss' ? '' : '',
              badge.label === 'F' ? 'line-through opacity-60 border border-white/20 text-white' : '',
              !['badge-ss','badge-s','badge-a'].includes(badge.tone) && badge.label !== 'F' ? 'border border-white/30 text-white' : ''
            ]"
          >
            <span class="inline-flex items-baseline gap-1 leading-none">
              <span class="text-sm font-semibold">{{ badge.label }}</span>
              <span aria-hidden="true">·</span>
                <span class="text-sm font-normal">{{ badge.value.toLocaleString() }}</span>
            </span>
          </div>
        </div>

        <div class="silky-in rounded-2xl border border-white/10 bg-zinc-950/80 p-2 backdrop-blur" style="--i: 4">
          <div class="flex rounded-2xl bg-zinc-900 p-1 text-sm font-semibold">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="flex-1 rounded-2xl px-4 py-2 transition-all duration-300"
              :class="activeTab === tab.id ? 'bg-white text-black shadow' : 'text-zinc-400 hover:text-white'"
              @click="activeTab = tab.id as typeof activeTab"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div v-if="activeTab === 'overview'" class="space-y-6">
          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <!-- <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Rank history</p> -->
                <p class="text-lg font-semibold tracking-tight text-white">Rank history</p>
                <!-- <p class="text-sm text-zinc-400">White line, no clutter; draws on load.</p> -->
              </div>
            </div>
            <div class="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-4">
              <div class="relative flex" @mousemove="onGraphMove" @mouseleave="onGraphLeave">
                <div class="absolute left-0 top-0 bottom-8 w-12">
                  <div
                    v-for="tick in rankPaths.ticks"
                    :key="tick.value"
                    class="absolute right-2 text-[11px] text-zinc-500"
                    :style="{ top: `${(tick.y / rankPaths.height) * 100}%`, transform: 'translateY(-50%)' }"
                  >
                    {{ tick.label }}
                  </div>
                </div>
                <div class="ml-12 flex-1">
                  <div class="relative">
                    <svg ref="chartRef" :viewBox="rankPaths.viewBox" class="h-44 w-full text-white pointer-events-none">
                      <defs>
                        <linearGradient id="rank-fill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stop-color="white" stop-opacity="0.12" />
                          <stop offset="100%" stop-color="white" stop-opacity="0" />
                        </linearGradient>
                      </defs>
                      <path v-if="rankPaths.fill" :d="rankPaths.fill" fill="url(#rank-fill)" fill-opacity="0.6" />
                      <path v-if="rankPaths.line" :d="rankPaths.line" fill="none" stroke="white" stroke-width="6" class="rank-line" />
                      <g v-if="rankPaths.dots?.length">
                        <circle
                          v-for="(dot, idx) in rankPaths.dots"
                          :key="idx"
                          :cx="dot.x"
                          :cy="dot.y"
                          r="5"
                          class="fill-white/90"
                        />
                        <circle
                          v-for="(dot, idx) in rankPaths.dots"
                          :key="`glow-${idx}`"
                          :cx="dot.x"
                          :cy="dot.y"
                          r="12"
                          class="fill-white/25 blur-sm"
                        />
                      </g>
                    </svg>

                    <div v-if="graphHover" class="pointer-events-none absolute inset-0">
                      <div
                        class="absolute top-0 bottom-0 border-l border-dashed border-white/60"
                        :style="{ left: `${graphHover.xPercent}%` }"
                      />
                      <div
                        class="absolute -translate-y-1/2 transform"
                        :class="graphHover.xPercent > 50 ? '-translate-x-full -ml-2' : 'translate-x-2'"
                        :style="{ left: `${graphHover.xPercent}%`, top: `${graphHover.yPercent}%` }"
                      >
                        <div class="rounded-lg border border-white/10 bg-black/90 px-3 py-2 text-xs text-white shadow-lg backdrop-blur">
                          <p class="font-semibold">{{ graphHover.rankLabel }}</p>
                          <p class="text-[11px] text-zinc-300">{{ graphHover.dateLabel }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mt-4 flex items-center justify-between px-2 text-[11px] text-zinc-600">
                <span>90 Days Ago</span>
                <span>45 Days Ago</span>
                <span>Today</span>
              </div>
              <p v-if="!rankPaths.line" class="text-xs text-zinc-500">No rank history available.</p>
            </div>
          </div>

          <div v-if="firstsHighlighted.length" class="silky-card rounded-3xl border border-white/20 bg-white/5 p-6 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Pinned scores</p>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div
                v-for="score in firstsHighlighted"
                :key="score.id"
                class="relative rounded-2xl border border-yellow-200/60 bg-zinc-900/50 p-4 shadow-[0_0_30px_rgba(255,255,255,0.2)]"
              >
                <button
                  v-if="score.deep_stats"
                  class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-500 backdrop-blur transition hover:border-white/60 hover:text-white hover:shadow-[0_0_14px_rgba(255,255,255,0.6)] cursor-pointer"
                  aria-label="Open deep stats"
                  @click.stop="openDetail(score)"
                >
                  >
                </button>
                <p class="truncate text-sm font-semibold text-white">{{ score.title }}</p>
                <p class="truncate text-xs text-zinc-500">{{ score.difficulty }}</p>
                <div class="mt-3 flex items-center gap-3 text-sm">
                  <span :class="rankClass(score.rank)">{{ score.rank || '—' }}</span>
                  <span class="text-white font-semibold">{{ score.pp != null ? `${Math.round(score.pp)} pp` : '—' }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <p class="text-lg font-semibold tracking-tight text-white">Recent plays</p>
                <p class="text-xs text-zinc-500">Archived Plays: {{ recent.length }}</p>
              </div>
            </div>
            <div class="mt-6 max-h-150 space-y-2 overflow-y-auto pr-1">
              <div
                v-for="score in filteredRecent"
                :key="(score as any).beatmap?.checksum || (score as any).beatmap_md5 || score.id"
                class="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur transition-all duration-500 ease-out hover:-translate-y-px hover:border-white/30"
                :class="isFail(score.rank) ? 'opacity-60' : ''"
              >
                <div class="absolute inset-0 opacity-20">
                  <BeatmapCover
                    :id="(score as any).beatmapset?.id || (score as any).beatmap?.beatmapset_id || (score as any).beatmapset_id || (score as any).beatmapsetId || 0"
                    :alt="scoreTitle(score)"
                  />
                </div>
                <div class="absolute inset-0 bg-linear-to-r from-black/90 via-black/60 to-transparent" />
                <div class="relative z-10 flex items-center justify-between gap-4">
                  <div class="min-w-0 flex-1 space-y-1">
                    <p class="truncate text-sm font-semibold text-white">{{ scoreTitle(score) }}</p>
                    <p class="truncate text-xs text-zinc-400">{{ scoreVersion(score) }}</p>
                    <p class="text-[11px] text-zinc-500">{{ score.created_at ? new Date(score.created_at).toLocaleString() : '' }}</p>
                    <div v-if="score.deep_stats?.hit_errors?.length" class="mt-2">
                      <HitErrorBar :hit-errors="score.deep_stats.hit_errors" />
                    </div>
                  </div>
                  <div class="flex items-center gap-4">
                    <div class="flex flex-col items-end gap-2 text-sm">
                    <span :class="rankClass(score.rank)">{{ score.rank || '—' }}</span>
                    <span class="text-white font-semibold" :class="isFail(score.rank) ? 'line-through text-zinc-600' : ''">
                      {{ score.pp != null ? `${Math.round(score.pp)} pp` : '—' }}
                    </span>
                    <div v-if="scoreMods(score).length" class="flex flex-wrap justify-end gap-1">
                      <span v-for="m in scoreMods(score)" :key="m" :class="modBadgeClass(m)">{{ m }}</span>
                    </div>
                    <span v-if="score.deep_stats?.ur != null" class="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/90">
                      ⚡ {{ score.deep_stats.ur.toFixed(1) }} UR
                    </span>
                    </div>
                    <button
                      v-if="score.deep_stats"
                      class="text-zinc-500 group-hover:text-white transition-colors p-2 cursor-pointer"
                      aria-label="Open deep stats"
                      @click.stop="openDetail(score)"
                    >
                      >
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="pinned?.length" class="silky-card rounded-3xl border border-white/15 bg-white/5 p-7 shadow-[0_0_35px_rgba(255,255,255,0.2)] backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-1">
                <p class="text-xs uppercase tracking-[0.24em] text-zinc-400">Pinned Trophies</p>
                <p class="text-lg font-semibold tracking-tight text-white">Your showcase picks</p>
              </div>
            </div>
            <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div
                v-for="score in pinned"
                :key="score.id"
                class="group relative overflow-hidden rounded-2xl border border-white/20 bg-zinc-900/60 p-4 shadow-[0_0_25px_rgba(255,255,255,0.25)] backdrop-blur transition-all duration-500 ease-out hover:-translate-y-1 hover:border-white/40"
              >
                <button
                  v-if="score.deep_stats"
                  class="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-500 backdrop-blur transition hover:border-white/60 hover:text-white hover:shadow-[0_0_14px_rgba(255,255,255,0.6)] cursor-pointer"
                  aria-label="Open deep stats"
                  @click.stop="openDetail(score)"
                >
                  >
                </button>
                <BeatmapCover
                  :id="(score as any).beatmapset?.id || (score as any).beatmap?.beatmapset_id || (score as any).beatmapset_id || (score as any).beatmapsetId || 0"
                  :alt="score.title"
                />
                <div class="absolute inset-0 bg-linear-to-r from-black/85 via-black/65 to-transparent" />
                <div class="relative z-10">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                      <p class="truncate text-sm font-semibold text-white">{{ score.title }}</p>
                      <p class="truncate text-xs text-zinc-400">{{ score.difficulty }}</p>
                    </div>
                    <span :class="rankClass(score.rank)">{{ score.rank || '—' }}</span>
                  </div>
                  <div class="mt-3 flex items-center justify-between gap-3">
                    <span class="text-2xl font-semibold text-white">{{ score.pp != null ? `${Math.round(score.pp)} pp` : '—' }}</span>
                    <span class="text-xs text-zinc-500">{{ score.created_at ? new Date(score.created_at).toLocaleDateString() : '' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'top'" class="space-y-6">
          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Top plays</p>
                <p class="text-lg font-semibold tracking-tight text-white">High-score snapshots</p>
              </div>
            </div>
            <div class="mt-6 space-y-2">
              <div
                v-for="score in best"
                :key="score.id"
                class="relative flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-900/40 px-4 py-3 backdrop-blur transition-all duration-500 ease-out hover:translate-x-1 hover:border-white/30"
              >
                <button
                  v-if="score.deep_stats"
                  class="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-500 backdrop-blur transition hover:border-white/60 hover:text-white hover:shadow-[0_0_14px_rgba(255,255,255,0.6)] cursor-pointer"
                  aria-label="Open deep stats"
                  @click.stop="openDetail(score)"
                >
                  >
                </button>
                <div class="min-w-0 pr-3">
                  <p class="truncate text-sm font-semibold text-white">{{ score.title }}</p>
                  <p class="truncate text-xs text-zinc-500">{{ score.difficulty }}</p>
                </div>
                <div class="flex items-center gap-4 text-sm">
                  <span :class="rankClass(score.rank)">{{ score.rank || '—' }}</span>
                  <span class="text-white font-semibold">{{ score.pp != null ? `${Math.round(score.pp)} pp` : '—' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'history'" class="space-y-6">
          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Most played</p>
                <p class="text-lg font-semibold tracking-tight text-white">Maps you grind the most</p>
              </div>
            </div>
            <div class="mt-6 space-y-3">
              <div
                v-for="mp in mostPlayed"
                :key="mp.id"
                class="space-y-1 rounded-2xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur"
              >
                <div class="flex items-center justify-between text-sm text-white">
                  <span class="truncate">{{ mp.title }} <span class="text-zinc-500">{{ mp.difficulty }}</span></span>
                  <span class="text-zinc-300">
                    {{ mp.playcount.toLocaleString() }} plays · {{ ((mp.playcount / totalPlaycount) * 100).toFixed(1) }}%
                  </span>
                </div>
                <div class="h-2 rounded-full bg-zinc-800">
                  <div
                    class="h-full rounded-full bg-white transition-all duration-500 ease-out"
                    :style="{ width: `${Math.min(100, (mp.playcount / totalPlaycount) * 100).toFixed(1)}%` }"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Activity</p>
                <p class="text-lg font-semibold tracking-tight text-white">Timeline of recent events</p>
              </div>
            </div>
            <div class="mt-6 space-y-4">
              <div class="relative pl-6">
                <div class="absolute left-2 top-0 bottom-0 w-px bg-white/20" />
                <div
                  v-for="ev in activity"
                  :key="ev.id"
                  class="relative mb-5 last:mb-0"
                >
                  <span class="absolute -left-4 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border border-white bg-black" />
                  <div class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
                    <p class="text-sm text-white">{{ ev.text }}</p>
                    <p class="text-xs text-zinc-500">{{ ev.created_at ? new Date(ev.created_at).toISOString().slice(0, 10) : '' }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTab === 'deep'" class="space-y-6">
          <div class="silky-card rounded-3xl border border-white/10 bg-white/5 p-7 backdrop-blur-xl">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Deep Stats</p>
                <p class="text-lg font-semibold tracking-tight text-white">Replays with analysis</p>
              </div>
              <p class="text-xs text-zinc-400">{{ deepScores.length }} analyzed plays</p>
            </div>
            <div class="mt-6 space-y-2">
              <div
                v-for="score in deepScores"
                :key="(score as any).beatmap?.checksum || (score as any).beatmap_md5 || score.id"
                class="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur transition-all duration-500 ease-out hover:-translate-y-px hover:border-white/30 cursor-pointer"
                role="button"
                tabindex="0"
                @click="score.deep_stats && openDetail(score)"
                @keyup.enter="score.deep_stats && openDetail(score)"
              >
                <div class="absolute inset-0 opacity-20">
                  <BeatmapCover
                    :id="(score as any).beatmapset?.id || (score as any).beatmap?.beatmapset_id || (score as any).beatmapset_id || (score as any).beatmapsetId || 0"
                    :alt="scoreTitle(score)"
                  />
                </div>
                <div class="absolute inset-0 bg-linear-to-r from-black/90 via-black/60 to-transparent" />

                <div class="relative z-10 flex items-center justify-between gap-4">
                  <div class="min-w-0 flex-1 space-y-1">
                    <p class="truncate text-sm font-semibold text-white">
                      {{ scoreTitle(score) }}
                    </p>
                    <p class="truncate text-xs text-zinc-400">
                      {{ scoreVersion(score) }}
                    </p>
                    <p class="text-[11px] text-zinc-500">{{ score.created_at ? new Date(score.created_at).toLocaleString() : '' }}</p>
                    <div v-if="score.deep_stats?.hit_errors?.length" class="mt-2">
                      <HitErrorBar :hit-errors="score.deep_stats.hit_errors" />
                    </div>
                  </div>
                  <div class="flex items-center gap-4">
                    <div class="flex flex-col items-end gap-2 text-sm">
                      <span :class="rankClass(score.rank)">{{ score.rank || '—' }}</span>
                      <span class="text-white font-semibold">{{ score.pp != null ? `${Math.round(score.pp)} pp` : '—' }}</span>
                      <div v-if="scoreMods(score).length" class="flex flex-wrap justify-end gap-1">
                        <span v-for="m in scoreMods(score)" :key="m" :class="modBadgeClass(m)">{{ m }}</span>
                      </div>
                      <span v-if="score.deep_stats?.ur != null" class="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/90">
                        ⚡ {{ score.deep_stats.ur.toFixed(1) }} UR
                      </span>
                    </div>
                    <button
                      v-if="score.deep_stats"
                      class="text-zinc-500 group-hover:text-white transition-colors p-2"
                      aria-label="Open deep stats"
                      @click.stop="openDetail(score)"
                    >
                      >
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="silky-in rounded-2xl border border-white/10 bg-zinc-950/80 p-3 backdrop-blur" style="--i: 5">
          <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-300">
            <div class="flex flex-wrap items-center gap-3 min-w-0">
              <div class="inline-flex items-center gap-2 min-w-0">
                <span class="h-2.5 w-2.5 rounded-full shrink-0 pulse-dot" :class="statusMeta.tone === 'live' ? 'bg-emerald-400' : 'bg-sky-400'" />
                <div class="flex flex-col sm:flex-row sm:items-center sm:gap-1 min-w-0">
                  <span class="font-semibold whitespace-nowrap">{{ statusMeta.label }}</span>
                  <span class="text-[11px] text-zinc-200/80 truncate max-w-[18ch] sm:max-w-[28ch]">{{ statusMeta.detail }}</span>
                </div>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-zinc-200 transition-all duration-300 hover:border-white/30 hover:text-white disabled:opacity-60 shrink-0 cursor-pointer"
                :disabled="pending"
                @click="() => refresh()"
                aria-label="Refresh profile"
              >
                <svg v-if="pending" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"></path></svg>
                <span>{{ pending ? 'Refreshing…' : 'Refresh' }}</span>
              </button>
            </div>
            <div class="flex items-center gap-3 flex-wrap justify-end text-zinc-400 sm:text-right text-left">
              <span class="text-xs">osu!dash: {{ appVersion }}</span>
              <span v-if="isDev" class="text-[11px]">Dev Mode: Cache Bypassed</span>
            </div>
          </div>
        </div>

        <Transition name="silky-fade">
          <div v-if="error" class="silky-in rounded-2xl border border-white/15 bg-zinc-900/80 px-4 py-3 text-sm text-rose-200" style="--i: 5">
            {{ (error as any)?.message || 'Unable to reach osu! API; showing mock data.' }}
          </div>
        </Transition>
      </div>
    </div>
  </div>

  <Transition name="silky-slide">
    <div v-if="selectedScore" class="fixed inset-0 z-50 flex items-stretch justify-end bg-black/80 backdrop-blur-md grayscale" @click.self="closeDetail">
      <div class="relative h-full w-full max-w-5xl overflow-y-auto border-l border-white/10 bg-zinc-950/95 px-6 py-8 shadow-2xl">
        <div class="mb-6 flex items-start justify-between gap-4">
          <div class="space-y-2 pr-12">
            <p class="text-lg font-semibold text-white">{{ selectedScore?.title }}</p>
            <p class="text-sm text-zinc-400">{{ selectedScore?.difficulty }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <span :class="rankClass(selectedScore?.rank)">{{ selectedScore?.rank || '—' }}</span>
              <span class="text-white font-semibold">{{ selectedScore?.pp != null ? `${Math.round(selectedScore.pp)} pp` : '—' }}</span>
              <div v-if="selectedScore && scoreMods(selectedScore).length" class="flex flex-wrap items-center gap-1">
                <span v-for="m in scoreMods(selectedScore)" :key="m" :class="modBadgeClass(m)">{{ m }}</span>
              </div>
            </div>
            <div class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">
              <span>⚡ {{ selectedScore?.deep_stats?.ur?.toFixed(1) ?? '—' }} UR</span>
              <span v-if="stressFactor != null" class="text-zinc-300">· Stress {{ stressFactor.toFixed(2) }}</span>
            </div>
          </div>
          <button
            class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:border-white/40"
            @click="closeDetail"
            aria-label="Close detail"
          >
            ✕
          </button>
        </div>

        <div class="mb-4 flex items-center gap-2 text-sm text-white/80">
          <button
            v-for="tab in ['timing', 'stamina', 'choke']"
            :key="tab"
            class="rounded-full border px-3 py-1 transition"
            :class="detailTab === tab ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-transparent text-zinc-400 hover:text-white'"
            @click="detailTab = tab as any"
          >
            {{ tab === 'timing' ? 'Timing' : tab === 'stamina' ? 'Stamina' : 'Choke Point' }}
          </button>
        </div>

        <div v-if="detailTab === 'timing'" class="space-y-3">
          <ReplayChart :errors="detailHitErrors" :stamina="detailStamina" />
        </div>

        <div v-else-if="detailTab === 'stamina'" class="space-y-3">
          <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">BPM Consistency</p>
          <div class="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
            <svg viewBox="0 0 100 40" class="h-40 w-full text-white">
              <polyline
                v-if="staminaSeries.length"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                :points="staminaSeries.map((pt, idx) => {
                  const x = staminaSeries.length === 1 ? 50 : (idx / Math.max(1, staminaSeries.length - 1)) * 100
                  const bpmValues = staminaSeries.map((p) => p.bpm)
                  const maxBpm = Math.max(...bpmValues, 1)
                  const minBpm = Math.min(...bpmValues)
                  const spread = Math.max(1, maxBpm - minBpm)
                  const y = 38 - ((pt.bpm - minBpm) / spread) * 36
                  return `${x.toFixed(2)},${y.toFixed(2)}`
                }).join(' ')"
              />
              <text x="4" y="10" class="fill-zinc-400" font-size="4">{{ Math.round(staminaSeries?.[staminaSeries.length-1]?.bpm || 0) }} BPM now</text>
            </svg>
          </div>
        </div>

        <div v-else class="space-y-3">
          <p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Choke Point Finder</p>
          <div class="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
            <ChokeGraph
              :duration="detailDuration"
              :choke-timestamp="chokeTimestamp"
              :stress-factor="stressFactor"
            />
            <div class="mt-4 space-y-2">
              <p class="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Choke Heatmap</p>
              <div class="relative h-8 w-full overflow-hidden rounded-full border border-white/10 bg-zinc-950/80">
                <div class="absolute inset-0 flex">
                  <div
                    v-for="(b, idx) in heatmapBuckets"
                    :key="idx"
                    class="flex-1"
                    :style="{
                      background: `linear-gradient(0deg, rgba(244,63,94,${(b.variance / maxHeatVariance) * 0.6}) 0%, rgba(244,63,94,${(b.variance / maxHeatVariance) * 0.15}) 100%)`,
                      opacity: idx === hottestBucketIndex ? 1 : 0.8
                    }"
                  />
                </div>
                <div
                  v-if="hottestBucketIndex >= 0"
                  class="absolute inset-y-0 border-l border-r border-rose-300/70 bg-rose-400/10"
                  :style="{
                    left: `${(hottestBucketIndex / Math.max(1, heatmapBuckets.length)) * 100}%`,
                    width: `${100 / Math.max(1, heatmapBuckets.length)}%`
                  }"
                />
              </div>
              <div class="flex justify-between text-[10px] text-zinc-500">
                <span>0s</span>
                <span>{{ detailDuration.toFixed(1) }}s</span>
              </div>
            </div>
            <p class="mt-3 text-sm text-zinc-300">
              <span class="font-semibold text-white">The Heartbreak:</span>
              <span v-if="chokeTimestamp != null"> Around {{ chokeTimestamp.toFixed(1) }}s into the map.</span>
              <span v-else class="text-emerald-300"> No obvious choke detected.</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.silky-slide-enter-active,
.silky-slide-leave-active {
  transition: transform 0.35s ease, opacity 0.35s ease;
}

.silky-slide-enter-from,
.silky-slide-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

.pulse-dot {
  position: relative;
}

.pulse-dot::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 9999px;
  border: 1px solid currentColor;
  opacity: 0.5;
  animation: pulse-ring 2.4s ease-out infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.5; }
  35% { transform: scale(1.8); opacity: 0.15; }
  100% { transform: scale(2.6); opacity: 0; }
}
</style>
