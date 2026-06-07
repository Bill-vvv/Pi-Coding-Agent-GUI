#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const VERSION = 2;
const DEFAULT_OUT = ".context-index-demo/index.json";
const DEFAULT_TASKS = "tools/context-index-demo-tasks.json";
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".py",
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"];
const IGNORE_DIRS = new Set([
  ".git",
  ".context-index-demo",
  ".pi",
  ".pi-gui",
  ".trellis/workspace",
  ".trellis/tasks",
  ".trellis/worktrees",
  "node_modules",
  "dist",
  ".vite",
  ".venv",
  "__pycache__",
]);
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "when",
  "not",
  "are",
  "should",
  "fix",
  "bug",
  "issue",
  "problem",
  "add",
  "update",
  "change",
  "new",
  "old",
  "can",
  "cannot",
  "cant",
  "able",
  "unable",
  "wrong",
  "broken",
  "show",
  "shows",
]);
const QUERY_SYNONYMS = {
  websocket: ["ws", "socket", "reconnect", "event", "replay"],
  ws: ["websocket", "socket"],
  reconnect: ["since", "replay", "event", "socket"],
  runtime: ["supervisor", "launcher", "process", "rpc", "status"],
  rpc: ["pi", "runtime", "jsonl", "client"],
  command: ["commands", "dispatcher", "slash", "menu", "hotkey"],
  palette: ["menu", "command"],
  slash: ["command", "composer", "menu"],
  composer: ["prompt", "command", "reference", "input"],
  prompt: ["composer", "runtime", "message"],
  voice: ["transcription", "capswriter", "microphone", "dictation"],
  token: ["usage", "tokens", "context", "cost"],
  usage: ["token", "aggregation", "totals"],
  subagent: ["subagents", "child", "run", "progress", "trellis"],
  session: ["conversation", "history", "restore", "fork"],
  settings: ["config", "preferences", "panel"],
  keybinding: ["hotkey", "shortcut", "keyboard"],
  hotkey: ["keybinding", "shortcut", "keyboard"],
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function relativePath(root, absolutePath) {
  return normalizePath(path.relative(root, absolutePath));
}

function shouldIgnorePath(relative) {
  const parts = relative.split(/[\\/]/);
  return parts.some((part, index) => {
    const prefix = parts.slice(0, index + 1).join("/");
    return IGNORE_DIRS.has(part) || IGNORE_DIRS.has(prefix) || (parts[index - 1] === ".trellis" && part.startsWith(".backup"));
  });
}

function collectFiles(root) {
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = relativePath(root, absolute);
      if (shouldIgnorePath(relative)) continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      const stats = statSync(absolute);
      if (stats.size > 300_000) continue;
      files.push({ absolute, relative, size: stats.size });
    }
  }
  visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function tokenize(value) {
  const expandedCamel = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return expandedCamel
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function countTerms(...values) {
  const counts = new Map();
  for (const value of values) {
    for (const token of tokenize(value)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 900));
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx") return "tsx";
  if (ext === ".ts") return "typescript";
  if (ext === ".jsx") return "jsx";
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".py") return "python";
  if (ext === ".md") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  return "text";
}

