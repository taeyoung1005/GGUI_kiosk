from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app as app_module


class SharedEnvLoadingTest(unittest.TestCase):
    def test_module_a_reads_openai_key_from_root_env_local(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env.local").write_text(
                "OPENAI_API_KEY=sk-shared-ggui-key\nGGUI_MODE=ggui\n",
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                app_module.load_shared_dotenv(root)

                self.assertEqual(os.environ["OPENAI_API_KEY"], "sk-shared-ggui-key")

    def test_existing_shell_openai_key_wins_over_root_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env.local").write_text("OPENAI_API_KEY=sk-from-root\n", encoding="utf-8")

            with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-shell"}, clear=True):
                app_module.load_shared_dotenv(root)

                self.assertEqual(os.environ["OPENAI_API_KEY"], "sk-shell")


if __name__ == "__main__":
    unittest.main()
