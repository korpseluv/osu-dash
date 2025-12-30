import path from 'node:path'
import { ScoreDecoder } from 'osu-parsers'

export type ReplayHits = {
	count300: number
	count100: number
	count50: number
	countMiss: number
	countGeki?: number
	countKatu?: number
}

export type ParsedLazerReplay = {
	filePath: string
	fileName: string
	score: any
	info: any
	frames: any[]
	beatmapHash: string | null
	replayTotalScore: number | null
	replayHits: ReplayHits
	replayMods: number
	replayModsList: string[]
	replayAcc: number
	computedReplayRank: string
	lifeBarEnd: number | null
	passed: boolean | null
	replayTimestamp: number | null
}

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

export function isValidBeatmapHash(hash: string | null | undefined): hash is string {
	if (!hash) return false
	const h = String(hash).toLowerCase()
	return /^[0-9a-f]{32}$/.test(h)
}

export function modsToArray(mods: number): string[] {
	if (!mods) return []
	const out: string[] = []
	for (const [maskRaw, label] of Object.entries(MOD_BITMASK)) {
		const mask = Number(maskRaw)
		if ((mods & mask) !== 0) out.push(label)
	}
	if (out.includes('NC')) return out.filter((m) => m !== 'DT')
	return out
}

function clampInt(n: unknown): number {
	const v = typeof n === 'number' ? n : Number(n)
	if (!Number.isFinite(v)) return 0
	return Math.max(0, Math.trunc(v))
}

export function readReplayHits(score: any): ReplayHits {
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

export function readReplayMods(score: any): number {
	const info = score?.info || score?.scoreInfo || score?.metadata || {}
	return clampInt(info?.mods ?? info?.mod ?? score?.mods ?? score?.mod)
}

export function calculateAccuracy(h: ReplayHits): number {
	const totalHits = h.count300 + h.count100 + h.count50 + h.countMiss
	if (!totalHits) return 0
	const numerator = 300 * h.count300 + 100 * h.count100 + 50 * h.count50
	return (numerator / (300 * totalHits)) * 100
}

export function calculateRank(h: ReplayHits, mods: number): string {
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

	const MOD_HD = 8
	const MOD_FL = 1024
	const silver = (mods & MOD_HD) !== 0 || (mods & MOD_FL) !== 0
	if (silver && base === 'SS') return 'SSH'
	if (silver && base === 'S') return 'SH'
	return base
}

export function parseLifeBarEndPercent(lifeBar: unknown): number | null {
	if (!lifeBar) return null

	if (Array.isArray(lifeBar)) {
		const last = lifeBar.at(-1)
		const v = (last as any)?.life ?? (last as any)?.value ?? (last as any)?.hp ?? null
		const n = typeof v === 'number' ? v : Number(v)
		return Number.isFinite(n) ? n : null
	}

	if (typeof lifeBar === 'string') {
		const parts = lifeBar
			.split(',')
			.map((p) => p.trim())
			.filter(Boolean)
		if (!parts.length) return null
		const last = parts[parts.length - 1]!
		const seg = last.split('|')
		if (seg.length < 2) return null
		const n = Number(seg[1])
		return Number.isFinite(n) ? n : null
	}

	return null
}

export function normalizeTimestampMs(ts: number | string | Date | null | undefined): number | null {
	if (ts == null) return null
	if (ts instanceof Date) return ts.getTime()
	if (typeof ts === 'string') {
		const parsed = Date.parse(ts)
		return Number.isFinite(parsed) ? parsed : null
	}
	if (typeof ts === 'number') {
		return ts < 1e12 ? ts * 1000 : ts
	}
	return null
}

export function extractBeatmapHash(score: any, filePath: string): string | null {
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

	const fileName = path.basename(filePath, path.extname(filePath))
	return fileName || null
}

export async function parseLazerReplay(filePath: string): Promise<ParsedLazerReplay> {
	const decoder = new ScoreDecoder()
	const score = (await decoder.decodeFromPath(filePath, true)) as any

	const info: any = score?.info || {}
	const beatmapHashRaw = extractBeatmapHash(score, filePath)
	const beatmapHash = beatmapHashRaw ? String(beatmapHashRaw).toLowerCase() : null
	const replayTotalScore = info?.totalScore ?? info?.score ?? (score as any)?.score ?? null

	const lifeBarEnd =
		parseLifeBarEndPercent(score?.replay?.lifeBar) ??
		parseLifeBarEndPercent((score as any)?.replay?.life_bar) ??
		parseLifeBarEndPercent((score as any)?.lifeBar) ??
		parseLifeBarEndPercent((score as any)?.life_bar) ??
		parseLifeBarEndPercent(info?.lifeBar) ??
		parseLifeBarEndPercent(info?.life_bar)
	const passed = lifeBarEnd != null ? lifeBarEnd > 0 : null

	const frames = Array.isArray(score?.replay?.frames) ? score.replay.frames : []
	const replayTimestamp = normalizeTimestampMs(info?.timestamp ?? (score as any)?.timestamp)

	const replayHits = readReplayHits(score)
	const replayMods = readReplayMods(score)
	const replayModsList = modsToArray(replayMods)
	const replayAcc = Math.round(calculateAccuracy(replayHits) * 100) / 100
	const computedReplayRank = passed === false ? 'F' : calculateRank(replayHits, replayMods)

	return {
		filePath,
		fileName: path.basename(filePath),
		score,
		info,
		frames,
		beatmapHash,
		replayTotalScore,
		replayHits,
		replayMods,
		replayModsList,
		replayAcc,
		computedReplayRank,
		lifeBarEnd,
		passed,
		replayTimestamp
	}
}
