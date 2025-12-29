import { useRuntimeConfig } from '#imports'
import { promises as fsp } from 'node:fs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { BeatmapDecoder, ScoreDecoder } from 'osu-parsers'
import { $fetch } from 'ofetch'

const HISTORY_PATH = path.resolve(process.cwd(), 'data', 'score-history.json')
const CACHE_PATH = path.resolve(process.cwd(), 'data', 'replay-cache.json')
const DEFAULT_REPLAY_DIR = path.resolve(process.env.HOME || process.cwd(), 'Library', 'Application Support', 'osu!', 'Data', 'r')
const DEFAULT_FILES_DIR = path.resolve(process.env.HOME || process.cwd(), 'Library', 'Application Support', 'osu', 'files')

const beatmapContentCache = new Map<number, string>()

const beatmapLocalPathCacheByHash = new Map<string, string>()

// In-memory processed sets (reset by /api/deep-wipe)
let processedHashes: Set<string> = (globalThis as any).__osu_dash_processedHashes
  ? (globalThis as any).__osu_dash_processedHashes
  : new Set<string>()
let processedFiles: Set<string> = (globalThis as any).__osu_dash_processedFiles
  ? (globalThis as any).__osu_dash_processedFiles
  : new Set<string>()
;(globalThis as any).__osu_dash_processedHashes = processedHashes
;(globalThis as any).__osu_dash_processedFiles = processedFiles

let processedCounter: number = (globalThis as any).__osu_dash_processedCounter || 0

function resetWatcherMemory() {
  processedHashes = new Set<string>()
  processedFiles = new Set<string>()
  processedCounter = 0
  ;(globalThis as any).__osu_dash_processedHashes = processedHashes
  ;(globalThis as any).__osu_dash_processedFiles = processedFiles
  ;(globalThis as any).__osu_dash_processedCounter = processedCounter
}

;(globalThis as any).__osu_dash_resetWatcherMemory = resetWatcherMemory

function isValidBeatmapHash(hash: string | null | undefined): hash is string {
  if (!hash) return false
  const h = String(hash).toLowerCase()
  return /^[0-9a-f]{32}$/.test(h)
}

function isProbablyBinary(buf: Buffer): boolean {
  // Heuristic: .osu should be plain text with no NULs and mostly printable bytes.
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024))
  if (!sample.length) return true
  let suspicious = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!
    if (b === 0) return true
    const isWhitespace = b === 9 || b === 10 || b === 13
    const isPrintableAscii = b >= 32 && b <= 126
    if (!isWhitespace && !isPrintableAscii) suspicious += 1
  }
  return suspicious / sample.length > 0.2
}

async function readOsuTextFileIfValid(filePath: string): Promise<string | null> {
  try {
    const fh = await fsp.open(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(64 * 1024)
      const { bytesRead } = await fh.read(buf, 0, buf.byteLength, 0)
      const headBuf = buf.subarray(0, bytesRead)
      if (isProbablyBinary(headBuf)) return null

      const head = headBuf.toString('utf8')
      // Most .osu files start with: "osu file format vXX".
      if (!head.includes('osu file format v')) return null

      const full = await fsp.readFile(filePath, 'utf8')
      return full && full.trim() ? full : null
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

async function findLocalBeatmapContentByHash(filesDir: string, beatmapHash: string): Promise<string | null> {
  const hash = String(beatmapHash || '').toLowerCase()
  if (!isValidBeatmapHash(hash)) return null
  if (!filesDir) return null

  const cachedPath = beatmapLocalPathCacheByHash.get(hash)
  if (cachedPath) {
    const content = await readOsuTextFileIfValid(cachedPath)
    if (content) return content
    beatmapLocalPathCacheByHash.delete(hash)
  }

  const candidates = [
    path.join(filesDir, hash.substring(0, 1), hash.substring(0, 2), hash),
    path.join(filesDir, hash)
  ]

  for (const candidate of candidates) {
    try {
      const st = await fsp.stat(candidate)
      if (!st.isFile()) continue
      const content = await readOsuTextFileIfValid(candidate)
      if (content) {
        beatmapLocalPathCacheByHash.set(hash, candidate)
        return content
      }

      // Found a file, but it doesn't look like a text .osu (likely audio/image/etc)
      console.warn('[Replay Watcher] Local hash file exists but is not a valid .osu text file', {
        hash,
        candidate
      })
    } catch {
      // candidate missing/unreadable
    }
  }

  return null
}

async function fetchMapContent(beatmapId: number): Promise<string | null> {
  if (!Number.isFinite(beatmapId) || beatmapId <= 0) return null
  if (beatmapContentCache.has(beatmapId)) return beatmapContentCache.get(beatmapId) || null

  try {
    const content = await $fetch<string>(`https://osu.ppy.sh/osu/${beatmapId}`, {
      // ofetch supports text responseType; keep it tolerant across versions
      responseType: 'text' as any,
      headers: {
        'User-Agent': 'osu-dash/0.1 (jit-beatmap-fetch)'
      }
    })
    if (typeof content !== 'string' || !content.trim()) return null
    beatmapContentCache.set(beatmapId, content)
    return content
  } catch (err) {
    console.warn('[Replay Watcher] Failed to fetch beatmap content', { beatmapId, err })
    return null
  }
}

async function fetchBeatmapContentJit(options: {
  filesDir?: string | null
  beatmapId: number
  beatmapHash?: string | null
}): Promise<string | null> {
  const local = options.filesDir && isValidBeatmapHash(options.beatmapHash)
    ? await findLocalBeatmapContentByHash(options.filesDir, options.beatmapHash)
    : null

  if (local) {
    console.log('[Replay Watcher] Loaded beatmap from local lazer files folder', {
      beatmapId: options.beatmapId,
      hash: options.beatmapHash
    })
    return local
  }
  const remote = await fetchMapContent(options.beatmapId)
  if (remote) {
    console.log('[Replay Watcher] Fetched beatmap from osu.ppy.sh', { beatmapId: options.beatmapId })
  }
  return remote
}

async function loadHistory(): Promise<any[]> {
  try {
    const raw = await fsp.readFile(HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveHistory(history: any[]) {
  const dir = path.dirname(HISTORY_PATH)
  await fsp.mkdir(dir, { recursive: true })
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), { encoding: 'utf8', flag: 'w' })
}

async function fetchToken(clientId: string | undefined, clientSecret: string | undefined) {
  if (!clientId || !clientSecret) return null
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'public'
    })

    const token = await $fetch<{ access_token?: string }>('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    return token.access_token || null
  } catch (err) {
    console.error('[Replay Watcher] Token exchange failed', err)
    return null
  }
}

async function fetchUserId(apiBase: string, token: string, username: string) {
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const res = await $fetch<any>(`${apiBase}/users/${encodeURIComponent(username)}/osu`, {
      query: { key: 'username' },
      headers
    })
    return res?.id ?? null
  } catch (err) {
    console.error('[Replay Watcher] Fetch user id failed', err)
    return null
  }
}

async function fetchRecentScores(apiBase: string, token: string, userId: string | number | null) {
  if (!userId) return []
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const res = await $fetch<any[]>(`${apiBase}/users/${userId}/scores/recent`, {
      query: { include_fails: 1, limit: 50 },
      headers
    })
    return Array.isArray(res) ? res : []
  } catch (err) {
    console.error('[Replay Watcher] Fetch recent scores failed', err)
    return []
  }
}

