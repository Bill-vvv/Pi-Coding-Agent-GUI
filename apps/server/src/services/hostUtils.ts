import { isIP } from "node:net";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}
