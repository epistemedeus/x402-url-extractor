"""Trusted fixed process bridge; request data cannot select code, paths or env."""
import ctypes
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
NODE = shutil.which('node')


def _die_with_parent(parent):
    libc = ctypes.CDLL(None)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # Linux PR_SET_PDEATHSIG
        os._exit(125)
    if os.getppid() != parent:
        os._exit(125)


def _read_fixed(command, environment, url, limit, observer=None):
    """One shared reader-process boundary, including fault-injection tests."""
    parent = os.getpid()
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          env=environment, start_new_session=True,
                          preexec_fn=lambda: _die_with_parent(parent)) as child:
        if observer is not None:
            observer(child.pid, parent)
        try:
            out, _ = child.communicate(json.dumps({'url': url, 'limit': limit}).encode(), timeout=15)
        except subprocess.TimeoutExpired:
            child.kill(); child.communicate()
            return {'kind': 'failure', 'code': 'bridge_timeout', 'outcome': 'unknown'}
        if child.returncode or len(out) > 524288:
            return {'kind': 'failure', 'code': 'bridge_result_unreceived', 'outcome': 'unknown'}
        try:
            record = json.loads(out)
        except (ValueError, UnicodeError):
            return {'kind': 'failure', 'code': 'bridge_result_unreceived', 'outcome': 'unknown'}
        if not isinstance(record, dict) or record.get('kind') not in ['reader', 'failure']:
            return {'kind': 'failure', 'code': 'bridge_result_malformed', 'outcome': 'unknown'}
        return record


def read_page(url, limit):
    """Fixed production command/config. Caller data supplies URL and limit only."""
    return _read_fixed([NODE, '--max-old-space-size=128', str(ROOT / 'reader-bridge.mjs')],
                       {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}, url, limit)
