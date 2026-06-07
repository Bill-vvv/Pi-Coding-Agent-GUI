import { execFileSync } from "node:child_process";
import { networkInterfaces, release, type NetworkInterfaceInfo } from "node:os";
import type { RemoteAccessCandidateUrl } from "@pi-gui/shared";
import { resolveWindowsPowerShellExecutable } from "./windowsPowerShellService.js";

export type LanAddressSource = () => NodeJS.Dict<NetworkInterfaceInfo[]>;
export type WindowsLanAddressSource = () => string | undefined;

export type ListLanUrlOptions = {
  port: number;
  selectedHost?: string;
  source?: LanAddressSource;
  env?: NodeJS.ProcessEnv;
  osRelease?: () => string;
  windowsSource?: WindowsLanAddressSource;
};

type LanInterfaceSource = "server-interface" | "windows-host";

type LanInterface = {
  interfaceName: string;
  address: string;
  source: LanInterfaceSource;
  requiresPortProxy?: boolean;
};

type WindowsLanAddressCache = {
  expiresAt: number;
  value: string | undefined;
};

const WINDOWS_LAN_ADDRESS_CACHE_TTL_MS = 30_000;
const WINDOWS_LAN_ADDRESS_FAILURE_CACHE_TTL_MS = 10_000;
const WINDOWS_LAN_ADDRESS_TIMEOUT_MS = 3_000;
let windowsLanAddressCache: WindowsLanAddressCache | undefined;

export function listLanCandidateUrls({
  port,
  selectedHost,
  source = networkInterfaces,
  env = process.env,
  osRelease = release,
  windowsSource = windowsLanAddressJson,
}: ListLanUrlOptions): RemoteAccessCandidateUrl[] {
  const serverInterfaces = privateIpv4Interfaces(source()).map((candidate) => ({ ...candidate, source: "server-interface" as const }));
  const isWsl = isWslEnvironment(env, osRelease);
  const windowsInterfaces = isWsl
    ? windowsPrivateIpv4Interfaces(windowsSource()).map((candidate) => ({ ...candidate, source: "windows-host" as const, requiresPortProxy: true }))
    : [];
  const candidates = dedupeLanInterfaces([...windowsInterfaces, ...serverInterfaces]).sort(compareLanInterfaces);
  const recommendedHost = chooseRecommendedHost(candidates, selectedHost, isWsl);
  return candidates.map((candidate) => ({
    host: candidate.address,
    url: `http://${candidate.address}:${port}/`,
    interfaceName: candidate.interfaceName,
    recommended: candidate.address === recommendedHost,
    source: candidate.source,
    requiresPortProxy: candidate.requiresPortProxy,
  }));
}

export function isWslEnvironment(env: NodeJS.ProcessEnv = process.env, osRelease: () => string = release): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || /microsoft|wsl/i.test(osRelease()));
}

function privateIpv4Interfaces(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): Array<Omit<LanInterface, "source">> {
  const results: Array<Omit<LanInterface, "source">> = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) continue;
      results.push({ interfaceName, address: entry.address });
    }
  }
  return results;
}

function windowsPrivateIpv4Interfaces(rawJson: string | undefined): Array<Omit<LanInterface, "source">> {
  if (!rawJson?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(rawJson);
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const results: Array<Omit<LanInterface, "source">> = [];
    for (const row of rows) {
      const address = stringField(row, "IPAddress")?.trim();
      if (!address || !isPrivateIpv4(address)) continue;
      const interfaceName = stringField(row, "InterfaceAlias")?.trim() || "Windows host";
      results.push({ interfaceName, address });
    }
    return results;
  } catch {
    return [];
  }
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object" || !(field in value)) return undefined;
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function chooseRecommendedHost(candidates: LanInterface[], selectedHost: string | undefined, isWsl: boolean): string | undefined {
  const selected = selectedHost?.trim();
  const selectedCandidate = selected ? candidates.find((candidate) => candidate.address === selected) : undefined;
  if (isWsl) {
    if (selectedCandidate?.source === "windows-host") return selectedCandidate.address;
    return candidates.find((candidate) => candidate.source === "windows-host")?.address ?? selectedCandidate?.address ?? candidates[0]?.address;
  }
  if (selectedCandidate) return selectedCandidate.address;
  return candidates[0]?.address;
}

function dedupeLanInterfaces(candidates: LanInterface[]): LanInterface[] {
  const byAddress = new Map<string, LanInterface>();
  for (const candidate of candidates) {
    const existing = byAddress.get(candidate.address);
    if (!existing || interfaceSourcePriority(candidate.source) < interfaceSourcePriority(existing.source)) byAddress.set(candidate.address, candidate);
  }
  return [...byAddress.values()];
}

function compareLanInterfaces(left: LanInterface, right: LanInterface): number {
  const leftSourceScore = interfaceSourcePriority(left.source);
  const rightSourceScore = interfaceSourcePriority(right.source);
  if (leftSourceScore !== rightSourceScore) return leftSourceScore - rightSourceScore;
  const leftScore = interfacePriority(left.interfaceName);
  const rightScore = interfacePriority(right.interfaceName);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return left.address.localeCompare(right.address, undefined, { numeric: true });
}

function interfaceSourcePriority(source: LanInterfaceSource): number {
  return source === "windows-host" ? 0 : 1;
}

function interfacePriority(name: string): number {
  const normalized = name.toLowerCase();
  if (/^(wi-?fi|wlan|wl)/.test(normalized)) return 0;
  if (/^(eth|en|ethernet)/.test(normalized)) return 1;
  if (/^(docker|br-|veth|tun|tap|tailscale|zt|wg)/.test(normalized)) return 3;
  return 2;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function windowsLanAddressJson(): string | undefined {
  const now = Date.now();
  if (windowsLanAddressCache && windowsLanAddressCache.expiresAt > now) return windowsLanAddressCache.value;
  let value: string | undefined;
  try {
    value = execFileSync(
      resolveWindowsPowerShellExecutable(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$items = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|Docker|WSL' }; $items | Select-Object IPAddress,InterfaceAlias | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: WINDOWS_LAN_ADDRESS_TIMEOUT_MS, windowsHide: true },
    );
  } catch {
    value = undefined;
  }
  windowsLanAddressCache = {
    value,
    expiresAt: now + (value ? WINDOWS_LAN_ADDRESS_CACHE_TTL_MS : WINDOWS_LAN_ADDRESS_FAILURE_CACHE_TTL_MS),
  };
  return value;
}
