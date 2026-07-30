import os
import unittest
from unittest.mock import patch

import cost_dashboard


class PricingTests(unittest.TestCase):
    def test_gpt_5_6_sol_uses_official_standard_rates(self):
        previous = cost_dashboard._OPENROUTER_PRICING
        cost_dashboard._OPENROUTER_PRICING = {}
        try:
            cost = cost_dashboard.get_manual_cost(
                "gpt-5.6-sol",
                input_tokens=751_900,
                output_tokens=105_400,
                cache_read_tokens=15_100_000,
            )
            self.assertAlmostEqual(cost, 14.4715)
            self.assertTrue(cost_dashboard.model_has_pricing("gpt-5.6-sol"))
            self.assertFalse(cost_dashboard.model_has_pricing("unknown-model"))
        finally:
            cost_dashboard._OPENROUTER_PRICING = previous

    def test_gpt_5_6_alias_and_family_use_official_standard_rates(self):
        previous = cost_dashboard._OPENROUTER_PRICING
        cost_dashboard._OPENROUTER_PRICING = {}
        try:
            token_counts = {
                "input_tokens": 1_000_000,
                "output_tokens": 1_000_000,
                "cache_read_tokens": 1_000_000,
                "cache_write_tokens": 1_000_000,
            }
            self.assertAlmostEqual(
                cost_dashboard.get_manual_cost("gpt-5.6", **token_counts),
                41.75,
            )
            self.assertAlmostEqual(
                cost_dashboard.get_manual_cost("gpt-5.6-terra", **token_counts),
                16.7,
            )
            self.assertAlmostEqual(
                cost_dashboard.get_manual_cost("gpt-5.6-luna", **token_counts),
                1.67,
            )
        finally:
            cost_dashboard._OPENROUTER_PRICING = previous

    def test_latest_claude_models_have_provider_pricing(self):
        previous = cost_dashboard._OPENROUTER_PRICING
        cost_dashboard._OPENROUTER_PRICING = {}
        try:
            token_counts = {
                "input_tokens": 1_000_000,
                "output_tokens": 1_000_000,
                "cache_read_tokens": 1_000_000,
                "cache_write_tokens": 1_000_000,
            }
            expected = {
                "claude-opus-5": 36.75,
                "claude-fable-5": 73.5,
                "claude-mythos-5": 73.5,
                "claude-sonnet-5": 14.7,
            }
            for model, cost in expected.items():
                with self.subTest(model=model):
                    self.assertAlmostEqual(
                        cost_dashboard.get_manual_cost(model, **token_counts),
                        cost,
                    )
                    self.assertTrue(cost_dashboard.model_has_pricing(model))
        finally:
            cost_dashboard._OPENROUTER_PRICING = previous


class BillingConfigTests(unittest.TestCase):
    def test_deployment_defaults_to_tax_included_subscriptions(self):
        with patch.dict(os.environ, {}, clear=True):
            config = cost_dashboard.load_billing_config()
        self.assertEqual(config["currency"], "USD")
        self.assertEqual(config["monthly_subscription_cost"], 50)

    def test_loads_subscriptions_rates_and_rounding(self):
        values = {
            "AGENT_DASHBOARD_CURRENCY": "EUR",
            "AGENT_DASHBOARD_SUBSCRIPTIONS": (
                '{"openai":{"name":"ChatGPT Pro","monthly_cost":200},'
                '"anthropic":{"name":"Claude Max","monthly_cost":100}}'
            ),
            "AGENT_DASHBOARD_PROJECT_RATES": '{"client-project":85}',
            "AGENT_DASHBOARD_BILLING_INCREMENT": "15",
        }
        with patch.dict(os.environ, values, clear=False):
            config = cost_dashboard.load_billing_config()
        self.assertEqual(config["currency"], "EUR")
        self.assertEqual(config["monthly_subscription_cost"], 300)
        self.assertEqual(config["project_rates"]["client-project"], 85)
        self.assertEqual(config["billing_increment_minutes"], 15)
        self.assertEqual(config["warnings"], [])


if __name__ == "__main__":
    unittest.main()
