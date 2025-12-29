import { createError, defineEventHandler } from 'h3'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  token_type?: string
}

export default defineEventHandler(async (event) => {
  // Production lockout: never expose a public token-minting endpoint.
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const config = useRuntimeConfig()
  const clientId = config.osuClientId
  const clientSecret = config.osuClientSecret
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'Missing client credentials' }), { status: 400 })
  }

  const params = new URLSearchParams()
  params.set('client_id', clientId)
  params.set('client_secret', clientSecret)
  params.set('grant_type', 'client_credentials')
  params.set('scope', 'public')

  const res = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    return new Response(JSON.stringify({ error: 'osu token request failed', detail: text }), { status: 502 })
  }

  const data = (await res.json()) as TokenResponse
  return data
})
