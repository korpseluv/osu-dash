import { promises as fsp, writeFileSync } from 'node:fs'
import path from 'node:path'
import { $fetch } from 'ofetch'

import {
	isValidBeatmapHash,
	normalizeTimestampMs,
	parseLazerReplay
} from './replayParser'
import { buildEntryFromReplay, computeLazerDeepStats } from './replayStatCalc'

export const HISTORY_PATH_DEFAULT = path.resolve(process.cwd(), 'data', 'score-history.json')
export const CACHE_PATH_DEFAULT = path.resolve(process.cwd(), 'data', 'replay-cache.json')
export const DEFAULT_LAZER_REPLAY_DIR = path.resolve(process.env.HOME || process.cwd(), 'Library', 'Application Support', 'osu!', 'Data', 'r')
export const DEFAULT_LAZER_FILES_DIR = path.resolve(process.env.HOME || process.cwd(), 'Library', 'Application Support', 'osu', 'files')

export type LazerWatcherOptions = {
	replayPath: string
	filesPath: string
	apiBase: string
	targetUser: string
	clientId?: string | null
	clientSecret?: string | null
	historyPath?: string
	cachePath?: string
}

const existingProcessedHashes = (globalThis as any).__osu_dash_processedHashes as Set<string> | undefined
const existingProcessedFiles = (globalThis as any).__osu_dash_processedFiles as Set<string> | undefined
let processedHashes: Set<string> = existingProcessedHashes ?? new Set<string>()
let processedFiles: Set<string> = existingProcessedFiles ?? new Set<string>()
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

