"""Executable partial, with a separately labelled behaviour source-slice diagnostic.

This does not make unavailable framework imports pass. Whole-module acceptance
is recorded separately and must not be inferred from the diagnostic.
"""
import ast
import functools
import importlib.util
import json
import logging
import sys
import time
import types
import typing
from concurrent.futures import Future
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parent
UP = ROOT / 'upstream'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def full_behaviour_import_boundary():
    """Attempt the real full module without import mocks or AST edits."""
    try:
        load_module('olas_whole_behaviour_import', UP / 'behaviours.py')
    except ImportError as error:
        return {'accepted': False, 'exception': type(error).__name__, 'missing': error.name}
    return {'accepted': True}


def unavailable(*args, **kwargs):
    raise AssertionError('unavailable IPFS CID/transport operation was invoked')


def load_real_loader():
    """Load full ipfs.py; only unused external CID imports are sentinels."""
    cid = types.ModuleType('aea.helpers.cid')
    cid.CID = types.SimpleNamespace(from_string=unavailable)
    cid.to_v1 = unavailable
    codecs = types.ModuleType('aea.helpers.multiformat')
    codecs.multibase_decode = codecs.multicodec_remove_prefix = unavailable
    with patch.dict(sys.modules, {'aea.helpers.cid': cid, 'aea.helpers.multiformat': codecs}):
        return load_module('olas_package_loader', UP / 'ipfs.py').ComponentPackageLoader


Runner = load_module('olas_task_executor', UP / 'task.py').AnyToolAsTask
KeyChain = load_module('olas_keychain', UP / 'apis.py').KeyChain
TokenCounterCallback = load_module('olas_callback', UP / 'benchmarks.py').TokenCounterCallback
Loader = load_real_loader()


class SerialExecutor:
    """Only scheduler boundary is synchronous; runner/entrypoint execute unchanged."""
    def __init__(self, transport):
        self.transport = transport
        self.calls = 0

    def schedule(self, fn, args, kwargs, timeout):
        self.calls += 1
        assert timeout == 1.0
        future = Future()
        try:
            trusted = dict(kwargs, _reader_transport=self.transport)
            future.set_result(fn(*args, **trusted))
        except Exception as error:
            future.set_exception(error)
        return future


class Metrics:
    def __getattr__(self, name):
        return lambda *args, **kwargs: None


METHODS = {'params', '_get_designated_marketplace_mech_address', '_handle_get_tool',
           '_handle_get_task', '_prepare_task', '_submit_task',
           '_get_executing_task_result', '_handle_done_task'}


def diagnostic_behaviour_class():
    """Compile exact original AST nodes, never edit/recreate tuple logic.

    This source-slice diagnostic explicitly excludes full framework import,
    constructor/setup, ProcessPool and delivery/finalization acceptance.
    """
    tree = ast.parse((UP / 'behaviours.py').read_text())
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'TaskExecutionBehaviour')
    body = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in METHODS]
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'_iso_z', '_source_label'}]
    sliced = ast.Module(body=funcs + [ast.ClassDef(name='DiagnosticBehaviour', bases=[], keywords=[], body=body, decorator_list=[])], type_ignores=[])
    ast.fix_missing_locations(sliced)
    ns = dict(vars(typing), json=json, time=time, datetime=datetime, timezone=timezone,
              functools=functools, Source=str, SOURCE_ONCHAIN='onchain', SOURCE_OFFCHAIN='offchain',
              Params=object, IpfsMessage=object, Dialogue=object, Future=Future,
              TokenCounterCallback=TokenCounterCallback, AnyToolAsTask=Runner,
              ComponentPackageLoader=Loader, RESPONSE_SCHEMA_VERSION='2.0',
              IPFS_MAX_TASK_BYTES=1048576, MAX_PROMPT_BYTES=100000,
              IN_MEMORY_REQUESTS='in_memory_requests',
              FAILURE_REASON_EXECUTION_FAILED='execution_failed')
    exec(compile(sliced, str(UP / 'behaviours.py'), 'exec'), ns)
    return ns['DiagnosticBehaviour']


DiagnosticBehaviour = diagnostic_behaviour_class()


def make_diagnostic(transport):
    obj = DiagnosticBehaviour()
    logger = logging.getLogger('olas-reader-probe')
    params = types.SimpleNamespace(task_deadline=1.0, mech_to_config={
        'fixture-mech': types.SimpleNamespace(is_marketplace_mech=True)})
    obj.context = types.SimpleNamespace(logger=logger, params=params, shared_state={}, agent_address='fixture-executor')
    obj._executor = SerialExecutor(transport)
    obj._keychain = KeyChain({'fixture': ['AUTH_SENTINEL_DO_NOT_SERIALIZE']})
    obj._all_tools = {}
    obj._inflight_tool_req = 'public_page_reader'
    obj._tools_to_package_hash = {'public_page_reader': 'LOCAL_UNPUBLISHED_TOOL'}
    obj._tools_to_pricing = {}
    obj._executing_task = {'requestId': 1, 'priorityMech': 'fixture-mech', 'contract_address': 'fixture-mech'}
    obj._request_handling_deadline = None
    obj._invalid_request = False
    obj._ipfs_error_reason = None
    obj._async_result = None
    obj.tool_preparation_start_time = time.perf_counter()
    obj.tool_execution_start_time = 0.0
    obj.mech_metrics = Metrics()
    obj.stored = []
    # Explicit IPFS output transport boundary: capture bytes, no callback/delivery.
    obj._build_ipfs_store_file_req = lambda files: (files, None)
    obj.send_message = lambda message, dialogue, callback: obj.stored.append(message)
    obj._handle_store_response = unavailable
    files = {'component.yaml': (ROOT / 'component.yaml').read_text(),
             'public_page_reader.py': (ROOT / 'diagnostic_adapter.py').read_text()}
    obj._handle_get_tool(types.SimpleNamespace(files=files), None)
    return obj


def dispatch_diagnostic(obj, request):
    files = {'request.json': request if isinstance(request, str) else json.dumps(request)}
    obj._handle_get_task(types.SimpleNamespace(files=files), None)
    result = obj._get_executing_task_result()
    obj._handle_done_task(result)
    response = json.loads(obj.stored[-1]['1'])
    return result, response
