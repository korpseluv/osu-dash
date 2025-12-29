import { defineEventHandler } from 'h3'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const mockUser = {
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
  gradeCounts: { ssh: 2, ss: 14, sh: 8, s: 42, a: 120 },
  source: 'mock' as const
}

const mockRecent = [
  { id: 'r1', title: 'Blue Zenith', difficulty: 'FOUR DIMENSIONS', rank: 'A', pp: 238.5, accuracy: 98.42 },
  { id: 'r2', title: 'Freedom Dive', difficulty: 'Another', rank: 'F', pp: 0, accuracy: 76.13 }
]

const mockBest = [
  { id: 'b1', title: 'The Big Black', difficulty: 'Black Another', rank: 'SS', pp: 412.7, accuracy: 99.31 },
  { id: 'b2', title: 'Hollow Wings', difficulty: 'Recollection', rank: 'S', pp: 368.2, accuracy: 98.77 }
]

const mockMostPlayed = [
  { id: 'm1', title: 'Blue Zenith', difficulty: 'FOUR DIMENSIONS', playcount: 1204 },
  { id: 'm2', title: 'Freedom Dive', difficulty: 'Another', playcount: 987 },
  { id: 'm3', title: 'Hollow Wings', difficulty: 'Recollection', playcount: 612 }
]

const mockPinned: ScoreShape[] = []
const mockFirsts: ScoreShape[] = []
const mockActivity = [
  { id: 'a1', type: 'medal', text: 'Unlocked medal: Medal of Tenacity', created_at: '2024-06-01T00:00:00Z' },
  { id: 'a2', type: 'play', text: 'Set a new top play on Galaxy Collapse', created_at: '2024-06-03T00:00:00Z' }
]

type UserShape = {
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
  source: 'live' | 'mock' | 'cached'
}

type ScoreShape = {
  id: string | number
  title: string
  difficulty: string
  rank: string
  pp?: number | null
  accuracy?: number | null
  score?: number | null
  created_at?: string
  beatmap_md5?: string | null
  beatmap?: {
    checksum?: string | null
    title?: string | null
    version?: string | null
    id?: number | string | null
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
  }
}

type MostPlayedShape = {
  id: string | number
  title: string
  difficulty: string
  playcount: number
}

type ActivityShape = {
  id: string | number
  type: string
  text: string
  created_at?: string
}

type ApiPayload = {
  user: UserShape
  recent: ScoreShape[]
  best: ScoreShape[]
  pinned: ScoreShape[]
  firsts: ScoreShape[]
  most_played: MostPlayedShape[]
  activity: ActivityShape[]
  errors?: string[]
  last_updated?: number
  source: 'live' | 'mock' | 'cached'
}

type TokenResponse = {
  access_token?: string
  token_type?: string
  expires_in?: number
}

type OsuProfile = {
  username?: string
  avatar_url?: string
  country_code?: string
  is_online?: boolean
  statistics?: {
    global_rank?: number
    pp?: number
    play_count?: number
    hit_accuracy?: number
    country_rank?: number
    grade_counts?: {
      ssh?: number
      ss?: number
      sh?: number
      s?: number
      a?: number
    }
  }
  rank_history?: { data?: number[] }
}

function mapProfile(profile: OsuProfile | null | undefined, targetUser: string): UserShape | null {
  if (!profile) return null
  const stats = profile.statistics || {}
  const mapped: UserShape = {
    username: profile.username || targetUser,
    avatar: profile.avatar_url || '',
    rank: stats.global_rank ?? 0,
    pp: stats.pp ?? 0,
    playcount: stats.play_count ?? 0,
    country: profile.country_code || '',
    online: profile.is_online ?? false,
    accuracy: stats.hit_accuracy ?? null,
    countryRank: stats.country_rank ?? null,
    rankHistory: profile.rank_history?.data?.length ? profile.rank_history.data : [],
    gradeCounts: stats.grade_counts ?? {},
    source: 'live'
  }

  if (mapped.pp == null || mapped.playcount == null || mapped.rank == null) return null
  return mapped
}

