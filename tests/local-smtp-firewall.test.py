import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "smtp_firewall", Path(__file__).resolve().parents[1] / "scripts/deploy/allow-local-smtp.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LocalSmtpFirewallTests(unittest.TestCase):
    def setUp(self):
        self.network = {"Driver": "bridge", "Internal": False, "Id": "a" * 64,
                        "Options": {}, "IPAM": {"Config": [{"Subnet": "172.23.0.0/16"}]}}
        self.addresses = [{"ifname": "eth0", "addr_info": [{"local": "192.0.2.10"}]},
                          {"ifname": "br-" + "a" * 12, "addr_info": []}]

    def test_rule_is_limited_to_installation_interface_subnet_destination_and_submission(self):
        rule = module.firewall_rule(self.network, self.addresses, "192.0.2.10", 587)
        self.assertEqual(rule[:14], ["ufw", "allow", "in", "on", "br-" + "a" * 12,
                                    "from", "172.23.0.0/16", "to", "192.0.2.10",
                                    "port", "587", "proto", "tcp", "comment"])

    def test_rejects_remote_smtp_and_non_submission_ports(self):
        for destination, port in [("192.0.2.11", 587), ("192.0.2.10", 25)]:
            with self.subTest(destination=destination, port=port), self.assertRaises(ValueError):
                module.firewall_rule(self.network, self.addresses, destination, port)

    def test_rejects_wrong_bridge_or_overbroad_subnet(self):
        for field, value in [("Driver", "host"), ("Internal", True),
                             ("IPAM", {"Config": [{"Subnet": "0.0.0.0/0"}]}),
                             ("Options", {"com.docker.network.bridge.name": "missing"})]:
            network = copy.deepcopy(self.network)
            network[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.firewall_rule(network, self.addresses, "192.0.2.10", 587)


if __name__ == "__main__":
    unittest.main()
