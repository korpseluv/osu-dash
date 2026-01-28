#!/usr/bin/env python3
"""Compute UR with Circleguard and emit JSON to stdout.

Outputs either {"ur": <number>} or {"error": <string>, ...}.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
import os
from inspect import signature


def emit(payload: dict, exit_code: int = 0) -> None:
	sys.stdout.write(json.dumps(payload))
	sys.stdout.flush()
	sys.exit(exit_code)


def main() -> int:
	if len(sys.argv) < 2:
		emit({"error": "missing_replay_path", "argv": sys.argv[1:]}, 1)

	replay_path = Path(sys.argv[1]).expanduser()
	try:
		replay_path = replay_path.resolve(strict=True)
	except FileNotFoundError:
		emit({"error": "replay_not_found", "path": str(replay_path)}, 1)

	try:
		from circleguard import Circleguard, ReplayPath
	except Exception as exc:  # pragma: no cover - dependency import guard
		emit(
			{
				"error": "import_failed",
				"detail": str(exc),
				"python": sys.executable,
				"version": sys.version,
			},
			1,
		)

	try:
		# Circleguard API changed to require a key in some versions.
		# Inspect the constructor and provide a key from the environment if needed.
		try:
			sig = signature(Circleguard)
			params = sig.parameters
		except Exception:
			params = {}

		if 'key' in params:
			env_key = os.environ.get('CIRCLEGUARD_KEY')
			if not env_key:
				emit({
					"error": "circleguard_key_missing",
					"detail": "Circleguard requires a key. Set CIRCLEGUARD_KEY in environment."},
					1,
				)
			cg = Circleguard(env_key)
		else:
			cg = Circleguard()

		rp = ReplayPath(str(replay_path))
		ur_value = cg.ur(rp)
		emit({"ur": float(ur_value) if ur_value is not None else None}, 0)
	except Exception as exc:  # pragma: no cover - runtime guard
		emit(
			{
				"error": "ur_failed",
				"detail": str(exc),
				"trace": traceback.format_exc(limit=3),
			},
			1,
		)

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
