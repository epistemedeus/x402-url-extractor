"""Run one local read through the pinned official loader and ProcessPool."""
import argparse
import json
from whole_runtime import WholeRuntime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--limit', type=int, default=40000)
    args = parser.parse_args()
    runtime = WholeRuntime()
    try:
        result, response, done = runtime.execute(json.dumps({
            'operation': 'read', 'url': args.url, 'markdownLimitChars': args.limit}))
        if result is None:
            print(json.dumps({'runtimeError': response['result']}))
            return 1
        if result[1:4] != ('', None, None) or done['transaction'] is not None:
            raise RuntimeError('unexpected tool result slots')
        print(json.dumps(json.loads(response['result']), ensure_ascii=True, indent=2))
        return 0
    finally:
        runtime.close()


if __name__ == '__main__':
    raise SystemExit(main())
