export type SshProjectTarget = {
  sshHost: string;
  remoteCwd: string;
  port?: string;
  canonicalCwd: string;
};

export function parseSshProjectCwd(input: string): SshProjectTarget | undefined {
  const value = input.trim();
  if (!value) return undefined;

  if (value.startsWith("ssh://")) {
    try {
      const url = new URL(value);
      const user = url.username ? `${decodeURIComponent(url.username)}@` : "";
      const host = url.hostname;
      if (!host) return undefined;
      const remoteCwd = decodeURIComponent(url.pathname || "/") || "/";
      return {
        sshHost: `${user}${host}`,
        port: url.port || undefined,
        remoteCwd,
        canonicalCwd: `ssh://${user}${host}${url.port ? `:${url.port}` : ""}${remoteCwd}`,
      };
    } catch {
      return undefined;
    }
  }

  // SCP-style target used by ssh and pi-ssh: user@host:/absolute/path or host:~/path.
  // Do not treat Windows drive paths like C:\foo or C:/foo as SSH targets.
  if (/^[A-Za-z]:[\\/]/.test(value)) return undefined;
  const match = /^([^\s:]+):(\/.*|~(?:\/.*)?|\.\.?\/.*)$/.exec(value);
  if (!match) return undefined;
  return {
    sshHost: match[1]!,
    remoteCwd: match[2]!,
    canonicalCwd: `${match[1]}:${match[2]}`,
  };
}

export function remoteCdCommand(remoteCwd: string): string {
  if (remoteCwd === "~") return "cd";
  if (remoteCwd.startsWith("~/")) return `cd -- "$HOME"/${shellQuote(remoteCwd.slice(2))}`;
  return `cd -- ${shellQuote(remoteCwd)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
