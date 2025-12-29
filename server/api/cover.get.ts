import { createError, defineEventHandler, getQuery } from 'h3'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const coversDir = path.resolve(process.cwd(), 'data', 'covers')

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = query.id?.toString()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  await fs.mkdir(coversDir, { recursive: true })
  const filePath = path.join(coversDir, `${id}.jpg`)

  try {
    const buf = await fs.readFile(filePath)
    return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } })
  } catch {
    /* cache miss */
  }

  const remoteUrl = `https://assets.ppy.sh/beatmaps/${id}/covers/card.jpg`
  const res = await fetch(remoteUrl)
  if (!res.ok) {
    if (res.status === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Cover not found' })
    }
    throw createError({ statusCode: res.status, statusMessage: `Upstream error ${res.status}` })
  }

  const arrayBuffer = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)
  await fs.writeFile(filePath, buf)

  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } })
})
