"""Full AEA/model/protocol/behaviour constructors and the real Pebble scheduler.

Only the external IPFS/chain effect boundary is captured. No AST, import mocks,
constructor bypass, synchronous executor or ledger service is used here.
"""
import json
from pathlib import Path
from queue import Queue
from types import SimpleNamespace
import time

import yaml
from aea.context.base import AgentContext
from aea.common import Address
from aea.protocols.base import Message
from aea.protocols.dialogue.base import Dialogue
from aea.identity.base import Identity
from aea.skills.base import Skill, SkillContext
from aea.configurations.base import SkillConfig
from packages.valory.protocols.ipfs import IpfsMessage
from packages.valory.protocols.ipfs.dialogues import IpfsDialogue, IpfsDialogues
from packages.valory.skills.task_execution.models import Params
from packages.valory.skills.task_execution.behaviours import TaskExecutionBehaviour

ROOT = Path(__file__).resolve().parent
MECH = '0x' + '1' * 40


def ipfs_role(message: Message, receiver_address: Address) -> Dialogue.Role:
    return IpfsDialogue.Role.SKILL


class EffectBoundaryOutbox:
    """Capture real protocol messages instead of routing to an IPFS connection."""
    def __init__(self):
        self.messages = []

    def put_message(self, message, **kwargs):
        self.messages.append(message)


class WholeRuntime:
    def __init__(self):
        self.outbox = EffectBoundaryOutbox()
        agent = AgentContext(identity=Identity('reader_qa', address=MECH, public_key='FIXTURE_NO_SIGNER'),
                             connection_status=None, outbox=self.outbox,
                             decision_maker_message_queue=Queue(), decision_maker_handler_context=SimpleNamespace(),
                             task_manager=None, default_ledger_id='ethereum', currency_denominations={},
                             default_connection=None, default_routing={}, search_service_address='',
                             decision_maker_address='', data_dir=str(ROOT))
        context = SkillContext(agent_context=agent)
        self.skill = Skill(SkillConfig('task_execution', 'valory', '0.1.0', license_='Apache-2.0'), skill_context=context)
        # Source defaults, with only explicit QA event/config values selected.
        config = yaml.safe_load((ROOT / 'upstream/skill.yaml').read_text())
        args = dict(config['models']['params']['args'])
        args.update(mech_to_config={MECH: {'is_marketplace_mech': True, 'use_dynamic_pricing': False}},
                    mech_to_max_delivery_rate={}, api_keys={}, tools_to_package_hash={'public_page_reader': 'LOCAL_UNPUBLISHED_TOOL'},
                    tools_to_pricing={}, task_deadline=20.0, use_offchain=False,
                    mech_marketplace_address='0x' + '0' * 40, default_chain_id='base')
        context.params = Params(name='params', skill_context=context, **args)
        context.ipfs_dialogues = IpfsDialogues(self_address=str(context.skill_id),
            role_from_first_message=ipfs_role)
        self.behaviour = TaskExecutionBehaviour(name='task_execution', skill_context=context)
        self.behaviour.setup()
        self.next_id = 1
        self.load_tool()

    def load_tool(self, source=None):
        b = self.behaviour
        b._inflight_tool_req = 'public_page_reader'
        files = {'component.yaml': (ROOT / 'component.yaml').read_text(),
                 'public_page_reader.py': source or (ROOT / 'public_page_reader.py').read_text()}
        message = IpfsMessage(performative=IpfsMessage.Performative.FILES, files=files)
        b._handle_get_tool(message, None)

    def execute(self, prompt, outer=None):
        b = self.behaviour
        self.next_id += 1
        # Received on-chain event metadata at the explicitly disabled chain boundary.
        b._executing_task = {'requestId': self.next_id, 'priorityMech': MECH, 'contract_address': MECH}
        b._invalid_request = False
        b._ipfs_error_reason = None
        b._async_result = None
        b._request_handling_deadline = None
        b.tool_preparation_start_time = time.perf_counter()
        self.outbox.messages.clear()
        task = {'tool': 'public_page_reader', 'prompt': prompt}
        if outer:
            task.update(outer)
        message = IpfsMessage(performative=IpfsMessage.Performative.FILES, files={'request.json': json.dumps(task)})
        b._handle_get_task(message, None)
        future = b._async_result
        if future:
            try:
                future.result(timeout=25)
            except Exception:
                pass
        result = b._get_executing_task_result()
        b._handle_done_task(result)
        stored = self.outbox.messages[-1]
        assert isinstance(stored, IpfsMessage) and stored.performative == IpfsMessage.Performative.STORE_FILES
        response = json.loads(stored.files[str(self.next_id)])
        return result, response, dict(b._done_task)

    def close(self):
        self.behaviour._executor.close()
        self.behaviour._executor.join(timeout=10)