function detectKind(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  if (/\.(test|spec)\.[tj]sx?$/.test(base) || filePath.includes("/test/") || filePath.includes("/tests/")) return "test";
  if (["package.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "eslint.config.js"].includes(base)) return "config";
  if (filePath.includes("/.trellis/spec/") || ext === ".md" || filePath.includes("/docs/")) return "doc";
  if (CODE_EXTENSIONS.has(ext) || [".css", ".html"].includes(ext)) return "source";
  return "other";
}

function extractSymbols(text, language) {
  const symbols = [];
  const lines = text.split(/\r?\n/);
  const patterns = language === "python"
    ? [
        { kind: "function", regex: /^\s*def\s+([A-Za-z_]\w*)\s*\(/ },
        { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)\s*[(:]/ },
      ]
    : [
        { kind: "function", regex: /^(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
        { kind: "class", regex: /^(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
        { kind: "interface", regex: /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/ },
        { kind: "type", regex: /^(export\s+)?type\s+([A-Za-z_$][\w$]*)\b/ },
        { kind: "enum", regex: /^(export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/ },
        { kind: "const", regex: /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ },
      ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      const name = match[match.length - 1];
      symbols.push({ name, kind: pattern.kind, line: index + 1, exported: /\bexport\b/.test(line) });
      break;
    }
    const exportList = line.match(/^\s*export\s*\{([^}]+)\}/);
    if (exportList) {
      for (const part of exportList[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
          symbols.push({ name, kind: "export", line: index + 1, exported: true });
        }
      }
    }
  }
  const seen = new Set();
  return symbols.filter((symbol) => {
    const key = `${symbol.name}:${symbol.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 120);
}

function extractImports(text) {
  const imports = [];
  const regexes = [
    /\bimport\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[^"']+?\s+from\s+)["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      imports.push({ specifier: match[1] });
    }
  }
  return [...new Set(imports.map((entry) => entry.specifier))].map((specifier) => ({ specifier }));
}

function resolveImport(filePath, specifier, knownPaths) {
  if (!specifier.startsWith(".")) return null;
  const dir = path.posix.dirname(filePath);
  const base = path.posix.normalize(path.posix.join(dir, specifier));
  const parsed = path.posix.parse(base);
  const withoutRuntimeExt = parsed.ext ? path.posix.join(parsed.dir, parsed.name) : base;
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => `${withoutRuntimeExt}${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => `${withoutRuntimeExt}/index${ext}`),
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function stableHash(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function buildIndex(root) {
  const collected = collectFiles(root);
  const knownPaths = new Set(collected.map((file) => file.relative));
  const files = collected.map((file) => {
    const text = readFileSync(file.absolute, "utf8");
    const language = detectLanguage(file.relative);
    const kind = detectKind(file.relative);
    const symbols = CODE_EXTENSIONS.has(path.extname(file.relative).toLowerCase()) ? extractSymbols(text, language) : [];
    const imports = CODE_EXTENSIONS.has(path.extname(file.relative).toLowerCase()) ? extractImports(text) : [];
    const pathTokens = tokenize(file.relative);
    const symbolTokens = [...new Set(symbols.flatMap((symbol) => tokenize(symbol.name)))];
    const resolvedImports = imports.map((entry) => resolveImport(file.relative, entry.specifier, knownPaths)).filter(Boolean);
    const termCounts = countTerms(file.relative, path.basename(file.relative), symbols.map((symbol) => symbol.name).join(" "), text.slice(0, 80_000));
    return {
      path: file.relative,
      language,
      kind,
      size: file.size,
      hash: stableHash(text),
      pathTokens,
      symbolTokens,
      symbols,
      imports: imports.slice(0, 80),
      resolvedImports: [...new Set(resolvedImports)],
      termCounts,
    };
  });
  const importedBy = new Map(files.map((file) => [file.path, []]));
  for (const file of files) {
    for (const imported of file.resolvedImports) {
      importedBy.get(imported)?.push(file.path);
    }
  }
  for (const file of files) {
    file.importedBy = (importedBy.get(file.path) ?? []).sort();
  }
  return {
    version: VERSION,
    root,
    createdAt: new Date().toISOString(),
    files,
  };
}

function loadOrBuildIndex(root, out) {
  const absoluteOut = path.resolve(root, out);
  if (existsSync(absoluteOut)) {
    const index = JSON.parse(readFileSync(absoluteOut, "utf8"));
    if (index.version === VERSION) return index;
  }
  const index = buildIndex(root);
  mkdirSync(path.dirname(absoluteOut), { recursive: true });
  writeFileSync(absoluteOut, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

function expandedQueryTokens(query) {
  const tokens = tokenize(query);
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of QUERY_SYNONYMS[token] ?? []) expanded.add(synonym);
  }
  return [...expanded];
}

function fileScore(file, query, tokens, mode = "indexed") {
  const pathLower = file.path.toLowerCase();
  const pathTokens = new Set(file.pathTokens ?? tokenize(file.path));
  const symbolNames = file.symbols.map((symbol) => symbol.name.toLowerCase());
  const queryLower = query.toLowerCase();
  let score = 0;
  let exactPathMatches = 0;
  let exactSymbolMatches = 0;
  const reasons = [];

  if (pathLower.includes(queryLower.replace(/\s+/g, "-")) || pathLower.includes(queryLower.replace(/\s+/g, ""))) {
    score += 18;
    reasons.push("path matches query phrase");
  }

  for (const token of tokens) {
    const termFrequency = file.termCounts[token] ?? 0;
    if (termFrequency === 0) continue;
    const exactPath = pathTokens.has(token);
    const inPath = pathLower.includes(token);
    const inSymbol = symbolNames.some((name) => name.includes(token));
    if (exactPath) exactPathMatches += 1;
    if (inSymbol) exactSymbolMatches += 1;
    if (mode === "naive") {
      score += Math.min(8, Math.log2(termFrequency + 1));
      if (inPath) score += 2;
      continue;
    }
    const weight = (exactPath ? 13 : inPath ? 6 : 0) + (inSymbol ? 12 : 0) + Math.min(5, Math.log2(termFrequency + 1));
    score += weight;
    if (exactPath) reasons.push(`path segment '${token}'`);
    else if (inPath) reasons.push(`path token '${token}'`);
    if (inSymbol) reasons.push(`symbol token '${token}'`);
  }

  if (mode === "indexed") {
    if (exactPathMatches >= 2) score += exactPathMatches * exactPathMatches * 4;
    if (exactSymbolMatches >= 2) score += exactSymbolMatches * 3;
    if (file.kind === "config") score += tokens.some((token) => ["build", "test", "config", "typescript", "vite", "package"].includes(token)) ? 6 : -4;
    if (file.kind === "test") score += tokens.some((token) => ["test", "spec", "verify"].includes(token)) ? 8 : -3;
    if (file.kind === "doc") score += tokens.some((token) => ["architecture", "spec", "guide", "docs", "readme"].includes(token)) ? 6 : -12;
    if (file.importedBy.length > 0 && score > 0) score += Math.min(4, Math.log2(file.importedBy.length + 1));
  }

  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
}

function graphBoost(index, ranked) {
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  const baseScore = new Map(ranked.map((entry) => [entry.file.path, entry.score]));
  for (const entry of ranked.slice(0, 12)) {
    const neighbors = [...entry.file.resolvedImports, ...entry.file.importedBy];
    for (const neighborPath of neighbors) {
      const neighbor = byPath.get(neighborPath);
      if (!neighbor) continue;
      const existing = baseScore.get(neighborPath) ?? 0;
      baseScore.set(neighborPath, existing + Math.min(5, entry.score * 0.08));
    }
  }
  return index.files
    .map((file) => ({ file, score: baseScore.get(file.path) ?? 0, reasons: ranked.find((entry) => entry.file.path === file.path)?.reasons ?? [] }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
}

function relatedTests(index, candidates, queryTokens) {
  const testFiles = index.files.filter((file) => file.kind === "test");
  const tests = new Map();
  for (const candidate of candidates) {
    const sourceBase = path.basename(candidate.file.path).replace(/\.(test|spec)?\.[tj]sx?$/, "").replace(/\.[^.]+$/, "").toLowerCase();
    const sourceDir = path.posix.dirname(candidate.file.path).toLowerCase();
    for (const test of testFiles) {
      const testPath = test.path.toLowerCase();
      const testBase = path.basename(test.path).toLowerCase();
      let score = 0;
      if (testBase.includes(sourceBase)) score += 12;
      if (testPath.includes(sourceDir)) score += 4;
      for (const token of queryTokens) if (test.termCounts[token]) score += 1;
      if (score > 0) tests.set(test.path, Math.max(tests.get(test.path)?.score ?? 0, score));
    }
  }
  for (const test of testFiles) {
    const direct = fileScore(test, queryTokens.join(" "), queryTokens, "indexed").score;
    if (direct > 8) tests.set(test.path, Math.max(tests.get(test.path)?.score ?? 0, direct));
  }
  return [...tests.entries()]
    .map(([testPath, score]) => ({ path: testPath, score }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 6);
}

function configHints(index, candidates, queryTokens) {
  const scopes = new Set(candidates.flatMap(({ file }) => {
    if (file.path.startsWith("apps/web/")) return ["apps/web", "."];
    if (file.path.startsWith("apps/server/")) return ["apps/server", "."];
    if (file.path.startsWith("packages/shared/")) return ["packages/shared", "."];
    return ["."];
  }));
  return index.files
    .filter((file) => file.kind === "config")
    .filter((file) => scopes.has(path.posix.dirname(file.path)) || file.path === "package.json" || queryTokens.some((token) => file.termCounts[token]))
    .map((file) => file.path)
    .slice(0, 6);
}

function conceptNeighborScore(file, queryTokens) {
  if (!["source", "config"].includes(file.kind)) return 0;
  const filePath = file.path.toLowerCase();
  const pathTokens = new Set(file.pathTokens ?? tokenize(file.path));
  let score = 0;
  const symbolTokens = new Set(file.symbolTokens ?? file.symbols.flatMap((symbol) => tokenize(symbol.name)));
  for (const token of queryTokens) {
    if (pathTokens.has(token)) score += 10;
    else if (filePath.includes(token)) score += 4;
    if (symbolTokens.has(token)) score += 6;
  }
  const tokenSet = new Set(queryTokens);
  const roleBoosts = [
    { segment: "/hooks/", tokens: ["voice", "hotkey", "keybinding", "command", "reconnect", "runtime", "usage"], boost: 10 },
    { segment: "/routes/", tokens: ["voice", "usage", "save", "url", "settings", "api", "http", "token"], boost: 12 },
    { segment: "/state/", tokens: ["event", "replay", "reconnect", "runtime", "render"], boost: 12 },
    { segment: "/db/", tokens: ["event", "session", "settings", "usage", "runtime"], boost: 8 },
    { segment: "/components/", tokens: ["render", "drawer", "panel", "menu", "settings", "overview", "chat"], boost: 8 },
  ];
  for (const rule of roleBoosts) {
    if (filePath.includes(rule.segment) && rule.tokens.some((token) => tokenSet.has(token))) score += rule.boost;
  }
  if (filePath.endsWith("/index.ts") || filePath.endsWith("/index.tsx")) score -= 6;
  return score;
}

function conceptNeighbors(index, candidates, queryTokens, excludedPaths) {
  return index.files
    .filter((file) => !excludedPaths.has(file.path))
    .map((file) => ({ path: file.path, score: conceptNeighborScore(file, queryTokens) }))
    .filter((entry) => entry.score >= 18)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.path)
    .slice(0, 8);
}

function searchContext(index, query, options = {}) {
  const maxFiles = Number(options.maxFiles ?? 8);
  const tokens = expandedQueryTokens(query);
  const initial = index.files
    .map((file) => ({ file, ...fileScore(file, query, tokens, "indexed") }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  const ranked = graphBoost(index, initial);
  const candidates = ranked
    .filter((entry) => entry.file.kind !== "test")
    .slice(0, maxFiles)
    .map((entry) => ({
      path: entry.file.path,
      kind: entry.file.kind,
      score: Number(entry.score.toFixed(2)),
      confidence: confidenceLabel(entry.score, ranked[0]?.score ?? 0),
      reason: reasonText(entry, tokens),
      symbols: entry.file.symbols.slice(0, 8),
      imports: entry.file.resolvedImports.slice(0, 8),
      importedBy: entry.file.importedBy.slice(0, 8),
    }));
  const candidateEntries = candidates.map((candidate) => ranked.find((entry) => entry.file.path === candidate.path)).filter(Boolean);
  const tests = relatedTests(index, candidateEntries, tokens);
  const topScore = ranked[0]?.score ?? 0;
  const confidence = topScore >= 45 ? "high" : topScore >= 22 ? "medium" : topScore >= 10 ? "low" : "very_low";
  const excludedPaths = new Set(candidates.map((candidate) => candidate.path));
  const directGraphNeighbors = candidateEntries.slice(0, 3).flatMap((entry) => [...entry.file.resolvedImports, ...entry.file.importedBy]);
  const graphNeighbors = [...new Set([...directGraphNeighbors, ...conceptNeighbors(index, candidates, tokens, excludedPaths)])]
    .filter((filePath) => !excludedPaths.has(filePath))
    .slice(0, 10);
  return {
    query,
    confidence,
    summary: buildSummary(query, candidates, tests, confidence),
    candidates,
    related_tests: tests,
    config_hints: configHints(index, candidateEntries, tokens),
    graph_neighbors: graphNeighbors,
    suggested_reading_order: [...candidates.slice(0, 5).map((candidate) => candidate.path), ...graphNeighbors.slice(0, 4), ...tests.slice(0, 3).map((test) => test.path)],
    bounded_verification: boundedVerification(query, candidates, graphNeighbors, tests),
    fallback_triggers: [
      "候选文件读完后没有找到任务描述中的核心行为",
      "top candidates 之间没有清晰依赖关系，或 confidence 为 low/very_low",
      "相关测试为空或测试失败无法由候选文件解释",
      "修改会跨 Project/Runtime/Session、WebSocket、RPC 或 shared protocol 边界",
    ],
    known_gaps: knownGaps(confidence, tests),
  };
}

function confidenceLabel(score, topScore) {
  if (score >= topScore * 0.75 && score >= 25) return "high";
  if (score >= topScore * 0.45 && score >= 12) return "medium";
  return "low";
}

function reasonText(entry, tokens) {
  if (entry.reasons.length > 0) return entry.reasons.join("; ");
  const matched = tokens.filter((token) => entry.file.termCounts[token]).slice(0, 4);
  if (matched.length > 0) return `content terms: ${matched.join(", ")}`;
  return "graph neighbor of a higher-ranked candidate";
}

function buildSummary(query, candidates, tests, confidence) {
  if (candidates.length === 0) return "未找到稳定候选入口；建议先使用常规搜索缩小任务词。";
  const top = candidates.slice(0, 3).map((candidate) => candidate.path).join(", ");
  return `针对「${query}」，先读 ${top}${tests.length ? "，再看相关测试" : ""}。当前 index 置信度：${confidence}。`;
}

function pickVerificationSymbols(query, candidates) {
  const tokens = new Set(expandedQueryTokens(query));
  return candidates
    .flatMap((candidate) => candidate.symbols.map((symbol) => ({ symbol, candidate })))
    .map(({ symbol, candidate }) => {
      const nameTokens = tokenize(symbol.name);
      const overlap = nameTokens.filter((token) => tokens.has(token)).length;
      const exportedBoost = symbol.exported ? 2 : 0;
      const kindBoost = ["function", "class", "interface", "type"].includes(symbol.kind) ? 2 : 0;
      const nameShapeBoost = /^(use|handle|create|register|Ws|Runtime|Voice|Token|Subagent)/.test(symbol.name) ? 2 : 0;
      const lowerCaseLocalPenalty = /^[a-z]/.test(symbol.name) && !symbol.exported && overlap === 0 ? -6 : 0;
      return { name: symbol.name, path: candidate.path, score: overlap * 10 + exportedBoost + kindBoost + nameShapeBoost + lowerCaseLocalPenalty };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .slice(0, 5);
}

function boundedVerification(query, candidates, graphNeighbors, tests) {
  const topSymbols = pickVerificationSymbols(query, candidates);
  const topDirs = [...new Set(candidates.slice(0, 3).map((candidate) => path.posix.dirname(candidate.path)))];
  return [
    `阅读 top ${Math.min(3, candidates.length)} 候选源码，确认真实行为后再修改`,
    topSymbols.length ? `只搜索核心 symbol 引用：${topSymbols.join(" | ")}` : `只搜索 query 核心词：${tokenize(query).slice(0, 5).join(" | ")}`,
    graphNeighbors.length ? `检查一跳依赖/被依赖文件中的入口和副作用` : `若候选文件没有依赖线索，再扩大到相关目录`,
    topDirs.length ? `将普通搜索范围先限制在：${topDirs.join(", ")}` : `普通搜索先限制在 src/test 目录`,
    tests.length ? `优先运行或阅读相关测试：${tests.slice(0, 3).map((test) => test.path).join(", ")}` : `如无相关测试，搜索同目录或同 basename 的 test/spec`,
  ];
}

function knownGaps(confidence, tests) {
  const gaps = [];
  if (["low", "very_low"].includes(confidence)) gaps.push("置信度偏低：index 只能作为入口，必须触发更宽的验证搜索。");
  if (tests.length === 0) gaps.push("未找到明确测试映射。可能需要额外搜索 test/spec。 ");
  gaps.push("本 demo 使用文本、symbol、import graph，不使用 embedding；命名差或动态注册场景召回会下降。");
  return gaps;
}

function renderMarkdown(result) {
  const lines = [];
  lines.push(`# search_context demo`);
  lines.push(``);
  lines.push(`Query: ${result.query}`);
  lines.push(`Confidence: ${result.confidence}`);
  if (result.metrics) lines.push(`Metrics: ${result.metrics.searchMs} ms, ~${result.metrics.payloadTokens} payload tokens`);
  lines.push(``);
  lines.push(result.summary);
  lines.push(``);
  lines.push(`## Core candidates`);
  for (const candidate of result.candidates) {
    lines.push(`- ${candidate.path} (${candidate.confidence}, score ${candidate.score})`);
    lines.push(`  - reason: ${candidate.reason}`);
    if (candidate.symbols.length) lines.push(`  - symbols: ${candidate.symbols.map((symbol) => `${symbol.name}:${symbol.line}`).join(", ")}`);
  }
  lines.push(``);
  lines.push(`## Related tests`);
  if (result.related_tests.length === 0) lines.push(`- none found by index`);
  for (const test of result.related_tests) lines.push(`- ${test.path} (score ${Number(test.score).toFixed(2)})`);
  lines.push(``);
  lines.push(`## Config hints`);
  if (result.config_hints.length === 0) lines.push(`- none`);
  for (const config of result.config_hints) lines.push(`- ${config}`);
  lines.push(``);
  lines.push(`## Bounded verification`);
  for (const step of result.bounded_verification) lines.push(`- ${step}`);
  lines.push(``);
  lines.push(`## Fallback triggers`);
  for (const trigger of result.fallback_triggers) lines.push(`- ${trigger}`);
  lines.push(``);
  lines.push(`## Known gaps`);
  for (const gap of result.known_gaps) lines.push(`- ${gap}`);
  return `${lines.join("\n")}\n`;
}

function naiveRank(index, query) {
  const tokens = tokenize(query);
  return index.files
    .map((file) => ({ path: file.path, kind: file.kind, score: fileScore(file, query, tokens, "naive").score }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function rankOf(paths, target) {
  const index = paths.findIndex((entry) => entry === target);
  return index === -1 ? null : index + 1;
}

function estimatedTokensFromChars(chars) {
  return Math.ceil(chars / 4);
}

function sourceTokensForPaths(index, paths, limit = 10) {
  const fileByPath = new Map(index.files.map((file) => [file.path, file]));
  return paths.slice(0, limit).reduce((sum, filePath) => sum + estimatedTokensFromChars(fileByPath.get(filePath)?.size ?? 0), 0);
}

function timedAverage(runs, fn) {
  const safeRuns = Math.max(1, Number(runs) || 1);
  let value;
  const start = performance.now();
  for (let index = 0; index < safeRuns; index += 1) value = fn();
  return { value, ms: (performance.now() - start) / safeRuns };
}

function meanFinite(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function compare(index, tasks, options = {}) {
  const rows = [];
  const runs = Number(options.runs ?? 1);
  for (const task of tasks) {
    const indexedTiming = timedAverage(runs, () => searchContext(index, task.query, { maxFiles: 10 }));
    const result = indexedTiming.value;
    const indexedPaths = [...new Set([...result.candidates.map((candidate) => candidate.path), ...result.graph_neighbors, ...result.related_tests.map((test) => test.path)])];
    const naiveTiming = timedAverage(runs, () => naiveRank(index, task.query));
    const naiveRows = naiveTiming.value;
    const naivePaths = naiveRows.map((entry) => entry.path);
    const expected = task.expected ?? [];
    const indexedRanks = expected.map((target) => rankOf(indexedPaths, target));
    const naiveRanks = expected.map((target) => rankOf(naivePaths, target));
    const indexedPayload = JSON.stringify(result);
    const naivePayload = JSON.stringify({ query: task.query, results: naiveRows.slice(0, 10) });
    rows.push({
      id: task.id,
      query: task.query,
      expected,
      indexedHitTop10: indexedRanks.filter((rank) => rank !== null && rank <= 10).length,
      naiveHitTop10: naiveRanks.filter((rank) => rank !== null && rank <= 10).length,
      indexedMeanRank: meanFinite(indexedRanks),
      naiveMeanRank: meanFinite(naiveRanks),
      indexedFirstMiss: expected.find((_, index) => indexedRanks[index] === null) ?? null,
      naiveFirstMiss: expected.find((_, index) => naiveRanks[index] === null) ?? null,
      indexedRanks,
      naiveRanks,
      indexTop5: indexedPaths.slice(0, 5),
      naiveTop5: naivePaths.slice(0, 5),
      confidence: result.confidence,
      metrics: {
        indexedSearchMs: Number(indexedTiming.ms.toFixed(2)),
        keywordSearchMs: Number(naiveTiming.ms.toFixed(2)),
        indexedPayloadTokens: estimatedTokensFromChars(indexedPayload.length),
        keywordPayloadTokens: estimatedTokensFromChars(naivePayload.length),
        indexedTop10SourceTokens: sourceTokensForPaths(index, indexedPaths, 10),
        keywordTop10SourceTokens: sourceTokensForPaths(index, naivePaths, 10),
        indexedEstimatedTotalTokens: estimatedTokensFromChars(indexedPayload.length) + sourceTokensForPaths(index, indexedPaths, 10),
        keywordEstimatedTotalTokens: estimatedTokensFromChars(naivePayload.length) + sourceTokensForPaths(index, naivePaths, 10),
      },
    });
  }
  return rows;
}

function renderCompare(rows) {
  const totalExpected = rows.reduce((sum, row) => sum + row.expected.length, 0);
  const indexedHits = rows.reduce((sum, row) => sum + row.indexedHitTop10, 0);
  const naiveHits = rows.reduce((sum, row) => sum + row.naiveHitTop10, 0);
  const total = (selector) => rows.reduce((sum, row) => sum + selector(row), 0);
  const avg = (selector) => rows.length === 0 ? 0 : total(selector) / rows.length;
  const lines = [];
  lines.push(`# context-index-demo comparison`);
  lines.push(``);
  lines.push(`This is a deterministic local proxy, not an LLM benchmark. It checks whether indexed context puts seeded relevant files into the first 10 suggested reads versus a keyword-only baseline.`);
  lines.push(`Token counts are rough local estimates: chars / 4 for tool payloads and source file sizes. They are for comparison only, not provider billing numbers.`);
  lines.push(``);
  lines.push(`- indexed top10 hits: ${indexedHits}/${totalExpected}`);
  lines.push(`- keyword-only top10 hits: ${naiveHits}/${totalExpected}`);
  lines.push(`- avg indexed search latency: ${avg((row) => row.metrics.indexedSearchMs).toFixed(2)} ms`);
  lines.push(`- avg keyword-only search latency: ${avg((row) => row.metrics.keywordSearchMs).toFixed(2)} ms`);
  lines.push(`- total indexed payload tokens: ${total((row) => row.metrics.indexedPayloadTokens)}`);
  lines.push(`- total keyword-only payload tokens: ${total((row) => row.metrics.keywordPayloadTokens)}`);
  lines.push(`- total indexed top10 source-read tokens: ${total((row) => row.metrics.indexedTop10SourceTokens)}`);
  lines.push(`- total keyword-only top10 source-read tokens: ${total((row) => row.metrics.keywordTop10SourceTokens)}`);
  lines.push(`- total indexed estimated payload+read tokens: ${total((row) => row.metrics.indexedEstimatedTotalTokens)}`);
  lines.push(`- total keyword-only estimated payload+read tokens: ${total((row) => row.metrics.keywordEstimatedTotalTokens)}`);
  lines.push(``);
  for (const row of rows) {
    lines.push(`## ${row.id}: ${row.query}`);
    lines.push(`- confidence: ${row.confidence}`);
    lines.push(`- indexed top10 hits: ${row.indexedHitTop10}/${row.expected.length}${row.indexedMeanRank === null ? "" : `, mean rank ${row.indexedMeanRank.toFixed(1)}`}`);
    lines.push(`- keyword-only top10 hits: ${row.naiveHitTop10}/${row.expected.length}${row.naiveMeanRank === null ? "" : `, mean rank ${row.naiveMeanRank.toFixed(1)}`}`);
    lines.push(`- latency: indexed ${row.metrics.indexedSearchMs} ms, keyword-only ${row.metrics.keywordSearchMs} ms`);
    lines.push(`- payload tokens: indexed ${row.metrics.indexedPayloadTokens}, keyword-only ${row.metrics.keywordPayloadTokens}`);
    lines.push(`- top10 source-read tokens: indexed ${row.metrics.indexedTop10SourceTokens}, keyword-only ${row.metrics.keywordTop10SourceTokens}`);
    lines.push(`- estimated payload+read tokens: indexed ${row.metrics.indexedEstimatedTotalTokens}, keyword-only ${row.metrics.keywordEstimatedTotalTokens}`);
    lines.push(`- indexed top5:`);
    for (const item of row.indexTop5) lines.push(`  - ${item}`);
    lines.push(`- keyword-only top5:`);
    for (const item of row.naiveTop5) lines.push(`  - ${item}`);
    if (row.indexedFirstMiss) lines.push(`- indexed first miss: ${row.indexedFirstMiss}`);
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage:
  node tools/context-index-demo.mjs build [--root .] [--out ${DEFAULT_OUT}]
  node tools/context-index-demo.mjs search "task text" [--root .] [--out ${DEFAULT_OUT}] [--max-files 8] [--runs 1] [--json]
  node tools/context-index-demo.mjs compare [--root .] [--out ${DEFAULT_OUT}] [--tasks ${DEFAULT_TASKS}] [--runs 1] [--json]

Notes:
  - This is a shadow/demo index. It does not replace normal search.
  - search output intentionally includes bounded verification and fallback triggers.
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const root = path.resolve(String(args.root ?? process.cwd()));
  const out = String(args.out ?? DEFAULT_OUT);

  if (!command || command === "help" || command === "--help") {
    process.stdout.write(usage());
    return;
  }

  if (command === "build") {
    const start = performance.now();
    const index = buildIndex(root);
    const absoluteOut = path.resolve(root, out);
    mkdirSync(path.dirname(absoluteOut), { recursive: true });
    writeFileSync(absoluteOut, `${JSON.stringify(index, null, 2)}\n`);
    process.stdout.write(`Built context index: ${path.relative(root, absoluteOut)} (${index.files.length} files, ${(performance.now() - start).toFixed(2)} ms)\n`);
    return;
  }

  if (command === "search") {
    const query = args._.slice(1).join(" ");
    if (!query) throw new Error("search requires a query");
    const index = loadOrBuildIndex(root, out);
    const timing = timedAverage(Number(args.runs ?? 1), () => searchContext(index, query, { maxFiles: args["max-files"] }));
    const result = { ...timing.value, metrics: { searchMs: Number(timing.ms.toFixed(2)), payloadTokens: estimatedTokensFromChars(JSON.stringify(timing.value).length) } };
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
    return;
  }

  if (command === "compare" || command === "demo") {
    const index = loadOrBuildIndex(root, out);
    const tasksPath = path.resolve(root, String(args.tasks ?? DEFAULT_TASKS));
    const tasks = JSON.parse(readFileSync(tasksPath, "utf8"));
    const rows = compare(index, tasks, { runs: args.runs });
    process.stdout.write(args.json ? `${JSON.stringify(rows, null, 2)}\n` : renderCompare(rows));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(usage());
  process.exit(1);
}
