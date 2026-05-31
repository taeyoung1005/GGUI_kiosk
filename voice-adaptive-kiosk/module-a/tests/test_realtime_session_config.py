from __future__ import annotations

import unittest

import app as app_module


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_realtime_session_config_includes_agent_tools_fallback(self) -> None:
        menu = {
            "restaurant": "OBA Cafe",
            "items": [
                {
                    "id": "caffe-latte-003",
                    "name": "카페라떼",
                    "category": "Latte",
                    "price": 4500,
                    "options": [
                        {
                            "type": "온도",
                            "choices": [{"label": "뜨겁게", "price_delta": 0}],
                        }
                    ],
                }
            ],
        }

        config = app_module.build_realtime_session_config(menu)

        self.assertEqual(config["tool_choice"], "auto")
        self.assertIn("카페라떼", config["instructions"])
        self.assertIn("caffe-latte-003", config["instructions"])

        tools = {tool["name"]: tool for tool in config["tools"]}
        self.assertEqual(
            set(tools),
            {
                "select_item",
                "set_option",
                "set_fulfillment",
                "set_loyalty",
                "set_payment",
                "confirm_order",
                "cancel_order",
            },
        )
        self.assertEqual(
            tools["set_payment"]["parameters"]["properties"]["value"]["enum"],
            ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"],
        )


if __name__ == "__main__":
    unittest.main()
