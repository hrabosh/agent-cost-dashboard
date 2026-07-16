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


class BillingConfigTests(unittest.TestCase):
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
