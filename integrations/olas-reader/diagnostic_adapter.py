"""Offline-only reader adapter. No HTTP, payment, key or automatic retry path.

The injected transport owns guarded DNS, redirects and the existing reader. It
must invoke validate_url before each source hop. No request selects a transport.
Reader records are passed through, never extracted or repaired here.
"""
import ipaddress
import json
import re
from datetime import datetime
from urllib.parse import urlsplit

ALLOWED_TOOLS = ["public_page_reader"]
READER_KEYS = {"ok", "requestedUrl", "finalUrl", "url", "status", "sourceOk", "error",
               "title", "markdown", "wordCount", "truncated", "capture", "fetchedAt"}
CAPTURE_KEYS = {"method", "javascriptExecuted", "maxBodyBytes", "textExcerptLimitChars",
                "markdownLimitChars", "bodyBytes", "bodyTruncated", "textTruncated",
                "charset", "charsetSource"}


class ProbeError(ValueError):
    """Adapter failure; diagnostics never include backend messages or auth data."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


def validate_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) <= 32 for c in value):
        raise ProbeError("invalid_url")
    try:
        u = urlsplit(value)
        host = (u.hostname or "").rstrip(".").lower()
        port = u.port
        if u.scheme not in ("http", "https") or not host or u.username is not None or u.password is not None or u.fragment:
            raise ValueError()
        if port not in (None, 80, 443) or "%" in host or "\\" in value or not host.isascii():
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if "." not in host or host.endswith((".local", ".localhost", ".internal", ".test")) or host == "localhost":
                raise ValueError()
            # Reject ambiguous numeric IPv4 forms, which some HTTP stacks normalize.
            if all(c in "0123456789abcdefx." for c in host) or any(not part or part.startswith('-') or part.endswith('-') or not all(c.isalnum() or c == '-' for c in part) for part in host.split('.')):
                raise ValueError()
        else:
            if not address.is_global:
                raise ValueError()
    except (ValueError, TypeError):
        raise ProbeError("non_public_url") from None
    return value


def _load_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProbeError("duplicate_json_key")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ProbeError("invalid_json")))
    except (ValueError, TypeError, RecursionError):
        raise ProbeError("invalid_json") from None


def _valid_record(record, requested, limit):
    """Narrow shape check for pinned extract.mjs readMcpOutputSchema only."""
    if type(record) is not dict or set(record) != READER_KEYS:
        return False
    c = record['capture']
    if type(c) is not dict or set(c) != CAPTURE_KEYS:
        return False
    if record['ok'] is not True or type(record['sourceOk']) is not bool or type(record['truncated']) is not bool:
        return False
    if type(record['status']) is not int or not 100 <= record['status'] <= 599 or type(record['wordCount']) is not int or record['wordCount'] < 0:
        return False
    if not all(type(record[k]) is str for k in ['requestedUrl', 'finalUrl', 'url', 'title', 'markdown', 'fetchedAt']):
        return False
    if record['requestedUrl'] != requested or record['url'] != record['finalUrl'] or len(record['markdown'].encode('utf-16-le')) // 2 > limit:
        return False
    for field in ['requestedUrl', 'finalUrl', 'url']:
        validate_url(record[field])
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z', record['fetchedAt']):
        return False
    try:
        datetime.fromisoformat(record['fetchedAt'].replace('Z', '+00:00'))
    except ValueError:
        return False
    error = record['error']
    if error is not None and (type(error) is not dict or set(error) != {'code', 'message'} or not all(type(v) is str for v in error.values())):
        return False
    if c['method'] != 'http-get-no-javascript' or c['javascriptExecuted'] is not False or c['textExcerptLimitChars'] is not None or type(c['markdownLimitChars']) is not int or c['markdownLimitChars'] != limit:
        return False
    if any(type(c[k]) is not int or c[k] < 0 for k in ['maxBodyBytes', 'bodyBytes']) or c['bodyBytes'] > c['maxBodyBytes']:
        return False
    if any(type(c[k]) is not bool for k in ['bodyTruncated', 'textTruncated']):
        return False
    if c['charset'] is not None and type(c['charset']) is not str:
        return False
    return c['charsetSource'] in ['content-type', 'html-meta', 'default-utf-8', 'invalid-charset-fallback']


def run(**kwargs):
    if kwargs.get('tool') != 'public_page_reader':
        raise ProbeError('unsupported_tool')
    prompt = kwargs.get('prompt')
    if not isinstance(prompt, str) or len(prompt.encode('utf-8')) > 4096:
        raise ProbeError('invalid_prompt')
    request = _load_json(prompt)
    if type(request) is not dict or not {'operation', 'url'} <= set(request) or set(request) - {'operation', 'url', 'markdownLimitChars'}:
        raise ProbeError('invalid_request')
    if request['operation'] != 'read':
        raise ProbeError('unsupported_operation')
    url = validate_url(request['url'])
    limit = request.get('markdownLimitChars', 40000)
    if type(limit) is not int or not 1 <= limit <= 40000:
        raise ProbeError('invalid_limit')
    transport = kwargs.get('_reader_transport')
    if not callable(transport):
        raise ProbeError('transport_not_configured')
    try:
        # No keys/callbacks/headers/prompt are passed to the reader boundary.
        record = transport(url, limit, validate_url)
    except ProbeError:
        raise
    except TimeoutError:
        raise ProbeError('transport_timeout_no_automatic_retry') from None
    except Exception:
        # A missing response establishes no effect outcome. Never replay here.
        raise ProbeError('transport_outcome_unknown_no_automatic_retry') from None
    try:
        if not _valid_record(record, url, limit):
            raise ProbeError('malformed_reader_response')
        serialized = json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        if len(serialized.encode('utf-8')) > 262144:
            raise ProbeError('reader_response_too_large')
    except (TypeError, ValueError, RecursionError):
        raise ProbeError('malformed_reader_response') from None
    # Slot 3 is transaction; slot 4 is callback. Preserve the injected runtime keychain
    # by identity in slot 5; never serialize any runtime keychain or callback.
    return serialized, '', None, None, kwargs.get('api_keys')
