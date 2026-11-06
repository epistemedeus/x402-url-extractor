#!/bin/sh
# Install the pinned Python consumers into <repo>/.python-consumer.
# cold-httpx.py and python-false-settlement.py add that directory to sys.path.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 -m pip install --disable-pip-version-check --target "$root/.python-consumer" -r "$root/python/consumer-requirements.txt"
