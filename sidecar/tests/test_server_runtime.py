import unittest

from sidecar.agent_pool import AgentPool
from sidecar.server import load_conversation_history, run_agent_turn


class FakeSessionDb:
    def __init__(self, messages):
        self._messages = messages

    def get_messages_as_conversation(self, session_id):
        return list(self._messages)


class FakeAgent:
    def __init__(self, messages=None):
        self._session_db = FakeSessionDb(messages or [])
        self._last_flushed_db_idx = 999
        self.session_id = "session-1"
        self.run_calls = []

    def run_conversation(self, prompt, conversation_history=None, stream_callback=None):
        self.run_calls.append(
            {
                "prompt": prompt,
                "conversation_history": conversation_history,
                "stream_callback": stream_callback,
            }
        )
        return {"final_response": "ok"}


class SidecarRuntimeTests(unittest.TestCase):
    def test_load_conversation_history_filters_session_meta(self):
        agent = FakeAgent(
            [
                {"role": "session_meta", "content": "ignore"},
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "world"},
            ]
        )

        restored = load_conversation_history(agent, "session-1")

        self.assertEqual(
            restored,
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "world"},
            ],
        )

    def test_run_agent_turn_restores_history_and_resets_flush_cursor(self):
        agent = FakeAgent(
            [
                {"role": "user", "content": "existing user"},
                {"role": "assistant", "content": "existing assistant"},
            ]
        )

        run_agent_turn(agent, "next turn", "session-1", lambda _token: None)

        self.assertEqual(agent._last_flushed_db_idx, 2)
        self.assertEqual(len(agent.run_calls), 1)
        self.assertEqual(
            agent.run_calls[0]["conversation_history"],
            [
                {"role": "user", "content": "existing user"},
                {"role": "assistant", "content": "existing assistant"},
            ],
        )

    def test_run_agent_turn_skips_history_restore_for_new_session(self):
        agent = FakeAgent()
        agent._last_flushed_db_idx = 5

        run_agent_turn(agent, "brand new", None, None)

        self.assertEqual(agent._last_flushed_db_idx, 5)
        self.assertIsNone(agent.run_calls[0]["conversation_history"])

    def test_pool_rekey_moves_agent_to_new_session_id(self):
        pool = AgentPool(runtime={}, max_size=2)
        agent = FakeAgent()

        pool.register("old-session", agent)
        pool.rekey("old-session", "new-session", agent)

        self.assertIs(pool.get_or_create("new-session"), agent)


if __name__ == "__main__":
    unittest.main()
