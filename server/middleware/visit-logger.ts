import { defineEventHandler, getRequestHeader, getRequestIP, getRequestURL } from 'h3'

function isoNow() {
  return new Date().toISOString()
}

function safeUserAgent(ua: string | undefined | null) {
  if (!ua) return '-'
  // Avoid log spam / weird control chars
  return ua.replace(/[\r\n\t]/g, ' ').slice(0, 180)
}

function safeReferrer(ref: string | undefined | null) {
  if (!ref) return '-'
  return ref.replace(/[\r\n\t]/g, ' ').slice(0, 220)
}

export default defineEventHandler((event) => {
  const start = Date.now()
  const url = getRequestURL(event)
  const method = event.node.req.method || 'GET'
  const ip = getRequestIP(event, { xForwardedFor: true }) || event.node.req.socket.remoteAddress || '-'
  const ua = safeUserAgent(getRequestHeader(event, 'user-agent'))
  const ref = safeReferrer(getRequestHeader(event, 'referer'))

  event.node.res.on('finish', () => {
    const ms = Date.now() - start
    const status = event.node.res.statusCode

    // Only log real page/API hits. Skip the loud stuff.
    const path = url.pathname
    if (
      path.startsWith('/_nuxt/') ||
      path === '/favicon.ico' ||
      path === '/robots.txt' ||
      path === '/sw.js' ||
      path.startsWith('/workbox-')
    ) {
      return
    }

    const kind = path.startsWith('/api/') ? 'API' : 'VISIT'
    console.log(`[${isoNow()}] ${kind} ${status} ${ms}ms ${method} ${path} ip=${ip} ua="${ua}" ref="${ref}"`)
  })
})