async function loadCache(): Promise<Record<string, any>> {
  try {
    const raw = await fsp.readFile(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function saveCache(cache: Record<string, any>) {
  const dir = path.dirname(CACHE_PATH)
  await fsp.mkdir(dir, { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), { encoding: 'utf8', flag: 'w' })
}

function extractBeatmapHash(score: any, filePath: string): string | null {
  const info = score?.info || score?.scoreInfo || score?.metadata
  const direct =
    info?.beatmapHash ||
    info?.beatmapHashMD5 ||
    info?.beatmapMd5 ||
    info?.beatmap_md5 ||
    info?.beatmap_checksum ||
    score?.beatmap_hash ||
    score?.beatmapHash ||
    score?.beatmapMd5 ||
    score?.hash ||
    score?.md5 ||
    null

  if (direct && direct !== 'n/a') return direct

  // Fallback: use filename (osu!lazer exports often embed map name)
  const fileName = path.basename(filePath, path.extname(filePath))
  return fileName || null
}

function normalizeTimestampMs(ts: number | string | Date | null | undefined): number | null {
  if (ts == null) return null
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof ts === 'number') {
    // If seconds, scale to ms
    return ts < 1e12 ? ts * 1000 : ts
  }
  return null
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function stringHash32(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function gaussian(rand: () => number): number {
  // Box–Muller transform
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function computeStd(values: number[]): number | null {
  if (!values.length) return null
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

type ReplayHits = {
  count300: number
  count100: number
  count50: number
  countMiss: number
  countGeki?: number
  countKatu?: number
}

function clampInt(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.trunc(v))
}

function readReplayHits(score: any): ReplayHits {
  const info = score?.info || score?.scoreInfo || score?.metadata || {}
  const source = info?.statistics || info?.hitCounts || info?.hits || info

  return {
    count300: clampInt(source?.count300 ?? source?.count_300 ?? source?.n300 ?? source?.perfect ?? source?.hit300),
    count100: clampInt(source?.count100 ?? source?.count_100 ?? source?.n100 ?? source?.good ?? source?.hit100),
    count50: clampInt(source?.count50 ?? source?.count_50 ?? source?.n50 ?? source?.meh ?? source?.hit50),
    countMiss: clampInt(source?.countMiss ?? source?.count_miss ?? source?.nmiss ?? source?.miss ?? source?.hitMiss),
    countGeki: clampInt(source?.countGeki ?? source?.count_geki ?? source?.ngeki ?? source?.geki),
    countKatu: clampInt(source?.countKatu ?? source?.count_katu ?? source?.nkatu ?? source?.katu)
  }
}

function readReplayMods(score: any): number {
  const info = score?.info || score?.scoreInfo || score?.metadata || {}
  return clampInt(info?.mods ?? info?.mod ?? score?.mods ?? score?.mod)
}

function calculateAccuracy(h: ReplayHits): number {
  const totalHits = h.count300 + h.count100 + h.count50 + h.countMiss
  if (!totalHits) return 0
  const numerator = 300 * h.count300 + 100 * h.count100 + 50 * h.count50
  return (numerator / (300 * totalHits)) * 100
}

function calculateRank(h: ReplayHits, mods: number): string {
  const totalHits = h.count300 + h.count100 + h.count50 + h.countMiss
  const accPct = calculateAccuracy(h)
  const ratio300 = totalHits ? h.count300 / totalHits : 0
  const ratio50 = totalHits ? h.count50 / totalHits : 0
  const hasMiss = h.countMiss > 0

  let base: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D'
  if (!hasMiss && accPct >= 100 - 1e-9) {
    base = 'SS'
  } else if (!hasMiss && ratio300 > 0.9 && ratio50 < 0.01) {
    base = 'S'
  } else if ((ratio300 > 0.8 && !hasMiss) || ratio300 > 0.9) {
    base = 'A'
  } else if ((ratio300 > 0.7 && !hasMiss) || ratio300 > 0.8) {
    base = 'B'
  } else if (ratio300 > 0.6) {
    base = 'C'
  } else {
    base = 'D'
  }

  // Silver grades when using HD (8) or FL (1024)
  const MOD_HD = 8
  const MOD_FL = 1024
  const silver = (mods & MOD_HD) !== 0 || (mods & MOD_FL) !== 0
  if (silver && base === 'SS') return 'SSH'
  if (silver && base === 'S') return 'SH'
  return base
}

type ApiBeatmapLookup = {
  id?: number
  checksum?: string
  version?: string
  title?: string
  beatmapset_id?: number
  beatmapset?: {
    id?: number
    title?: string
    artist?: string
    creator?: string
    covers?: Record<string, string>
  }
}

type ApiUserBeatmapScore = {
  position?: number
  score?: any
}

async function getApiScore(options: {
  apiBase: string
  token: string
  beatmapHash: string
  userId: string | number
}): Promise<{ beatmap: ApiBeatmapLookup | null; score: any | null }> {
  const headers = { Authorization: `Bearer ${options.token}` }
  let beatmap: ApiBeatmapLookup | null = null

  try {
    beatmap = await $fetch<ApiBeatmapLookup>(`${options.apiBase}/beatmaps/lookup`, {
      headers,
      query: { checksum: options.beatmapHash }
    })
  } catch (err) {
    // Not fatal; we can still ghost.
    beatmap = null
  }

  const beatmapId = beatmap?.id
  if (!beatmapId) return { beatmap, score: null }

  try {
    const res = await $fetch<ApiUserBeatmapScore>(`${options.apiBase}/beatmaps/${beatmapId}/scores/users/${options.userId}`, {
      headers
    })

    const s = (res as any)?.score ?? (res as any)
    return { beatmap, score: s && typeof s === 'object' ? s : null }
  } catch {
    return { beatmap, score: null }
  }
}

function extractKeyPressTimesFromFrames(frames: any[]): number[] {
  // Legacy replay frames expose `startTime` and `buttonState` (bitmask).
  // We approximate a "hit" as a transition from no-key to any-key pressed.
  const pressTimes: number[] = []
  const keyMask = 1 | 2 | 4 | 8
  let prevDown = false

  for (const frame of frames) {
    const t = frame?.startTime
    const state = frame?.buttonState
    if (!Number.isFinite(t) || !Number.isFinite(state)) continue
    const down = (state & keyMask) !== 0
    if (down && !prevDown) {
      pressTimes.push(Number(t))
    }
    prevDown = down
  }

  return pressTimes
}

function extractActionTimesFromFrames(frames: any[]): number[] {
  // Replay frames may store either absolute `time` or delta `startTime`.
  // We normalize into cumulative ms timestamps for key down transitions.
  const pressTimes: number[] = []
  const keyMask = 1 | 2 | 4 | 8
  let prevDown = false
  let cumulative = 0

  for (const frame of frames) {
    let t: number | null = null
    if (Number.isFinite(frame?.time)) {
      t = Number(frame.time)
      cumulative = t
    } else if (Number.isFinite(frame?.startTime)) {
      cumulative += Number(frame.startTime)
      t = cumulative
    }

    const state = frame?.buttonState
    if (t == null || !Number.isFinite(state)) continue

    const down = (state & keyMask) !== 0
    if (t >= 0 && down && !prevDown) {
      pressTimes.push(t)
    }
    prevDown = down
  }

  return pressTimes
}

function readBeatmapIdFromMatch(match: any): number | null {
  const raw = match?.beatmap?.id ?? match?.beatmap_id ?? match?.beatmapId ?? null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function readHitObjectTimeMs(obj: any): number | null {
  const raw = obj?.startTime ?? obj?.time ?? obj?.start_time ?? obj?.start_time_ms ?? null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

const HIT_WINDOW = 200
const INTRO_CLIP_MS = 500
const FIRST_NOTE_LOCK_WINDOW = 500
const REST_HIT_WINDOW = 100

const MOD_BITMASK: Record<number, string> = {
  1: 'NF',
  2: 'EZ',
  4: 'TD',
  8: 'HD',
  16: 'HR',
  32: 'SD',
  64: 'DT',
  128: 'RL',
  256: 'HT',
  512: 'NC',
  1024: 'FL',
  2048: 'AT',
  4096: 'SO',
  8192: 'AP',
  16384: 'PF'
}

function modsToArray(mods: number): string[] {
  if (!mods) return []
  const out: string[] = []
  for (const [maskRaw, label] of Object.entries(MOD_BITMASK)) {
    const mask = Number(maskRaw)
    if ((mods & mask) !== 0) out.push(label)
  }
  // NC implies DT; keep only NC to avoid duplicate badge
  if (out.includes('NC')) return out.filter((m) => m !== 'DT')
  return out
}

function parseLifeBarEndPercent(lifeBar: unknown): number | null {
  // osu! replay life bar is typically a string like: "time|life,time|life,..." where life is 0..1.
  if (!lifeBar) return null

  if (Array.isArray(lifeBar)) {
    const last = lifeBar.at(-1)
    const v = (last as any)?.life ?? (last as any)?.value ?? (last as any)?.hp ?? null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }

  if (typeof lifeBar === 'string') {
    const parts = lifeBar.split(',').map((p) => p.trim()).filter(Boolean)
    if (!parts.length) return null
    const last = parts[parts.length - 1]!
    const seg = last.split('|')
    if (seg.length < 2) return null
    const n = Number(seg[1])
    return Number.isFinite(n) ? n : null
  }

  return null
}

function normalizeReplayRank(rankRaw: unknown): string | null {
  if (rankRaw == null) return null

  if (typeof rankRaw === 'string') {
    const r = rankRaw.trim().toUpperCase()
    const normalized = r === 'XH' ? 'SSH' : r === 'X' ? 'SS' : r
    const allowed = new Set(['SSH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'])
    return allowed.has(normalized) ? normalized : null
  }

  const n = typeof rankRaw === 'number' ? rankRaw : Number(rankRaw)
  if (!Number.isFinite(n)) return null

  // osu! replay grade byte ordering (common): 0..8 => SSH, SS, SH, S, A, B, C, D, F
  const table = ['SSH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F']
  const idx = Math.trunc(n)
  return idx >= 0 && idx < table.length ? table[idx]! : null
}

function computeTrueHitErrors(
  map: any,
  actionTimes: number[],
  windowMs = HIT_WINDOW
): { hitErrors: number[]; trace: { time: number; offset: number }[]; lockOnOffsetMs: number | null } {
  const hitObjects = Array.isArray(map?.hitObjects) ? map.hitObjects : Array.isArray(map?.hit_objects) ? map.hit_objects : []
  const objectTimes: number[] = hitObjects
    .map(readHitObjectTimeMs)
    .filter((t: number | null): t is number => t != null)
    .sort((a: number, b: number) => a - b)

  const actionsAll = (actionTimes || []).filter((t) => Number.isFinite(t)).slice().sort((a, b) => a - b)
  const hitErrors: number[] = []
  const trace: { time: number; offset: number }[] = []
  if (!objectTimes.length || !actionsAll.length) return { hitErrors, trace, lockOnOffsetMs: null }

  const firstObjectTime = objectTimes[0]!
  const lastObjectTime = objectTimes[objectTimes.length - 1]!

  // Intro/outro clipping: ignore actions outside the hitobject window.
  const actions = actionsAll.filter((t) => t >= firstObjectTime - INTRO_CLIP_MS && t <= lastObjectTime)
  if (!actions.length) return { hitErrors, trace, lockOnOffsetMs: null }

  // First-note lock-on: find the closest action within +/- 500ms to establish a global offset.
  let lockOnOffsetMs: number | null = null
  let lockOnActionIndex = -1
  {
    let bestAbs = Number.POSITIVE_INFINITY
    for (let j = 0; j < actions.length; j++) {
      const at = actions[j]!
      if (at < firstObjectTime - FIRST_NOTE_LOCK_WINDOW) continue
      if (at > firstObjectTime + FIRST_NOTE_LOCK_WINDOW) break
      const diff = at - firstObjectTime
      const abs = Math.abs(diff)
      if (abs < bestAbs) {
        bestAbs = abs
        lockOnOffsetMs = diff
        lockOnActionIndex = j
      }
    }
  }

  if (lockOnOffsetMs == null || lockOnActionIndex < 0) return { hitErrors, trace, lockOnOffsetMs: null }

  // Record first note hit using the locked-on action.
  hitErrors.push(lockOnOffsetMs)
  trace.push({ time: firstObjectTime, offset: lockOnOffsetMs })

  let ai = lockOnActionIndex + 1
  for (let oi = 1; oi < objectTimes.length; oi++) {
    const objectTime = objectTimes[oi]!
    const expectedTime = objectTime + lockOnOffsetMs

    while (ai < actions.length && actions[ai]! < expectedTime - REST_HIT_WINDOW) ai++
    if (ai >= actions.length) break

    let bestIdx = -1
    let bestAbs = Number.POSITIVE_INFINITY
    let bestDiff = 0

    for (let j = ai; j < actions.length; j++) {
      const at = actions[j]!
      if (at > expectedTime + REST_HIT_WINDOW) break
      const diffShifted = at - expectedTime
      const diffRaw = at - objectTime
      const abs = Math.abs(diffShifted)
      if (abs < bestAbs) {
        bestAbs = abs
        bestIdx = j
        bestDiff = diffRaw
      }
    }

    if (bestIdx >= 0) {
      hitErrors.push(bestDiff)
      trace.push({ time: objectTime, offset: bestDiff })
      ai = bestIdx + 1 // consume the action
    }
  }

  return { hitErrors, trace, lockOnOffsetMs }
}

function isSpeedUpPlay(entry: any, mods: number): boolean {
  const MOD_DT = 64
  const MOD_NC = 512
  const hasDt = (mods & MOD_DT) !== 0 || (mods & MOD_NC) !== 0
  const diff = String(entry?.difficulty || entry?.beatmap?.version || '').toLowerCase()
  const title = String(entry?.title || '').toLowerCase()
  const hasSpedUpName = diff.includes('sped up') || title.includes('sped up')
  return hasDt || hasSpedUpName
}

function buildIntervals(times: number[]): number[] {
  const intervals: number[] = []
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1]
    if (!Number.isFinite(dt)) continue
    // Filter out obviously bad values: ultra-fast repeats & long breaks.
    if (dt < 10 || dt > 2000) continue
    intervals.push(dt)
  }
  return intervals
}

function computeUrFromIntervals(intervals: number[]): number | null {
  const std = computeStd(intervals)
  if (std == null) return null
  // Temporary UR proxy (until we have beatmap hitobject timing): stddev(click intervals) * 10
  return Math.round(std * 10 * 10) / 10
}

function generateMockHitErrors(intervals: number[], seedKey: string): number[] {
  // Temporary visual filler until we can compare replay presses vs hitobject timings.
  // Width is derived from interval jitter, but clamped to a readable range.
  const rand = mulberry32(stringHash32(seedKey))
  const std = computeStd(intervals) ?? 0
  const sigma = Math.min(25, Math.max(4, std * 0.35))
  const count = Math.min(500, Math.max(120, intervals.length || 0))

  const errors: number[] = []
  for (let i = 0; i < count; i++) {
    const v = gaussian(rand) * sigma
    errors.push(Math.max(-50, Math.min(50, Math.round(v))))
  }
  return errors
}

function extractHitErrorsFromFrames(frames: any[]): { offsets: number[]; trace: { time: number; offset: number }[] } {
  const offsets: number[] = []
  const trace: { time: number; offset: number }[] = []
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    // Only accept explicit hit error fields.
    // DO NOT fall back to generic deltas/timeDiff/etc (those are usually frame timing / input intervals and will inflate UR).
    const val = frame?.hitError ?? frame?.hit_error
    const time = Number.isFinite(frame?.time) ? frame.time : i * 16
    if (Number.isFinite(val)) {
      offsets.push(val)
      trace.push({ time, offset: val })
    }
  }
  return { offsets, trace }
}

function buildHistogram(hitErrors: number[], bins = 24): { x0: number; x1: number; count: number }[] {
  if (!hitErrors.length || bins <= 0) return []
  const maxAbs = Math.max(50, Math.ceil(Math.max(...hitErrors.map((v) => Math.abs(v))) / 10) * 10)
  const binWidth = (maxAbs * 2) / bins
  const buckets = Array.from({ length: bins }, (_, i) => ({
    x0: -maxAbs + i * binWidth,
    x1: -maxAbs + (i + 1) * binWidth,
    count: 0
  }))

  for (const v of hitErrors) {
    const clamped = Math.max(-maxAbs, Math.min(maxAbs - 1e-6, v))
    const idx = Math.floor((clamped + maxAbs) / binWidth)
    if (idx >= 0 && idx < buckets.length) buckets[idx].count += 1
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1)
  return buckets.map((b) => ({ ...b, count: Math.round((b.count / maxCount) * 100) }))
}

function computeUr(hitErrors: number[]): number | null {
  const validHits = (hitErrors || []).filter((o) => Number.isFinite(o) && Math.abs(o) < 300)
  if (!validHits.length) return null
  const mean = validHits.reduce((s, v) => s + v, 0) / validHits.length
  const variance = validHits.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / validHits.length
  const std = Math.sqrt(variance)
  // Unstable rate is 10x the std deviation; keep one decimal place
  return Math.round(std * 10 * 10) / 10
}

function smoothMovingAverage(values: number[], windowSize = 5): number[] {
  if (!values.length) return []
  const half = Math.floor(windowSize / 2)
  return values.map((_v, i) => {
    const start = Math.max(0, i - half)
    const end = Math.min(values.length - 1, i + half)
    let sum = 0
    let count = 0
    for (let j = start; j <= end; j++) {
      const val = values[j]
      if (!Number.isFinite(val)) continue
      sum += val
      count += 1
    }
    return count ? sum / count : values[i]
  })
}

export default defineNitroPlugin(async () => {
  if (!process.server) return

  // Security/risk reduction: disable replay parsing by default.
  // Enable explicitly by setting NUXT_ENABLE_REPLAY_WATCHER=true.
  const enableWatcher = String(process.env.NUXT_ENABLE_REPLAY_WATCHER || '').toLowerCase() === 'true'
  if (!enableWatcher) {
    console.log('[Replay Watcher] Disabled (set NUXT_ENABLE_REPLAY_WATCHER=true to enable)')
    return
  }

  const config = useRuntimeConfig()
  const configuredPath = (config as any).osuReplayPath || process.env.NUXT_OSU_REPLAY_PATH || process.env.OSU_REPLAY_PATH
  const replayPath = path.resolve(process.cwd(), configuredPath || DEFAULT_REPLAY_DIR)
  const configuredFilesPath =
    (config as any).osuFilesPath ||
    process.env.NUXT_OSU_FILES_PATH ||
    process.env.OSU_FILES_PATH ||
    // Back-compat for older setups
    (config as any).osuSongsPath ||
    process.env.NUXT_OSU_SONGS_PATH ||
    process.env.OSU_SONGS_PATH
  const filesPath = configuredFilesPath ? path.resolve(process.cwd(), configuredFilesPath) : DEFAULT_FILES_DIR
  const targetUser = (config as any).osuTargetUser || (config as any).public?.osuTargetUser || 'chlokun'
  const apiBase = (config as any).public?.osuApiBase || 'https://osu.ppy.sh/api/v2'
  const clientId = (config as any).osuClientId
  const clientSecret = (config as any).osuClientSecret

  let chokidarMod: typeof import('chokidar') | null = null
  try {
    chokidarMod = await import('chokidar')
  } catch (err) {
    console.error('[Replay Watcher] Failed to load chokidar', err)
    return
  }

  try {
    await fsp.mkdir(replayPath, { recursive: true })
  } catch (err) {
    console.error('[Replay Watcher] Failed to ensure replay path', err)
    return
  }

  const watcher = chokidarMod.watch(replayPath, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher.on('add', async (filePath: string) => {
    if (!filePath.endsWith('.osr')) return
    const fileName = path.basename(filePath)
    if (processedFiles.has(filePath)) return
    console.log(`[Replay Watcher] New replay detected: ${fileName}`)

    let completed = false
    processedFiles.add(filePath)

    try {
      const cache = await loadCache()

      let score: any = null
      try {
        const decoder = new ScoreDecoder()
        score = await decoder.decodeFromPath(filePath, true)
      } catch (err) {
        console.error('[Replay Watcher] Failed to parse replay', err)
        return
      }

      const info = score?.info || {}
      const beatmapHashRaw = extractBeatmapHash(score, filePath)
      const beatmapHash = beatmapHashRaw ? String(beatmapHashRaw).toLowerCase() : null
      const replayTotalScore = info?.totalScore ?? info?.score ?? score?.score ?? null

      const lifeBarEnd =
        parseLifeBarEndPercent(score?.replay?.lifeBar) ??
        parseLifeBarEndPercent(score?.replay?.life_bar) ??
        parseLifeBarEndPercent(score?.lifeBar) ??
        parseLifeBarEndPercent(score?.life_bar) ??
        parseLifeBarEndPercent(info?.lifeBar) ??
        parseLifeBarEndPercent(info?.life_bar)
      const passed = lifeBarEnd != null ? lifeBarEnd > 0 : null
      console.log(`[Watcher] Identified Hash: ${beatmapHash || 'n/a'}`)
      console.log(`[Watcher] Attempting match for: ${replayTotalScore ?? 'n/a'} points on ${beatmapHash || 'n/a'}`)

      const frames = Array.isArray(score?.replay?.frames) ? score.replay.frames : []
      const keyPressTimes = extractKeyPressTimesFromFrames(frames)
      const staminaRaw = buildIntervals(keyPressTimes)
      const stamina = smoothMovingAverage(staminaRaw, 5)

      const replayTimestamp = normalizeTimestampMs(info?.timestamp ?? score?.timestamp)

      const cacheKey = `${beatmapHash || 'nohash'}:${replayTimestamp || fileName}`
      if (processedHashes.has(cacheKey)) {
        console.log('[Replay Watcher] In-memory duplicate; skipping', cacheKey)
        try {
          await fsp.unlink(filePath)
        } catch {
          // ignore
        }
        completed = true
        return
      }

      if (cache[cacheKey]) {
        console.log('[Replay Watcher] Replay already processed; skipping duplicate', cacheKey)
        try {
          await fsp.unlink(filePath)
        } catch (err) {
          console.warn('[Replay Watcher] Unable to delete duplicate replay', err)
        }
        completed = true
        return
      }

      const history = await loadHistory()

      const readHistoryChecksum = (s: any): string | null => {
        const checksumRaw = s?.beatmap?.checksum || s?.beatmap_md5 || s?.beatmap_hash || null
        if (!checksumRaw) return null
        const checksum = String(checksumRaw).toLowerCase()
        return checksum && checksum !== 'n/a' ? checksum : null
      }

      const replayScoreNumber = typeof replayTotalScore === 'number' ? replayTotalScore : Number(replayTotalScore)
      const hasReplayScore = Number.isFinite(replayScoreNumber)

      const replayHits = readReplayHits(score)
      const replayMods = readReplayMods(score)
      const replayModsList = modsToArray(replayMods)
      const replayAcc = Math.round(calculateAccuracy(replayHits) * 100) / 100
      const computedReplayRank = passed === false ? 'F' : calculateRank(replayHits, replayMods)

      // Try to recover the official score from osu! API (beatmap lookup -> user score).
      let token: string | null = null
      let userId: string | number | null = null
      if (clientId && clientSecret) {
        token = await fetchToken(clientId, clientSecret)
        if (token) {
          userId = await fetchUserId(apiBase, token, targetUser)
        }
      }

      let beatmapMeta: ApiBeatmapLookup | null = null
      let apiScore: any | null = null
      if (token && userId && beatmapHash && isValidBeatmapHash(beatmapHash)) {
        const recovered = await getApiScore({ apiBase, token, beatmapHash, userId })
        beatmapMeta = recovered.beatmap
        apiScore = recovered.score
      }

      const normalizeApiAccuracyPct = (raw: any): number | null => {
        if (raw == null) return null
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (!Number.isFinite(n)) return null
        const pct = n <= 1.5 ? n * 100 : n
        return Math.round(pct * 100) / 100
      }

      const normalizeApiScoreValue = (s: any): number | null => {
        const v = s?.score ?? s?.total_score ?? s?.totalScore ?? null
        if (typeof v === 'number') return Number.isFinite(v) ? v : null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }

      // Build the canonical entry (API score preferred; otherwise ghost from replay).
      let entry: any = null
      if (apiScore) {
        const apiRankRaw = apiScore?.rank ?? apiScore?.grade ?? null
        const apiRank = normalizeReplayRank(apiRankRaw)
        const apiAcc = normalizeApiAccuracyPct(apiScore?.accuracy)
        const apiPp = typeof apiScore?.pp === 'number' ? apiScore.pp : null
        const apiCreatedAt = typeof apiScore?.created_at === 'string' ? apiScore.created_at : null

        entry = {
          id: apiScore?.id ?? apiScore?.score_id ?? apiScore?.best_id ?? apiScore?.legacy_score_id ?? `${beatmapHash}:${replayTimestamp || fileName}`,
          title: beatmapMeta?.beatmapset?.title || beatmapMeta?.title || 'Unknown map',
          difficulty: beatmapMeta?.version || '—',
          rank: apiRank || computedReplayRank,
          pp: apiPp,
          accuracy: apiAcc ?? replayAcc,
          score: normalizeApiScoreValue(apiScore) ?? (hasReplayScore ? replayScoreNumber : null),
          created_at: apiCreatedAt || (replayTimestamp ? new Date(replayTimestamp).toISOString() : new Date().toISOString()),
          beatmap_md5: beatmapHash,
          beatmap: {
            checksum: beatmapHash,
            title: beatmapMeta?.beatmapset?.title || beatmapMeta?.title || null,
            version: beatmapMeta?.version || null,
            id: beatmapMeta?.id ?? null
          },
          beatmapset: beatmapMeta?.beatmapset
            ? {
                id: beatmapMeta.beatmapset.id ?? beatmapMeta.beatmapset_id ?? null,
                title: beatmapMeta.beatmapset.title ?? null,
                artist: beatmapMeta.beatmapset.artist ?? null,
                creator: beatmapMeta.beatmapset.creator ?? null,
                covers: beatmapMeta.beatmapset.covers ?? null
              }
            : undefined,
          mods: replayMods,
          mods_list: replayModsList
        }

        // Passed safeguard: if replay says HP>0, do not allow 'F'.
        if (passed === true && String(entry.rank || '').toUpperCase() === 'F') {
          entry.rank = computedReplayRank
        }
      } else {
        // Ghost score: inferred from replay headers + calculated rank/accuracy.
        entry = {
          id: `ghost:${beatmapHash || 'nohash'}:${replayTimestamp || fileName}`,
          title: beatmapMeta?.beatmapset?.title || beatmapMeta?.title || fileName,
          difficulty: beatmapMeta?.version || '—',
          rank: computedReplayRank,
          pp: null,
          accuracy: replayAcc,
          score: hasReplayScore ? replayScoreNumber : null,
          created_at: replayTimestamp ? new Date(replayTimestamp).toISOString() : new Date().toISOString(),
          beatmap_md5: beatmapHash,
          beatmap: {
            checksum: beatmapHash,
            title: beatmapMeta?.beatmapset?.title || beatmapMeta?.title || null,
            version: beatmapMeta?.version || null,
            id: beatmapMeta?.id ?? null
          },
          beatmapset: beatmapMeta?.beatmapset
            ? {
                id: beatmapMeta.beatmapset.id ?? beatmapMeta.beatmapset_id ?? null,
                title: beatmapMeta.beatmapset.title ?? null,
                artist: beatmapMeta.beatmapset.artist ?? null,
                creator: beatmapMeta.beatmapset.creator ?? null,
                covers: beatmapMeta.beatmapset.covers ?? null
              }
            : undefined,
          mods: replayMods,
          mods_list: replayModsList
        }
      }

      // Ensure checksum is always present when available.
      if (beatmapHash) {
        entry.beatmap_md5 = beatmapHash
        entry.beatmap = entry.beatmap || {}
        entry.beatmap.checksum = beatmapHash
      }

      // --- JIT beatmap fetch + true UR/hit error calculation ---
      const beatmapId = readBeatmapIdFromMatch(entry)
      const actionTimes = extractActionTimesFromFrames(frames)

      let trueHitErrors: number[] = []
      let trueTrace: { time: number; offset: number }[] = []
      let lockOnOffsetMs: number | null = null
      if (beatmapId != null) {
        const mapContent = await fetchBeatmapContentJit({ filesDir: filesPath, beatmapId, beatmapHash })
        if (mapContent) {
          try {
            const decoder = new BeatmapDecoder()
            const map = decoder.decodeFromString(mapContent, { parseHitObjects: true, parseStoryboard: false })
            const computed = computeTrueHitErrors(map as any, actionTimes, HIT_WINDOW)
            trueHitErrors = computed.hitErrors
            trueTrace = computed.trace
            lockOnOffsetMs = computed.lockOnOffsetMs
          } catch (err) {
            console.warn('[Replay Watcher] Failed to decode beatmap for true UR', { beatmapId, err })
          }
        }
      }

      // Fallback order: true errors (beatmap+replay) -> explicit replay hit error fields -> deterministic mock
      const { offsets: hitErrorsFromFrames, trace: hitTraceFromFrames } = extractHitErrorsFromFrames(frames)
      const seedKey = `${beatmapHash || fileName}:${replayTimestamp || ''}:${replayTotalScore || ''}`
      const hitErrors = trueHitErrors.length
        ? trueHitErrors
        : hitErrorsFromFrames.length
          ? hitErrorsFromFrames
          : generateMockHitErrors(stamina, seedKey)

      const hitTrace = trueTrace.length ? trueTrace : hitTraceFromFrames

      // Mod awareness: DT / "Sped Up" maps shrink timing in real time.
      // Scale offsets down before UR/distribution so we don't inflate UR.
      const speedUp = isSpeedUpPlay(entry, replayMods)
      const speedScale = speedUp ? 1.5 : 1

      const scaledHitErrors = hitErrors.map((o) => o / speedScale)
      const scaledHitTrace = hitTrace.map((p) => ({ ...p, offset: p.offset / speedScale }))
      const scaledLockOn = lockOnOffsetMs != null ? lockOnOffsetMs / speedScale : null

      const ur = (trueHitErrors.length || hitErrorsFromFrames.length) ? computeUr(scaledHitErrors) : null

      ;(entry as any).deep_stats = {
        ur,
        hit_errors: scaledHitErrors,
        stamina,
        hit_trace: scaledHitTrace,
        hit_distribution: buildHistogram(scaledHitErrors),
        lock_on_offset_ms: scaledLockOn,
        time_scale: speedScale,
        replay_timestamp: replayTimestamp || null,
        timestamp: new Date().toISOString()
      }

      // Strict dedupe by checksum (map-level history): overwrite existing entry, or push new.
      const hash = beatmapHash ? beatmapHash.toLowerCase() : null
      if (hash && isValidBeatmapHash(hash)) {
        const matches: { idx: number; t: number }[] = []
        for (let i = 0; i < history.length; i++) {
          if (readHistoryChecksum(history[i]) === hash) {
            matches.push({ idx: i, t: normalizeTimestampMs(history[i]?.created_at) || 0 })
          }
        }

        if (matches.length) {
          // Keep the newest existing record, overwrite it with this entry.
          matches.sort((a, b) => b.t - a.t)
          const keepIdx = matches[0]!.idx
          // Overwrite entirely (data integrity): do not merge stale fields.
          history[keepIdx] = { ...(entry as any) }

          // Remove all other duplicates (splice from highest index to lowest).
          const removeIdxs = matches
            .slice(1)
            .map((m) => m.idx)
            .sort((a, b) => b - a)
          for (const idx of removeIdxs) history.splice(idx, 1)
        } else {
          history.push(entry as any)
        }
      } else {
        history.push(entry as any)
      }

      cache[cacheKey] = {
        beatmapHash,
        replay_timestamp: replayTimestamp || null,
        timestamp: new Date().toISOString(),
        hit_errors: scaledHitErrors,
        stamina,
        ur,
        file: fileName
      }

      processedHashes.add(cacheKey)

      await saveHistory(history)
      await saveCache(cache)
      console.log(`[Replay Watcher] Stats updated for ${(entry as any).title || 'score'} (UR: ${ur ?? 'n/a'})`)

      processedCounter += 1
      ;(globalThis as any).__osu_dash_processedCounter = processedCounter

      try {
        await fsp.unlink(filePath)
      } catch (err) {
        console.warn('[Replay Watcher] Unable to delete processed replay', err)
      }

      completed = true
    } catch (err) {
      console.error('[Replay Watcher] Failed to process replay file', err)
    } finally {
      // Allow retry if we failed mid-flight.
      if (!completed) processedFiles.delete(filePath)
    }
  })

  watcher.on('error', (err: any) => {
    console.error('[Replay Watcher] Watcher error', err)
  })

  console.log(`[Replay Watcher] Watching ${replayPath} for new .osr files...`)
})