async function loadHistory(historyPath: string): Promise<any[]> {
	try {
		const raw = await fsp.readFile(historyPath, 'utf8')
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

async function saveHistory(historyPath: string, history: any[]) {
	const dir = path.dirname(historyPath)
	await fsp.mkdir(dir, { recursive: true })
	writeFileSync(historyPath, JSON.stringify(history, null, 2), { encoding: 'utf8', flag: 'w' })
}

async function loadCache(cachePath: string): Promise<Record<string, any>> {
	try {
		const raw = await fsp.readFile(cachePath, 'utf8')
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

async function saveCache(cachePath: string, cache: Record<string, any>) {
	const dir = path.dirname(cachePath)
	await fsp.mkdir(dir, { recursive: true })
	writeFileSync(cachePath, JSON.stringify(cache, null, 2), { encoding: 'utf8', flag: 'w' })
}

async function fetchToken(clientId?: string | null, clientSecret?: string | null) {
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
	} catch {
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

function readHistoryChecksum(s: any): string | null {
	const checksumRaw = s?.beatmap?.checksum || s?.beatmap_md5 || s?.beatmap_hash || null
	if (!checksumRaw) return null
	const checksum = String(checksumRaw).toLowerCase()
	return checksum && checksum !== 'n/a' ? checksum : null
}

function upsertHistory(history: any[], entry: any, beatmapHash: string | null, cacheKey: string, replayTimestamp: number | null) {
	const hash = beatmapHash ? beatmapHash.toLowerCase() : null
	if (hash && isValidBeatmapHash(hash)) {
		const matches: { idx: number; t: number }[] = []
		for (let i = 0; i < history.length; i++) {
			if (readHistoryChecksum(history[i]) === hash) {
				matches.push({ idx: i, t: normalizeTimestampMs(history[i]?.replay_timestamp ?? history[i]?.created_at) || 0 })
			}
		}

		if (matches.length) {
			const targetTs = normalizeTimestampMs(replayTimestamp)
			const duplicateIdx = matches.find((m) => {
				const existing = history[m.idx]
				const existingKey = (existing as any)?.cache_key
				const existingTs = normalizeTimestampMs((existing as any)?.replay_timestamp ?? (existing as any)?.created_at)
				return (existingKey && existingKey === cacheKey) || (existingTs != null && targetTs != null && existingTs === targetTs)
			})?.idx

			if (duplicateIdx != null) {
				history[duplicateIdx] = { ...(entry as any) }
				return
			}
		}
	}

	history.push(entry as any)
	}

async function processReplay(filePath: string, opts: Required<LazerWatcherOptions>) {
	const historyPath = opts.historyPath
	const cachePath = opts.cachePath

	const cache = await loadCache(cachePath)

	let parsed
	try {
		parsed = await parseLazerReplay(filePath)
	} catch (err) {
		console.error('[Replay Watcher] Failed to parse replay', err)
		return
	}

	const replayTimestamp = parsed.replayTimestamp
	const cacheKey = `${parsed.beatmapHash || 'nohash'}:${replayTimestamp || parsed.fileName}`

	if (processedHashes.has(cacheKey)) {
		console.log('[Replay Watcher] In-memory duplicate; skipping', cacheKey)
		try {
			await fsp.unlink(filePath)
		} catch {
			// ignore
		}
		return
	}

	if (cache[cacheKey]) {
		console.log('[Replay Watcher] Replay already processed; skipping duplicate', cacheKey)
		try {
			await fsp.unlink(filePath)
		} catch (err) {
			console.warn('[Replay Watcher] Unable to delete duplicate replay', err)
		}
		return
	}

	const beatmapHash = parsed.beatmapHash

	let token: string | null = null
	let userId: string | number | null = null
	if (opts.clientId && opts.clientSecret) {
		token = await fetchToken(opts.clientId, opts.clientSecret)
		if (token) userId = await fetchUserId(opts.apiBase, token, opts.targetUser)
	}

	let beatmapMeta: ApiBeatmapLookup | null = null
	let apiScore: any | null = null
	if (token && userId && beatmapHash && isValidBeatmapHash(beatmapHash)) {
		const recovered = await getApiScore({ apiBase: opts.apiBase, token, beatmapHash, userId })
		beatmapMeta = recovered.beatmap
		apiScore = recovered.score
	}

	const { entry } = await buildEntryFromReplay({
		filePath,
		fileName: parsed.fileName,
		score: parsed.score,
		info: parsed.info,
		frames: parsed.frames,
		beatmapHash,
		replayTimestamp,
		replayTotalScore: parsed.replayTotalScore,
		replayHits: parsed.replayHits,
		replayMods: parsed.replayMods,
		replayModsList: parsed.replayModsList,
		lifeBarEnd: parsed.lifeBarEnd,
		passed: parsed.passed,
		beatmapMeta,
		apiScore
	})

	entry.cache_key = cacheKey
	entry.replay_timestamp = replayTimestamp || null

	const beatmapId = beatmapMeta?.id ?? parsed.info?.beatmap_id ?? parsed.info?.beatmapId ?? null
	const deepStats = await computeLazerDeepStats({
		frames: parsed.frames,
		beatmapId,
		beatmapHash,
		filesDir: opts.filesPath,
		replayMods: parsed.replayMods,
		fileName: parsed.fileName,
		replayTimestamp,
		title: entry?.title ?? beatmapMeta?.title ?? parsed.fileName,
		difficulty: entry?.difficulty ?? beatmapMeta?.version ?? null
	})

	entry.deep_stats = deepStats

	const history = await loadHistory(historyPath)
		upsertHistory(history, entry, beatmapHash, cacheKey, replayTimestamp || null)

	cache[cacheKey] = {
		beatmapHash,
		replay_timestamp: replayTimestamp || null,
		timestamp: new Date().toISOString(),
		hit_errors: deepStats.hit_errors,
		stamina: deepStats.stamina,
		ur: deepStats.ur,
		file: parsed.fileName
	}

	processedHashes.add(cacheKey)

	await saveHistory(historyPath, history)
	await saveCache(cachePath, cache)
	console.log(`[Replay Watcher] Stats updated for ${(entry as any).title || 'score'} (UR: ${deepStats.ur ?? 'n/a'})`)

	processedCounter += 1
	;(globalThis as any).__osu_dash_processedCounter = processedCounter

	try {
		await fsp.unlink(filePath)
	} catch (err) {
		console.warn('[Replay Watcher] Unable to delete processed replay', err)
	}
}

export async function startLazerReplayWatcher(options: LazerWatcherOptions) {
	const replayPath = options.replayPath
	const filesPath = options.filesPath
	const historyPath = options.historyPath || HISTORY_PATH_DEFAULT
	const cachePath = options.cachePath || CACHE_PATH_DEFAULT

	const opts: Required<LazerWatcherOptions> = {
		replayPath,
		filesPath,
		apiBase: options.apiBase,
		targetUser: options.targetUser,
		clientId: options.clientId || null,
		clientSecret: options.clientSecret || null,
		historyPath,
		cachePath
	}

	try {
		await fsp.mkdir(replayPath, { recursive: true })
	} catch (err) {
		console.error('[Replay Watcher] Failed to ensure replay path', err)
		return null
	}

	let chokidarMod: typeof import('chokidar') | null = null
	try {
		chokidarMod = await import('chokidar')
	} catch (err) {
		console.error('[Replay Watcher] Failed to load chokidar', err)
		return null
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
			await processReplay(filePath, opts)
			completed = true
		} catch (err) {
			console.error('[Replay Watcher] Failed to process replay file', err)
		} finally {
			if (!completed) processedFiles.delete(filePath)
		}
	})

	watcher.on('error', (err: any) => {
		console.error('[Replay Watcher] Watcher error', err)
	})

	console.log(`[Replay Watcher] Watching ${replayPath} for new .osr files...`)
	return watcher
}
