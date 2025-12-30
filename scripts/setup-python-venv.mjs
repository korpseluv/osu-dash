import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const venvDir = path.join(projectRoot, '.venv')
const isWin = process.platform === 'win32'
const pythonBin = process.env.OSU_DASH_PYTHON_BIN || process.env.PYTHON || 'python3'
const venvPython = isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python3')
const pipBin = isWin ? path.join(venvDir, 'Scripts', 'pip.exe') : path.join(venvDir, 'bin', 'pip')

function runOrExit(cmd, args) {
	const res = spawnSync(cmd, args, { stdio: 'inherit' })
	if (res.error) {
		console.error(`[venv] Failed to run ${cmd}:`, res.error.message)
		process.exit(1)
	}
	if (typeof res.status === 'number' && res.status !== 0) process.exit(res.status || 1)
}

function ensureVenv() {
	if (existsSync(venvPython)) return
	runOrExit(pythonBin, ['-m', 'venv', venvDir])
	if (!existsSync(venvPython)) {
		console.error('[venv] Virtualenv was not created; ensure Python is installed and available as OSU_DASH_PYTHON_BIN or python3')
		process.exit(1)
	}
}

function installDeps() {
	const pkgs = ['pip', 'wheel', 'circleguard']
	for (let i = 0; i < pkgs.length; i++) {
		const pkg = pkgs[i]
		const args = pkg === 'pip' ? ['install', '-U', 'pip'] : ['install', pkg]
		runOrExit(pipBin, args)
	}
}

ensureVenv()
installDeps()
