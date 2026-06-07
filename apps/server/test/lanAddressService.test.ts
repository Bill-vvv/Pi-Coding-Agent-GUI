import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";
import { listLanCandidateUrls } from "../src/services/lanAddressService.js";

test("lan address service lists private IPv4 candidates and recommends selected host", () => {
  const candidates = listLanCandidateUrls({
    port: 8787,
    selectedHost: "192.168.1.50",
    source: () => ({
      lo: [address("127.0.0.1", true)],
      docker0: [address("172.17.0.1")],
      wlan0: [address("192.168.1.50")],
      eth0: [address("10.0.0.8")],
      public0: [address("8.8.8.8")],
      inet6: [{ ...address("fe80::1"), family: "IPv6" } as NetworkInterfaceInfo],
    }),
    env: {},
    osRelease: () => "linux",
  });

  assert.deepEqual(candidates.map((candidate) => candidate.host), ["192.168.1.50", "10.0.0.8", "172.17.0.1"]);
  assert.equal(candidates[0].recommended, true);
  assert.equal(candidates[0].url, "http://192.168.1.50:8787/");
});

test("lan address service recommends likely wifi/ethernet before bridge interfaces", () => {
  const candidates = listLanCandidateUrls({
    port: 9000,
    source: () => ({
      "br-test": [address("172.18.0.1")],
      eth0: [address("10.0.0.2")],
      wlan0: [address("192.168.0.9")],
    }),
    env: {},
    osRelease: () => "linux",
  });

  assert.equal(candidates[0].host, "192.168.0.9");
  assert.equal(candidates[0].recommended, true);
  assert.equal(candidates[1].host, "10.0.0.2");
});

test("lan address service prefers Windows host LAN addresses when running under WSL", () => {
  const candidates = listLanCandidateUrls({
    port: 8787,
    source: () => ({
      eth0: [address("172.28.70.12")],
      docker0: [address("172.17.0.1")],
    }),
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    osRelease: () => "5.15.0-microsoft-standard-WSL2",
    windowsSource: () => JSON.stringify([
      { IPAddress: "192.168.1.44", InterfaceAlias: "Wi-Fi" },
      { IPAddress: "10.1.2.3", InterfaceAlias: "Ethernet" },
    ]),
  });

  assert.equal(candidates[0].host, "192.168.1.44");
  assert.equal(candidates[0].source, "windows-host");
  assert.equal(candidates[0].requiresPortProxy, true);
  assert.equal(candidates[0].recommended, true);
  assert.equal(candidates.some((candidate) => candidate.host === "172.28.70.12" && candidate.source === "server-interface"), true);
});

test("lan address service keeps Windows host recommended in WSL even if a WSL NAT host was selected", () => {
  const candidates = listLanCandidateUrls({
    port: 8787,
    selectedHost: "172.28.70.12",
    source: () => ({
      eth0: [address("172.28.70.12")],
    }),
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    osRelease: () => "5.15.0-microsoft-standard-WSL2",
    windowsSource: () => JSON.stringify([{ IPAddress: "192.168.1.44", InterfaceAlias: "Wi-Fi" }]),
  });

  assert.equal(candidates.find((candidate) => candidate.host === "192.168.1.44")?.recommended, true);
  assert.equal(candidates.find((candidate) => candidate.host === "172.28.70.12")?.recommended, false);
});

function address(addressValue: string, internal = false): NetworkInterfaceInfo {
  return {
    address: addressValue,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${addressValue}/24`,
  };
}
