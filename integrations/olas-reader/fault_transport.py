"""Only test packets select these fixed fault transports; public input cannot."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import public_page_reader
from trusted_transport import ROOT, NODE, _read_fixed


def fault_read(mode, url, limit):
    if mode not in ['refusal', 'private_redirect', 'malformed', 'timeout', 'hang', 'unknown', 'nested']:
        raise ValueError('invalid fixed fault')
    def receipt(pid, parent):
        dest = os.environ.get('OLAS_READER_RESULTS')
        if dest:
            with (Path(dest)/'fault-children.jsonl').open('a') as f:
                f.write(json.dumps({'pid':pid,'parent':parent,'mode':mode})+'\n')
    return _read_fixed([NODE, '--max-old-space-size=128', '--import',
        str(ROOT / 'test-support/fault-hook.mjs'), str(ROOT / 'reader-bridge.mjs')],
        {'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','OLAS_READER_FAULT':mode}, url, limit, receipt)


def run_fault(mode, **kwargs):
    public_page_reader.read_page = lambda url, limit: fault_read(mode,url,limit)
    return public_page_reader.run(**kwargs)
