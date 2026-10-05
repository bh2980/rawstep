import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "examples/screenshot"))
from prompt_control import client_prompt


class PromptControlTest(unittest.TestCase):
    def test_legacy_template_remains_server_owned(self):
        self.assertIsNone(client_prompt({}, {}, []))

    def test_client_instructions_require_explicit_negotiation(self):
        with self.assertRaises(ValueError):
            client_prompt({"instructions": "Unnegotiated"}, {}, [])

    def test_client_template_keeps_state_choices_and_prompt_evidence(self):
        choices = [{"id": "key:Tab", "label": "Tab"}, {"id": "stop:stuck", "label": "Stop"}]
        request = {"promptControl": "client-v1", "instructions": "사용자 지침", "prompt": {"id": "careful", "version": "2"}, "purpose": "action"}
        text, evidence = client_prompt(request, {"goal": "Goal", "current_screen": "<image:1>"}, choices)
        self.assertIn("사용자 지침", text)
        self.assertIn("<image:1>", text)
        self.assertIn("key:Tab", text)
        self.assertEqual(evidence["id"], "careful")
        self.assertEqual(evidence["version"], "2")
        self.assertEqual(len(evidence["sha256"]), 64)
        self.assertNotEqual(evidence["sha256"], client_prompt({**request, "instructions": "Changed"}, {}, choices)[1]["sha256"])

    def test_rejects_oversized_instructions_and_reserved_media(self):
        base = {"promptControl": "client-v1", "prompt": {"id": "p", "version": "1"}}
        for instructions in ["x" * 16385, "<image:1>", ""]:
            with self.assertRaises(ValueError):
                client_prompt({**base, "instructions": instructions}, {}, [])


if __name__ == "__main__":
    unittest.main()
