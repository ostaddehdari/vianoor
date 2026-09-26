#!/usr/bin/env python3
"""Allow authenticated SMTP from this installation's bridge to the local host."""
import argparse
import ipaddress
import json
import os
import shlex
import socket
import subprocess


def read_json(*command):
    return json.loads(subprocess.check_output(command, text=True))


def firewall_rule(network, addresses, destination, port):
    destination = str(ipaddress.IPv4Address(destination))
    if port not in (465, 587):
        raise ValueError("Only authenticated SMTP submission ports are supported")
    local = {a["local"] for item in addresses for a in item.get("addr_info", [])}
    if destination not in local:
        raise ValueError("SMTP destination must belong to this host")
    if network.get("Driver") != "bridge" or network.get("Internal"):
        raise ValueError("Expected a non-internal Docker bridge")
    subnets = [ipaddress.ip_network(c["Subnet"]) for c in network["IPAM"]["Config"]]
    subnets = [s for s in subnets if s.version == 4]
    if len(subnets) != 1 or not subnets[0].is_private or subnets[0].prefixlen < 16:
        raise ValueError("Expected one private IPv4 installation subnet, /16 or narrower")
    bridge = network.get("Options", {}).get("com.docker.network.bridge.name")
    bridge = bridge or "br-" + network["Id"][:12]
    if bridge not in {a["ifname"] for a in addresses}:
        raise ValueError("Docker bridge interface is not present on this host")
    return ["ufw", "allow", "in", "on", bridge, "from", str(subnets[0]),
            "to", destination, "port", str(port), "proto", "tcp",
            "comment", "Vianoor local SMTP submission"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="vianoor-stage4-identity-service-1")
    parser.add_argument("--network", default="vianoor-stage4_backend")
    parser.add_argument("--apply", action="store_true", help="Apply; default only previews")
    args = parser.parse_args()
    container = read_json("docker", "inspect", args.container)[0]
    if args.network not in container["NetworkSettings"]["Networks"]:
        raise ValueError("Identity container is not attached to the requested network")
    # Inspect privately: never print container environment or SMTP credentials.
    env = dict(item.split("=", 1) for item in container["Config"]["Env"])
    if env.get("AUTH_ENABLED") != "1" or env.get("AUTH_DEVELOPMENT") == "1":
        raise ValueError("Expected production identity service")
    if not env.get("SMTP_USER") or not env.get("SMTP_PASSWORD"):
        raise ValueError("SMTP authentication must be configured")
    network = read_json("docker", "network", "inspect", args.network)[0]
    addresses = read_json("ip", "-j", "-4", "addr", "show")
    destinations = {a[4][0] for a in socket.getaddrinfo(
        env["SMTP_HOST"], None, socket.AF_INET, socket.SOCK_STREAM)}
    if len(destinations) != 1:
        raise ValueError("Expected one local SMTP IPv4 destination")
    rule = firewall_rule(network, addresses, destinations.pop(), int(env["SMTP_PORT"]))
    print(shlex.join(rule), flush=True)
    if args.apply:
        if os.geteuid() != 0:
            raise ValueError("Run as root to apply the firewall rule")
        if "Status: active" not in subprocess.check_output(
                ["ufw", "status"], text=True, env={**os.environ, "LC_ALL": "C"}):
            raise ValueError("UFW must already be active; this script never enables it")
        subprocess.run(rule, check=True)


if __name__ == "__main__":
    main()
