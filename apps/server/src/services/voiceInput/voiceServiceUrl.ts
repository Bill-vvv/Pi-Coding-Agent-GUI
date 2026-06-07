export function assertLocalVoiceServiceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Voice input service URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Voice input service URL must use http or https");
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!isLocalOrPrivateHost(hostname)) {
    throw new Error("Voice input service URL must point to localhost or a private LAN/WSL address");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isLocalOrPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "host.docker.internal" || hostname.endsWith(".local")) return true;
  if (hostname === "::1") return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80")) return true;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
