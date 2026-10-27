"""Rights-cleared synthetic output fake of the pinned reader contract. No parser.

This models a guarded existing-reader boundary, NOT real DNS or source HTTP.
Values correspond to extract.mjs readMcpOutputSchema; no trial/payment is called.
"""
import copy
import json
from pathlib import Path

TABLE = '<table><tr><th rowspan="2">Engine</th><th colspan="2">Support</th></tr><tr><th>Transpile</th><th>Reconcile</th></tr><tr><td>Alpha</td><td></td><td>Yes<sup><a href="https://reader.example/table#fn1">1</a></sup></td></tr><tr><td colspan="3"><span id="fn1">Preview</span></td></tr></table>'


class FakeReader:
    def __init__(self, mode='table'):
        self.mode = mode
        self.calls = 0
        self.hops = []
        self.completed = 0

    def __call__(self, url, limit, validate_url):
        self.calls += 1
        validate_url(url)
        self.hops.append(url)
        if self.mode == 'timeout':
            raise TimeoutError('AUTH_SENTINEL_DO_NOT_SERIALIZE')
        if self.mode == 'unknown':
            raise ConnectionError('AUTH_SENTINEL_DO_NOT_SERIALIZE')
        final = url
        if self.mode in ['private_redirect', 'public_redirect']:
            final = 'http://127.0.0.1/private' if self.mode == 'private_redirect' else 'https://reader.example/final'
            validate_url(final)  # before a modeled hop; failure never reaches hops
            self.hops.append(final)
        if self.mode == 'malformed':
            return {'ok': True, 'signature': 'AUTH_SENTINEL_DO_NOT_SERIALIZE'}
        record = json.loads((Path(__file__).parent / 'fixtures/reader.json').read_text())
        record.update(requestedUrl=url, finalUrl=final, url=final)
        markdown = TABLE if self.mode == 'table' else 'A public document with useful text.'
        if self.mode == 'omitted':
            markdown = 'Table omitted: unsupported nested table.'
        record['markdown'] = markdown[:limit]
        record['wordCount'] = len(record['markdown'].split())
        record['truncated'] = len(markdown) > limit or self.mode == 'omitted'
        record['capture'].update(markdownLimitChars=limit, textTruncated=record['truncated'])
        if self.mode == 'refusal':
            record.update(status=403, sourceOk=False, error={'code': 'http_403', 'message': 'source HTTP 403'})
        if self.mode == 'malicious_final':
            record.update(finalUrl='http://127.0.0.1/private', url='http://127.0.0.1/private')
        self.completed += 1
        return copy.deepcopy(record)
