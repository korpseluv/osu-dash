/**
 * PM2 config for osu!dash
 *
 * Usage:
 *   npm run build
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs osu-dash
 */
module.exports = {
  apps: [
    {
      name: 'osu-dash',
      script: '.output/server/index.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        // Nitro runtime (node-server preset)
        NITRO_HOST: process.env.NITRO_HOST || '127.0.0.1',
        NITRO_PORT: process.env.NITRO_PORT || process.env.PORT || '3000',

        // Safety defaults: keep replay watcher off unless you explicitly opt in.
        NUXT_ENABLE_REPLAY_WATCHER: process.env.NUXT_ENABLE_REPLAY_WATCHER || 'false'
      },
      // Cleaner logs
      time: true,
      merge_logs: true,
      max_restarts: 10
    }
  ]
}
