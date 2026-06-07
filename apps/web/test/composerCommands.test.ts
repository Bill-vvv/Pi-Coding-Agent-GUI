import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSummary, SlashCommand } from "@pi-gui/shared";
import {
  bangInputRpcCommand,
  buildChatRuntimePromptCommand,
  buildCommandOptions,
  buildComposerCompletions,
  completeCommandPrompt,
  completeModelPrompt,
  isExecutableCommandInput,
  isRuntimeLaunchCommand,
  parseBangInput,
  parseLeadingSlashCommand,
  parseSlashInput,
  replaceLeadingCommandLine,
  routeNativeComposerCommand,
  runningBusyStreamingBehavior,
  slashCommandMessage,
  slashDisplayMessage,
  slashDisplayMessageForCommand,
} from "../src/domain/composerCommands";

test("parseBangInput parses TUI-style shell command prefixes", () => {
  assert.deepEqual(parseBangInput("!pwd"), { command: "pwd", excludeFromContext: false });
  assert.deepEqual(parseBangInput("!! git status"), { command: "git status", excludeFromContext: true });
  assert.deepEqual(bangInputRpcCommand({ command: "pwd", excludeFromContext: false }), { type: "bash", command: "pwd", excludeFromContext: false });
  assert.equal(parseBangInput("hello"), undefined);
});

test("parseSlashInput parses leading slash commands and preserves trimmed args", () => {
  assert.equal(parseSlashInput("hello"), undefined);
  assert.deepEqual(parseSlashInput("/model"), { name: "model", args: "" });
  assert.deepEqual(parseSlashInput("   /compact   keep recent context  "), { name: "compact", args: "keep recent context" });
  assert.deepEqual(parseSlashInput("/scoped-models fast"), { name: "scoped-models", args: "fast" });
});

test("slash display helpers normalize command text consistently", () => {
  assert.equal(slashDisplayMessage("  /name demo  "), "/name demo");
  assert.equal(slashDisplayMessageForCommand("  /compact now  ", "compact"), "/compact now");
  assert.equal(slashDisplayMessageForCommand("  /goal ship it  ", "goal"), undefined);
  assert.equal(slashDisplayMessageForCommand("  /goal:1 ship it  ", "goal:1"), undefined);
  assert.equal(slashCommandMessage("goal", "ship it"), "/goal ship it");
  assert.equal(slashCommandMessage("goal", ""), "/goal");
});

test("routeNativeComposerCommand classifies local UI commands", () => {
  assert.deepEqual(routeNativeComposerCommand("model", ""), { kind: "openModelPicker" });
  assert.deepEqual(routeNativeComposerCommand("settings", ""), { kind: "openSettings" });
  assert.deepEqual(routeNativeComposerCommand("resume", ""), { kind: "openSessionHistory" });
  assert.deepEqual(routeNativeComposerCommand("scoped-models", ""), { kind: "openScopedModels" });
  assert.deepEqual(routeNativeComposerCommand("login", ""), { kind: "openProviderAuth", action: "login" });
});

test("routeNativeComposerCommand reports current GUI hotkeys", () => {
  const route = routeNativeComposerCommand("hotkeys", "");
  assert.equal(route.kind, "error");
  if (route.kind !== "error") throw new Error("expected hotkeys to return help text");
  assert.match(route.message, /Esc .*中止本轮输出/);
  assert.match(route.message, /Ctrl\/Cmd\+Shift\+M 语音输入/);
  assert.match(route.message, /Ctrl\/Cmd\+, 打开设置/);
});

test("routeNativeComposerCommand validates command arguments", () => {
  assert.deepEqual(routeNativeComposerCommand("name", ""), { kind: "error", message: "/name 需要会话名称" });
  assert.deepEqual(routeNativeComposerCommand("fork", ""), { kind: "openSessionTree", mode: "fork" });
  assert.deepEqual(routeNativeComposerCommand("tree", ""), { kind: "openSessionTree", mode: "tree" });
});

test("routeNativeComposerCommand builds native RPC routes", () => {
  assert.deepEqual(routeNativeComposerCommand("name", "demo"), {
    kind: "nativeRpc",
    command: { type: "set_session_name", name: "demo" },
    label: "/name",
    clearPrompt: true,
  });
  assert.deepEqual(routeNativeComposerCommand("compact", "focus tests"), {
    kind: "nativeRpc",
    command: { type: "compact", customInstructions: "focus tests" },
    label: "/compact",
    clearPrompt: true,
  });
  assert.deepEqual(routeNativeComposerCommand("export", "/tmp/session.html"), {
    kind: "nativeRpc",
    command: { type: "export_html", outputPath: "/tmp/session.html" },
    label: "/export",
    clearPrompt: true,
  });
});

test("routeNativeComposerCommand separates browser-side commands from pure routing", () => {
  assert.deepEqual(routeNativeComposerCommand("copy", "", "assistant text"), { kind: "copyLastAssistant" });
  assert.equal(routeNativeComposerCommand("copy", "", "").kind, "error");
  assert.deepEqual(routeNativeComposerCommand("clone", ""), {
    kind: "nativeRpc",
    command: { type: "clone" },
    label: "/clone",
    clearPrompt: true,
    confirmMessage: "复制当前活动分支到新 session？",
  });
});

