"""Olas tuple adapter for the fixed, pinned local guarded reader carrier.

Success is the original reader record. Adapter failures use a distinct declared
schema and retain refusal/unreceived/unknown without automatic retry.
"""
import json
from trusted_transport import read_page

ALLOWED_TOOLS = ['public_page_reader']
FAILURE_SCHEMA = 'pilot.public-page-reader.failure.v1'


def _pairs(items):
    result = {}
    for k, v in items:
        if k in result:
            raise ValueError('duplicate_json_key')
        result[k] = v
    return result


def failure(code, outcome='refused'):
    return {'schema': FAILURE_SCHEMA, 'error': {'code': code, 'outcome': outcome},
            'retry': 'explicit_new_read_only_attempt'}


def run(**kwargs):
    try:
        if kwargs.get('tool') != 'public_page_reader':
            raise ValueError('unsupported_tool')
        prompt = kwargs.get('prompt')
        if not isinstance(prompt, str) or len(prompt.encode('utf-8')) > 4096:
            raise ValueError('invalid_prompt')
        try:
            request = json.loads(prompt, object_pairs_hook=_pairs,
                                 parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid_json')))
        except (ValueError, RecursionError):
            raise ValueError('invalid_json') from None
        if type(request) is not dict or not {'operation', 'url'} <= set(request) or set(request) - {'operation', 'url', 'markdownLimitChars'}:
            raise ValueError('invalid_request')
        if request['operation'] != 'read':
            raise ValueError('unsupported_operation')
        limit = request.get('markdownLimitChars', 40000)
        if type(limit) is not int or not 1 <= limit <= 40000 or type(request['url']) is not str or len(request['url']) > 2048:
            raise ValueError('invalid_request')
        # The maintained WHATWG URL guard is the only URL/DNS/redirect policy.
        # No caller-controlled transport/command/header/callback is used.
        response = read_page(request['url'], limit)
        if response.get('kind') == 'reader':
            result = response['value']
        else:
            result = failure(response['code'], response['outcome'])
    except ValueError as error:
        result = failure(str(error) if str(error) in {'invalid_json', 'invalid_prompt', 'invalid_request', 'unsupported_tool', 'unsupported_operation'} else 'invalid_request')
    except Exception:
        result = failure('adapter_result_unreceived', 'unknown')
    return json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(',', ':')), '', None, None, kwargs.get('api_keys')
