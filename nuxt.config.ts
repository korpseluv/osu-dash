import { execSync } from 'node:child_process'
import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'

function resolveGitHash() {
  const envHash = process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || process.env.SOURCE_VERSION
  if (envHash) return String(envHash).slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

const appGitHash = resolveGitHash()

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // Disable Nuxt devtools to cut down on file watchers and avoid EMFILE on macOS defaults.
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  modules: ['@vite-pwa/nuxt'],
  devServer: {
    host: '0.0.0.0',
    port: 3000
  },
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
      autoprefixer: {}
    }
  },
  runtimeConfig: {
    osuClientId: process.env.NUXT_OSU_CLIENT_ID,
    osuClientSecret: process.env.NUXT_OSU_CLIENT_SECRET,
    osuTargetUser: process.env.NUXT_OSU_TARGET_USER,
    osuReplayPath: process.env.OSU_REPLAY_PATH || process.env.NUXT_OSU_REPLAY_PATH,
    public: {
      osuApiBase: process.env.NUXT_PUBLIC_OSU_API_BASE || 'https://osu.ppy.sh/api/v2',
      osuTargetUser: process.env.NUXT_PUBLIC_OSU_TARGET_USER,
      appName: process.env.NUXT_PUBLIC_APP_NAME || 'osu!dash',
      gitHash: appGitHash
    }
  },
  app: {
    head: {
      title: 'osu!dash',
      meta: [
        { name: 'description', content: 'Modern PWA dashboard for osu! replays with rich stats and smooth UI.' },
        { name: 'theme-color', content: '#000000' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, user-scalable=no' }
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/icon.png' },
        { rel: 'apple-touch-icon', href: '/icon.png' }
      ]
    }
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'osu!dash',
      short_name: 'osu!dash',
      start_url: '/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        { src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: {
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}']
    }
  },
  vite: {
    plugins: [tsconfigPaths()],
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('.', import.meta.url)),
        '@': fileURLToPath(new URL('.', import.meta.url))
      }
    }
  },
  nitro: {
    externals: {
      // Keep native / heavy deps out of Nitro bundle
      external: ['chokidar', 'rosu-pp-js', 'osu-parsers']
    }
  }
})
