import { useRuntimeConfig } from '#imports'
import path from 'node:path'

import {
  DEFAULT_LAZER_FILES_DIR,
  DEFAULT_LAZER_REPLAY_DIR,
  startLazerReplayWatcher
} from '~/utils/lazer/replayWatcher'

export default defineNitroPlugin(async () => {
  if (!process.server) return

  const enableWatcher = String(process.env.NUXT_ENABLE_REPLAY_WATCHER || '').toLowerCase() === 'true'
  if (!enableWatcher) {
    console.log('[Replay Watcher] Disabled (set NUXT_ENABLE_REPLAY_WATCHER=true to enable)')
    return
  }

  const config = useRuntimeConfig()
  const configuredPath = (config as any).osuReplayPath || process.env.NUXT_OSU_REPLAY_PATH || process.env.OSU_REPLAY_PATH
  const replayPath = path.resolve(process.cwd(), configuredPath || DEFAULT_LAZER_REPLAY_DIR)
  const configuredFilesPath =
    (config as any).osuFilesPath ||
    process.env.NUXT_OSU_FILES_PATH ||
    process.env.OSU_FILES_PATH ||
    (config as any).osuSongsPath ||
    process.env.NUXT_OSU_SONGS_PATH ||
    process.env.OSU_SONGS_PATH
  const filesPath = configuredFilesPath ? path.resolve(process.cwd(), configuredFilesPath) : DEFAULT_LAZER_FILES_DIR
  const targetUser = (config as any).osuTargetUser || (config as any).public?.osuTargetUser || 'chlokun'
  const apiBase = (config as any).public?.osuApiBase || 'https://osu.ppy.sh/api/v2'
  const clientId = (config as any).osuClientId
  const clientSecret = (config as any).osuClientSecret

  await startLazerReplayWatcher({ replayPath, filesPath, apiBase, clientId, clientSecret, targetUser })
})