async function fetchToken(clientId: string, clientSecret: string) {
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'public'
    })

    const token = await $fetch<TokenResponse>('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    return token.access_token || null
  } catch (err) {
    console.error('osu token exchange failed', err)
    return null
  }
}

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const clientId = config.osuClientId
  const clientSecret = config.osuClientSecret
  const apiBase = config.public.osuApiBase || 'https://osu.ppy.sh/api/v2'
  const targetUser = config.osuTargetUser || config.public.osuTargetUser || 'chlokun'
  const isDev = process.env.NODE_ENV !== 'production'

  const fallback: ApiPayload = {
    user: { ...mockUser, username: targetUser },
    recent: mockRecent,
    best: mockBest,
    pinned: mockPinned,
    firsts: mockFirsts,
    most_played: mockMostPlayed,
    activity: mockActivity,
    errors: [],
    last_updated: Date.now(),
    source: 'mock'
  }

  const cachePath = path.resolve(process.cwd(), 'data', 'profile-cache.json')
  const historyPath = path.resolve(process.cwd(), 'data', 'score-history.json')

  const readCache = async (): Promise<ApiPayload | null> => {
    try {
      const raw = await fs.readFile(cachePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed.payload as ApiPayload
    } catch (err) {
      return null
    }
  }

  const writeCache = async (payload: ApiPayload) => {
    try {
      const dir = path.dirname(cachePath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(cachePath, JSON.stringify({ last_updated: payload.last_updated, payload }, null, 2), 'utf8')
    } catch (err) {
      console.error('[API Error] Failed to write cache', err)
    }
  }

  const readHistory = async (): Promise<ScoreShape[]> => {
    try {
      const raw = await fs.readFile(historyPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
    } catch (err) {
      return []
    }
  }

  const writeHistory = async (history: ScoreShape[]) => {
    try {
      const dir = path.dirname(historyPath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf8')
    } catch (err) {
      console.error('[API Error] Failed to write score history', err)
    }
  }

  const cached = await readCache()
  const cacheFresh = cached?.last_updated && Date.now() - cached.last_updated < 10 * 60 * 1000
  if (!isDev && cacheFresh && cached) {
    const history = await readHistory()
    const recentHistory = history.length ? history : cached.recent || []
    return { ...cached, recent: recentHistory, source: 'cached' }
  }

  if (!clientId || !clientSecret) {
    console.error('[API Error] Missing client credentials')
    return fallback
  }

  try {
    const token = await fetchToken(clientId, clientSecret)
    if (!token) {
      console.error('[API Error] Token exchange failed')
      return fallback
    }

    const headers = { Authorization: `Bearer ${token}` }
    console.log(`[OSU-API] Resolving user id for ${targetUser}...`)

    const profileByName = await $fetch<OsuProfile>(`${apiBase}/users/${targetUser}/osu`, {
      headers,
      query: { key: 'username' }
    }).catch((err) => {
      console.error('[API Error] profile by username failed', err)
      return null
    })

    const numericId = profileByName?.statistics ? (profileByName as any).id ?? null : (profileByName as any)?.id ?? null
    if (!numericId) {
      console.error('[API Error] No numeric id resolved')
      return fallback
    }

    const results = await Promise.allSettled([
      Promise.resolve(profileByName),
      $fetch<any[]>(`${apiBase}/users/${numericId}/scores/recent`, { query: { include_fails: 1, limit: 50 }, headers }),
      $fetch<any[]>(`${apiBase}/users/${numericId}/scores/best`, { query: { limit: 100 }, headers }),
      $fetch<any[]>(`${apiBase}/users/${numericId}/scores/firsts`, { query: { limit: 5 }, headers }),
      $fetch<any[]>(`${apiBase}/users/${numericId}/scores/pinned`, { query: { limit: 10 }, headers }),
      $fetch<any[]>(`${apiBase}/users/${numericId}/beatmapsets/most_played`, { query: { limit: 10 }, headers }),
      $fetch<any[]>(`${apiBase}/users/${numericId}/recent_activity`, { query: { limit: 20 }, headers })
    ])

    const [profileRes, recentRes, bestRes, pinnedRes, firstsRes, mostPlayedRes, activityRes] = results

    const errors: string[] = []

    const extract = <T>(res: PromiseSettledResult<T>, label: string): T | null => {
      if (res.status === 'fulfilled') return res.value
      const reason: any = (res as any).reason
      const detail = reason?.response?.status || reason?.status || reason?.message || reason
      console.error(`[API Error] ${label} failed:`, detail)
      errors.push(`Failed to load ${label}`)
      return null
    }

    const profile = extract<OsuProfile | null>(profileRes as PromiseSettledResult<OsuProfile>, 'profile')
    const recent = extract<any[]>(recentRes as PromiseSettledResult<any[]>, 'recent')
    const best = extract<any[]>(bestRes as PromiseSettledResult<any[]>, 'best')
    const firsts = extract<any[]>(firstsRes as PromiseSettledResult<any[]>, 'firsts')
    const pinned = extract<any[]>(pinnedRes as PromiseSettledResult<any[]>, 'pinned')
    const mostPlayed = extract<any[]>(mostPlayedRes as PromiseSettledResult<any[]>, 'most_played')
    const activity = extract<any[]>(activityRes as PromiseSettledResult<any[]>, 'activity')

    const mappedUser = mapProfile(profile, targetUser)
    if (!mappedUser) {
      errors.push('Failed to load profile')
      return { ...fallback, errors }
    }

    const mapScore = (s: any): ScoreShape => {
      const scoreRaw = typeof s.score === 'number' ? s.score : null
      const totalScoreRaw = typeof s.total_score === 'number' ? s.total_score : null
      const finalScore = scoreRaw && scoreRaw > 0 ? scoreRaw : totalScoreRaw

      return {
      id: s.id ?? s.score_id ?? crypto.randomUUID?.() ?? Math.random(),
      title: s.beatmapset?.title || 'Unknown map',
      difficulty: s.beatmap?.version || '—',
      rank: s.rank || '—',
      pp: typeof s.pp === 'number' ? s.pp : null,
      accuracy: typeof s.accuracy === 'number' ? Math.round(s.accuracy * 10000) / 100 : null,
      // v2 API sometimes has score=0; enforce total_score when score is missing/0
      score: typeof finalScore === 'number' ? finalScore : null,
      created_at: s.created_at,
      beatmap_md5: s.beatmap?.checksum || s.beatmap?.md5 || null,
      beatmap: {
        checksum: s.beatmap?.checksum || s.beatmap?.md5 || null,
        title: s.beatmap?.title || s.beatmapset?.title || null,
        version: s.beatmap?.version || null,
        id: s.beatmap?.id ?? s.beatmap_id ?? null
      },
      beatmapset: s.beatmapset
        ? {
            id: s.beatmapset?.id ?? null,
            title: s.beatmapset?.title ?? null,
            artist: s.beatmapset?.artist ?? null,
            creator: s.beatmapset?.creator ?? null,
            covers: s.beatmapset?.covers ?? null
          }
        : undefined,
      deep_stats: s.deep_stats // preserve if already present in history merge
      }
    }

    const mapMostPlayed = (s: any): MostPlayedShape => ({
      id: s.beatmap?.id ?? s.beatmap_id ?? crypto.randomUUID?.() ?? Math.random(),
      title: s.beatmapset?.title || 'Unknown map',
      difficulty: s.beatmap?.version || '—',
      playcount: s.count ?? s.play_count ?? 0
    })

    const mapActivity = (ev: any): ActivityShape => {
      const label = ev?.achievement?.name || ev?.beatmap?.title || ev?.beatmapset?.title || ev?.rank || ev?.type || 'Activity'
      return {
        id: ev.id ?? crypto.randomUUID?.() ?? Math.random(),
        type: ev.type || 'event',
        text: typeof label === 'string' ? label.replace(/_/g, ' ') : 'Recent activity',
        created_at: ev.created_at
      }
    }
    const recentScoresNew = Array.isArray(recent) ? recent.map(mapScore) : []
    const bestScores = Array.isArray(best) ? best.map(mapScore) : []
    const pinnedScores = Array.isArray(pinned) ? pinned.map(mapScore) : []
    const firstScores = Array.isArray(firsts) ? firsts.map(mapScore) : []
    const mostPlayedScores = Array.isArray(mostPlayed) ? mostPlayed.map(mapMostPlayed) : []
    const activityEvents = Array.isArray(activity) ? activity.map(mapActivity) : []

    const mergeHistory = (history: ScoreShape[], fresh: ScoreShape[]) => {
      const combined = [...history, ...fresh]
      const seen = new Set<string>()
      const deduped: ScoreShape[] = []
      for (const s of combined) {
        const key = String(s.id ?? '')
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(s)
      }
      return deduped.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        return tb - ta
      })
    }

    const attachDeepStats = (list: ScoreShape[], history: ScoreShape[]) => {
      const byChecksum = new Map<string, ScoreShape>()
      history.forEach((s) => {
        const h = (s.beatmap?.checksum || s.beatmap_md5 || '').toLowerCase()
        if (h) byChecksum.set(h, s)
      })

      return list.map((s) => {
        const checksum = (s.beatmap?.checksum || s.beatmap_md5 || '').toLowerCase()
        let matched: ScoreShape | undefined
        if (checksum && byChecksum.has(checksum)) {
          matched = byChecksum.get(checksum)
        } else {
          matched = history.find((h) => {
            const sameId = h.id === s.id
            const sameTitle = (h.title || '').toLowerCase() === (s.title || '').toLowerCase()
            const sameDiff = (h.difficulty || '').toLowerCase() === (s.difficulty || '').toLowerCase()
            return sameId || (sameTitle && sameDiff)
          })
        }

        if (matched?.deep_stats) {
          return {
            ...s,
            deep_stats: matched.deep_stats,
            beatmap_md5: matched.beatmap_md5 || s.beatmap_md5,
            beatmap: matched.beatmap || s.beatmap,
            beatmapset: matched.beatmapset || s.beatmapset
          }
        }
        return s
      })
    }

    const existingHistory = await readHistory()
    const mergedRecent = mergeHistory(existingHistory, recentScoresNew)
    await writeHistory(mergedRecent)

    const enrichedBest = attachDeepStats(bestScores, mergedRecent)
    const enrichedPinned = attachDeepStats(pinnedScores, mergedRecent)
    const enrichedFirsts = attachDeepStats(firstScores, mergedRecent)

    const freshPayload: ApiPayload = {
      user: mappedUser,
      recent: mergedRecent,
      best: enrichedBest,
      pinned: enrichedPinned,
      firsts: enrichedFirsts,
      most_played: mostPlayedScores,
      activity: activityEvents,
      errors,
      last_updated: Date.now(),
      source: mappedUser.source
    }

    await writeCache(freshPayload)
    return freshPayload
  } catch (err) {
    console.error('[API Error] osu user fetch failed', err)
    return { ...fallback, errors: ['Failed to load profile'], last_updated: Date.now() }
  }
})
