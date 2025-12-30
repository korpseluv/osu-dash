import { decodeBase64 } from './safeBase64'

export interface ReplaySummary {
  metadata: {
    mode: number
    version: number
    beatmapMd5: string
    player: string
    replayMd5: string
    date: string
    title: string
  }
  score: number
  maxCombo: number
  perfect: boolean
  accuracy: number
  mods: number
  modsLabel: string
  hits: {
    count300: number
    count100: number
    count50: number
    countMiss: number
    countGeki: number
    countKatu: number
  }
  lifeGraph: Array<{ time: number; life: number }>
  aimActivity: Array<{ time: number; speed: number }>
  consistency: number
  flow: number
  hpDrain: number
  stamina: number
  reading: number
}

const MODS: Record<number, string> = {
  1: 'NF', 2: 'EZ', 4: 'TD', 8: 'HD', 16: 'HR', 32: 'SD', 64: 'DT', 128: 'RL', 256: 'HT', 512: 'NC',
  1024: 'FL', 2048: 'AT', 4096: 'SO', 8192: 'AP', 16384: 'PF'
}

function decodeULEB128(view: DataView, offset: { value: number }) {
  let value = 0n
  let shift = 0n
  while (true) {
    const byte = BigInt(view.getUint8(offset.value))
    offset.value += 1
    value |= (byte & 0x7fn) << shift
    if ((byte & 0x80n) === 0n) break
    shift += 7n
  }
  return Number(value)
}

function readString(view: DataView, offset: { value: number }) {
  const marker = view.getUint8(offset.value)
  offset.value += 1
  if (marker === 0x00) return ''
  if (marker !== 0x0b) return ''
  const len = decodeULEB128(view, offset)
  const bytes = new Uint8Array(view.buffer, offset.value, len)
  offset.value += len
  return new TextDecoder().decode(bytes)
}

function readInt(view: DataView, offset: { value: number }) {
  const v = view.getInt32(offset.value, true)
  offset.value += 4
  return v
}

function readShort(view: DataView, offset: { value: number }) {
  const v = view.getInt16(offset.value, true)
  offset.value += 2
  return v
}

function readLong(view: DataView, offset: { value: number }) {
  const low = view.getUint32(offset.value, true)
  const high = view.getUint32(offset.value + 4, true)
  offset.value += 8
  return Number((BigInt(high) << 32n) | BigInt(low))
}

function modsToLabel(mods: number) {
  if (mods === 0) return ''
  const names: string[] = []
  Object.entries(MODS).forEach(([mask, label]) => {
    if (mods & Number(mask)) names.push(label)
  })
  return names.join(', ')
}

async function tryDecompressLzma(compressed: string): Promise<string | null> {
  try {
    // @ts-expect-error external module ships without types
    const { LZMA } = await import('lzma/src/lzma_worker')
    return await new Promise((resolve, reject) => {
      const worker = new LZMA()
      worker.decompress(decodeBase64(compressed), (res: string | number) => {
        if (typeof res === 'number') return reject(new Error('LZMA error ' + res))
        resolve(res)
      })
    })
  } catch (err) {
    console.warn('LZMA decompress failed', err)
    return null
  }
}

function parseLifeGraph(raw: string) {
  if (!raw) return [] as Array<{ time: number; life: number }>
  const entries: Array<{ time: number; life: number }> = []
  raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [timeRaw, lifeRaw] = pair.split('|')
      const time = Number(timeRaw)
      const life = Number(lifeRaw)
      if (!Number.isFinite(time) || !Number.isFinite(life)) return
      entries.push({ time, life })
    })
  return entries
}

function summarizeFrames(frames: string) {
  const rows = frames
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean)
  let t = 0
  let lastX = 0
  let lastY = 0
  const activity: Array<{ time: number; speed: number }> = []
  for (const row of rows) {
    const parts = row.split('|')
    const delta = Number(parts[0])
    if (!Number.isFinite(delta)) continue
    const xRaw = Number(parts[1])
    const yRaw = Number(parts[2])
    const x = Number.isFinite(xRaw) ? xRaw : lastX
    const y = Number.isFinite(yRaw) ? yRaw : lastY
    t += delta
    const dx = x - lastX
    const dy = y - lastY
    const speed = Math.sqrt(dx * dx + dy * dy) / Math.max(1, delta)
    activity.push({ time: t, speed: Number.isFinite(speed) ? speed : 0 })
    lastX = x
    lastY = y
  }
  return activity
}

export async function parseReplay(buffer: Uint8Array): Promise<ReplaySummary> {
  const view = new DataView(buffer.buffer)
  const o = { value: 0 }

  const mode = view.getUint8(o.value); o.value += 1
  const version = readInt(view, o)
  const beatmapMd5 = readString(view, o)
  const player = readString(view, o)
  const replayMd5 = readString(view, o)

  const count300 = readShort(view, o)
  const count100 = readShort(view, o)
  const count50 = readShort(view, o)
  const countGeki = readShort(view, o)
  const countKatu = readShort(view, o)
  const countMiss = readShort(view, o)

  const score = readInt(view, o)
  const maxCombo = readShort(view, o)
  const perfect = view.getUint8(o.value) === 1; o.value += 1

  const mods = readInt(view, o)

  const lifeGraphRaw = readString(view, o)
  const timestamp = readLong(view, o)
  const replayLength = readInt(view, o)
  const replayData = readString(view, o)

  // skip online id (long)
  readLong(view, o)

  const lifeGraph = parseLifeGraph(lifeGraphRaw)
  const accuracy = calcAccuracy({ count300, count100, count50, countMiss })

  let aimActivity: Array<{ time: number; speed: number }> = []
  if (replayLength > 0 && replayData) {
    const decompressed = await tryDecompressLzma(replayData)
    if (decompressed) {
      aimActivity = summarizeFrames(decompressed)
    }
  }

  const consistency = Math.max(40, 100 - (countMiss * 12 + count50 * 3))
  const flow = Math.min(100, 60 + (aimActivity.length ? 20 : 0))
  const hpDrain = Math.min(100, (lifeGraph.reduce((a, b) => a + b.life, 0) / Math.max(1, lifeGraph.length)) * 2)
  const stamina = Math.min(100, 50 + maxCombo / 20)
  const reading = Math.min(100, 55 + (mods & 8 ? 15 : 0) + (mods & 16 ? -10 : 0))

  const date = new Date(timestamp / 10000).toISOString().slice(0, 10)

  return {
    metadata: {
      mode,
      version,
      beatmapMd5,
      player,
      replayMd5,
      date,
      title: beatmapMd5 || 'Unknown beatmap'
    },
    score,
    maxCombo,
    perfect,
    accuracy,
    mods,
    modsLabel: modsToLabel(mods),
    hits: { count300, count100, count50, countMiss, countGeki, countKatu },
    lifeGraph,
    aimActivity,
    consistency,
    flow,
    hpDrain,
    stamina,
    reading
  }
}

function calcAccuracy(h: { count300: number; count100: number; count50: number; countMiss: number }) {
  const totalHits = h.count300 + h.count100 + h.count50 + h.countMiss
  if (totalHits === 0) return 0
  const acc = (300 * h.count300 + 100 * h.count100 + 50 * h.count50) / (300 * totalHits)
  return acc
}
