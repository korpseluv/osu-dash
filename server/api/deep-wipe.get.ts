import { createError, defineEventHandler } from 'h3'
import { promises as fs, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const historyPath = path.resolve(process.cwd(), 'data', 'score-history.json')

export default defineEventHandler(async () => {
  // Production lockout: wiping is dev-only.
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // 1) Close any open file streams to score-history.json (best-effort)
  try {
    const maybeHandle = (globalThis as any).__osu_dash_historyFileHandle
    if (maybeHandle && typeof maybeHandle.close === 'function') {
      await maybeHandle.close()
    }
  } catch {
    // non-fatal
  }

  // 2) Physically DELETE the score history file
  try {
    await fs.mkdir(path.dirname(historyPath), { recursive: true })
    rmSync(historyPath, { force: true })
  } catch {
    // non-fatal
  }

  // 3) Re-create an empty file with []
  try {
    await fs.mkdir(path.dirname(historyPath), { recursive: true })
    writeFileSync(historyPath, '[]', { encoding: 'utf8', flag: 'w' })
  } catch {
    // non-fatal
  }

  // 4) Reset the Watcher's memory Sets to new Set()
  try {
    const resetFn = (globalThis as any).__osu_dash_resetWatcherMemory
    if (typeof resetFn === 'function') {
      resetFn()
    } else {
      ;(globalThis as any).__osu_dash_processedHashes = new Set<string>()
      ;(globalThis as any).__osu_dash_processedFiles = new Set<string>()
      ;(globalThis as any).__osu_dash_processedCounter = 0
    }
  } catch {
    // non-fatal
  }

  return { message: 'Deep wipe complete. History deleted/recreated. Watcher memory reset.' }
})
