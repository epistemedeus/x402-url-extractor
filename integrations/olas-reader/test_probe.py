import copy
import hashlib
import json
import unittest
from pathlib import Path

import yaml

import harness
import diagnostic_adapter as adapter
from fake_reader import FakeReader, TABLE

URL = 'https://reader.example/table'


def request(prompt=None, **extra):
    return dict(tool='public_page_reader', prompt=prompt or json.dumps({'operation': 'read', 'url': URL}), **extra)


class PackagedPartialTests(unittest.TestCase):
    def test_source_custody_and_package_fingerprints(self):
        rows = json.loads((harness.UP / 'SOURCES.json').read_text())
        names = {'selected-ipfs': 'ipfs.py', 'selected-task': 'task.py',
                 'selected-behaviours': 'behaviours.py', 'selected-local-cid': 'local_cid.py',
                 'packaged-license': 'LICENSE', 'selected-apis': 'apis.py',
                 'selected-benchmarks': 'benchmarks.py', 'selected-skill': 'skill.yaml'}
        cid = harness.load_module('cid_fingerprint_test', harness.UP / 'local_cid.py').compute_cidv1
        skill = yaml.safe_load((harness.UP / 'skill.yaml').read_text())
        for row in rows:
            if row['label'] not in names:
                continue
            name = names[row['label']]
            body = (harness.UP / name).read_bytes()
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256(body).hexdigest(), row['sha256'])
                if name not in ('LICENSE', 'skill.yaml'):
                    rel = name if name == 'behaviours.py' else 'utils/' + name
                    self.assertEqual(cid(body), skill['fingerprint'][rel])
        self.assertEqual(yaml.__version__, '6.0.1')

    def test_whole_behaviour_import_observation_is_not_frozen_to_missing_aea(self):
        boundary = harness.full_behaviour_import_boundary()
        self.assertIn('accepted', boundary)
        if not boundary['accepted']:
            self.assertIsInstance(boundary['missing'], str)
        # Historical missing-AEA receipt stays in previous diagnostic, never a permanent requirement.

    def test_official_loader_negative_then_recovery(self):
        source = (harness.ROOT / 'diagnostic_adapter.py').read_text()
        for files in [{}, {'component.yaml': '{}'},
                      {'component.yaml': 'entry_point: missing.py\ncallable: run'}]:
            with self.subTest(files=list(files)):
                with self.assertRaises(ValueError):
                    harness.Loader.load(files)
        config, code, name = harness.Loader.load({'component.yaml': (harness.ROOT / 'component.yaml').read_text(), 'public_page_reader.py': source})
        self.assertEqual((code, name), (source, 'run'))
        result = harness.Runner().execute(tool_py=code, callable_method=name,
                                          **request(_reader_transport=FakeReader()))
        self.assertEqual(json.loads(result[0])['markdown'], TABLE)
        self.assertEqual(result[1:4], ('', None, None))

    def test_useful_outputs_match_direct_contract_through_packaged_source_slice(self):
        for mode, limit in [('table', 40000), ('text', 40000), ('text', 12), ('omitted', 40000), ('refusal', 40000), ('public_redirect', 40000)]:
            with self.subTest(mode=mode, limit=limit):
                backend = FakeReader(mode)
                expected = FakeReader(mode)(URL, limit, adapter.validate_url)
                obj = harness.make_diagnostic(backend)
                keys = obj._keychain
                result, response = harness.dispatch_diagnostic(obj, request(json.dumps({'operation': 'read', 'url': URL, 'markdownLimitChars': limit})))
                self.assertEqual(json.loads(result[0]), expected)
                self.assertEqual(json.loads(response['result']), expected)
                self.assertEqual(result[1:4], ('', None, None))
                self.assertIs(result[4], keys)
                self.assertIs(obj._keychain, keys)
                self.assertIsNone(obj._done_task['transaction'])
                self.assertEqual(response['prompt'], '')
                self.assertEqual(response['cost_dict'], {})
                self.assertEqual(backend.calls, 1)
                self.assertEqual(obj._executor.calls, 1)
                self.assertNotIn('AUTH_SENTINEL', json.dumps(response))
                self.assertNotIn('AUTH_SENTINEL', json.dumps(obj._done_task))
                if mode == 'table':
                    for value in ['rowspan="2"', 'colspan="2"', '<td></td>', '#fn1', 'Preview']:
                        self.assertIn(value, json.loads(response['result'])['markdown'])

    def test_input_failures_prevent_transport_and_later_valid_read_recovers(self):
        invalid = ['{', 'null', '[]', '{"operation":"read","operation":"write","url":"https://reader.example/a"}',
                   json.dumps({'operation': 'write', 'url': URL}),
                   json.dumps({'operation': 'read', 'url': URL, 'headers': {'authorization': 'secret'}}),
                   json.dumps({'operation': 'read', 'url': URL, 'markdownLimitChars': True}),
                   json.dumps({'operation': 'read', 'url': URL, 'markdownLimitChars': 40001})]
        for url in ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/', 'http://10.0.0.1/',
                    'http://192.168.1.1/', 'http://localhost/', 'http://app.local/', 'http://2130706433/',
                    'http://0177.0.0.1/', 'http://0x7f000001/', 'https://u:p@reader.example/', 'file:///etc/passwd']:
            invalid.append(json.dumps({'operation': 'read', 'url': url}))
        for raw in invalid:
            backend = FakeReader()
            obj = harness.make_diagnostic(backend)
            with self.subTest(raw=raw):
                result, response = harness.dispatch_diagnostic(obj, request(raw))
                self.assertIsNone(result)
                self.assertEqual(response['result'], 'Invalid response')
                self.assertEqual(backend.calls, 0)
                self.assertNotIn('transaction', obj._done_task)
        backend = FakeReader()
        result, response = harness.dispatch_diagnostic(harness.make_diagnostic(backend), request())
        self.assertEqual(json.loads(response['result'])['markdown'], TABLE)

    def test_runtime_malformed_json_is_not_a_reader_or_transaction(self):
        backend = FakeReader()
        obj = harness.make_diagnostic(backend)
        result, response = harness.dispatch_diagnostic(obj, '{')
        self.assertTrue(obj._invalid_request)
        self.assertEqual(obj._executor.calls, 0)
        self.assertEqual(backend.calls, 0)
        self.assertEqual(response['result'], 'Invalid response')

    def test_private_redirect_and_malformed_backend_fail_without_delivery_record(self):
        for mode in ['private_redirect', 'malicious_final', 'malformed']:
            backend = FakeReader(mode)
            obj = harness.make_diagnostic(backend)
            with self.subTest(mode=mode):
                result, response = harness.dispatch_diagnostic(obj, request())
                self.assertIsNone(result)
                self.assertEqual(response['result'], 'Invalid response')
                self.assertEqual(backend.calls, 1)
                self.assertFalse(any('127.0.0.1' in hop for hop in backend.hops))
                self.assertNotIn('AUTH_SENTINEL', json.dumps(response))

    def test_transport_timeout_unknown_outcome_no_replay_and_explicit_later_retry(self):
        for mode, code in [('timeout', 'transport_timeout_no_automatic_retry'),
                           ('unknown', 'transport_outcome_unknown_no_automatic_retry')]:
            backend = FakeReader(mode)
            with self.subTest(mode=mode):
                with self.assertRaises(adapter.ProbeError) as error:
                    adapter.run(**request(_reader_transport=backend))
                self.assertEqual(error.exception.code, code)
                self.assertEqual(backend.calls, 1)
                result, response = harness.dispatch_diagnostic(harness.make_diagnostic(backend), request())
                self.assertIsNone(result)
                self.assertEqual(backend.calls, 2)  # exactly one call per explicit attempt
                self.assertEqual(response['result'], 'Invalid response')
                backend.mode = 'text'
                result, response = harness.dispatch_diagnostic(harness.make_diagnostic(backend), request())
                self.assertTrue(json.loads(response['result'])['sourceOk'])
                self.assertEqual(backend.calls, 3)
        backend = FakeReader()
        with self.assertRaises(adapter.ProbeError):
            adapter.run(**request(json.dumps({'operation': 'mutate', 'url': URL}), _reader_transport=backend))
        self.assertEqual(backend.calls, 0)

    def test_tutorial_context_slot_is_retained_as_transaction_in_actual_consumer_slice(self):
        # This intentionally unsafe tuple is never sent to a transport or chain.
        obj = harness.make_diagnostic(FakeReader())
        obj._executing_task.update(tool='public_page_reader', params={})
        context = {'reader_context': 'TUTORIAL_HAZARD'}
        obj._handle_done_task(('text', '', context, None, obj._keychain))
        self.assertIs(obj._done_task['transaction'], context)
        self.assertNotIn('TUTORIAL_HAZARD', json.dumps(obj.stored))
        # Both five and six slots are accepted by THIS registry package's source.
        obj._handle_done_task(('text', '', None, None, {'operation': 'read'}, obj._keychain))
        response = json.loads(obj.stored[-1]['1'])
        self.assertEqual(response['metadata']['params'], {'operation': 'read'})
        self.assertIsNone(obj._done_task['transaction'])
        obj._handle_done_task(('text', '', None))
        self.assertEqual(json.loads(obj.stored[-1]['1'])['result'], 'Invalid response')

    def test_unconfigured_tool_and_untrusted_callable_refuse(self):
        for extra in [{}, {'_reader_transport': 'https://attacker.example'}, {'_reader_transport': {}}]:
            with self.assertRaises(adapter.ProbeError) as error:
                adapter.run(**request(**extra))
            self.assertEqual(error.exception.code, 'transport_not_configured')

    def test_malformed_contract_fields_are_rejected_without_field_invention(self):
        original = FakeReader()(URL, 40000, adapter.validate_url)
        variants = []
        for key, value in [('wordCount', True), ('status', '200'), ('markdown', []), ('sourceOk', 1), ('url', URL + '/different'), ('fetchedAt', 'not-a-date')]:
            bad = copy.deepcopy(original);bad[key] = value;variants.append(bad)
        bad = copy.deepcopy(original);bad['authorization'] = 'AUTH_SENTINEL';variants.append(bad)
        bad = copy.deepcopy(original);bad['capture']['javascriptExecuted'] = True;variants.append(bad)
        bad = copy.deepcopy(original);bad['capture']['markdownLimitChars'] = True;variants.append(bad)
        bad = copy.deepcopy(original);bad['markdown'] = '\U0001F600' * 20001;variants.append(bad)
        for bad in variants:
            with self.subTest(keys=list(bad)):
                with self.assertRaises(adapter.ProbeError):
                    adapter.run(**request(_reader_transport=lambda *args: bad))


if __name__ == '__main__':
    unittest.main()