test("bare goal native routing is safe when no dynamic goal command is available", () => {
  const route = routeNativeComposerCommand("goal", "ship it");
  assert.equal(route.kind, "error");
  if (route.kind !== "error") throw new Error("expected /goal to require dynamic command binding");
  assert.match(route.message, /\/goal/);
});

test("composer command helpers identify runtime launch flow and steering", () => {
  assert.equal(runningBusyStreamingBehavior(true, true), "steer");
  assert.equal(runningBusyStreamingBehavior(true, false), undefined);
  assert.equal(isRuntimeLaunchCommand("runtime.start"), true);
  assert.equal(isRuntimeLaunchCommand("runtime.resume"), true);
  assert.equal(isRuntimeLaunchCommand("project.list"), false);
});

test("chat prompt commands omit display-only slash command messages", () => {
  assert.deepEqual(buildChatRuntimePromptCommand({ requestId: "req-1", runtimeId: "runtime-1", message: "normal chat", streamingBehavior: "followUp" }), {
    type: "runtime.prompt",
    requestId: "req-1",
    runtimeId: "runtime-1",
    message: "normal chat",
    streamingBehavior: "followUp",
  });
  assert.equal("displayMessage" in buildChatRuntimePromptCommand({ runtimeId: "runtime-1", message: "normal chat", streamingBehavior: "steer" }), false);
});

test("composer command completion ranks exact, prefix, then substring matches", () => {
  const commands = buildCommandOptions([]);
  const completion = buildComposerCompletions({ prompt: "/model", commands, models: [], selectedIndex: 0, suppressed: false });
  assert.equal(completion.visible, true);
  assert.equal(completion.items[0]?.kind, "command");
  assert.equal(completion.items[0]?.title, "/model");

  const substringCompletion = buildComposerCompletions({ prompt: "/del", commands, models: [], selectedIndex: 0, suppressed: false });
  assert.deepEqual(substringCompletion.items.map((item) => item.title), ["/model", "/scoped-models"]);
});

test("composer command-name Enter completion waits for an exact command name even with args", () => {
  const modelCommand = buildCommandOptions([]).find((command) => command.name === "model");
  assert.ok(modelCommand);
  assert.equal(isExecutableCommandInput("/mo gpt", modelCommand), false);
  assert.equal(isExecutableCommandInput("/model gpt", modelCommand), true);
});

test("composer command options dedupe native commands before dynamic commands", () => {
  const dynamicCommands: SlashCommand[] = [
    { name: "review", description: "Review changes", source: "extension", path: "extensions/review.ts" },
    { name: "model", description: "Conflicting dynamic model", source: "extension", path: "extensions/model.ts" },
  ];
  const commands = buildCommandOptions(dynamicCommands);
  assert.equal(commands.find((command) => command.name === "model")?.source, "gui");
  assert.equal(commands.find((command) => command.name === "review")?.source, "extension");
});

test("composer command options bind bare goal to the preferred dynamic goal command", () => {
  const dynamicCommands: SlashCommand[] = [
    { name: "goal:1", description: "Project goal", source: "extension", path: "project/goal.ts" },
    { name: "goal:2", description: "User goal", source: "extension", path: "user/goal.ts" },
  ];
  const commands = buildCommandOptions(dynamicCommands);
  const bareGoal = commands.find((command) => command.name === "goal");
  assert.equal(bareGoal?.source, "gui");
  assert.equal(bareGoal?.dynamicCommand?.name, "goal:1");
  assert.equal(bareGoal?.description, "Project goal");
});

test("leading slash command parsing supports first-line multi-line drafts", () => {
  assert.deepEqual(parseLeadingSlashCommand("hello\n/model"), undefined);
  assert.deepEqual(parseLeadingSlashCommand("  /compact keep this\nbody text"), { name: "compact", args: "keep this", lineStart: 2, lineEnd: 20 });
  assert.equal(replaceLeadingCommandLine("  /comp\nbody text", "/compact "), "  /compact \nbody text");

  const compact = buildCommandOptions([]).find((command) => command.name === "compact");
  assert.ok(compact);
  assert.equal(completeCommandPrompt("/comp\nbody text", compact), "/compact \nbody text");
});

test("composer model argument completion searches and completes model keys", () => {
  const models: ModelSummary[] = [
    { provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/GPT-5.4", supportsThinking: true, supportedThinkingLevels: ["medium"], supportsImages: false, supportsFast: true },
    { provider: "anthropic", id: "claude-sonnet-4.5", label: "anthropic/Claude Sonnet 4.5", supportsThinking: true, supportedThinkingLevels: ["medium"], supportsImages: false, supportsFast: false },
  ];
  const completion = buildComposerCompletions({ prompt: "/model claude", commands: buildCommandOptions([]), models, selectedIndex: 0, suppressed: false });
  assert.equal(completion.visible, true);
  assert.equal(completion.items[0]?.kind, "model");
  assert.equal(completion.items[0]?.description, "anthropic/claude-sonnet-4.5");

  const exactCompletion = buildComposerCompletions({ prompt: "/model openai-codex/gpt-5.4", commands: buildCommandOptions([]), models, selectedIndex: 0, suppressed: false });
  assert.equal(exactCompletion.items[0]?.kind, "model");
  assert.equal(exactCompletion.items[0]?.description, "openai-codex/gpt-5.4");
  assert.equal(completeModelPrompt("  /model gpt\nkeep body", models[0]), "  /model openai-codex/gpt-5.4\nkeep body");
});
