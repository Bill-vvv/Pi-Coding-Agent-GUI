import type { ConversationMessage, ExecutionHostKind, GuiEventKind, RuntimeProfileId, RuntimeStatus, SubagentRunMode, SubagentRunStatus } from "@pi-gui/shared";

export type ProjectRow = {
  id: string;
  name: string;
  cwd: string;
  cwd_wsl: string | null;
  cwd_windows: string | null;
  last_opened_at: number;
  default_model: string | null;
  default_runtime_profile_id: RuntimeProfileId | null;
  host_kind: ExecutionHostKind | null;
  host_id: string | null;
  host_label: string | null;
};

export type RuntimeRow = {
  id: string;
  project_id: string;
  cwd: string;
  status: RuntimeStatus;
  pid: number | null;
  session_id: string | null;
  started_at: number | null;
  archived_at: number | null;
  model: string | null;
  thinking_level: string | null;
  response_mode: string | null;
  host_kind: ExecutionHostKind | null;
  host_id: string | null;
  host_label: string | null;
  runtime_profile_id: RuntimeProfileId | null;
  enabled_capability_ids_json: string | null;
};

export type SessionRow = {
  id: string;
  project_id: string;
  pi_session_file: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  runtime_id: string | null;
  host_kind: ExecutionHostKind | null;
  host_id: string | null;
  host_label: string | null;
};

export type EventRow = {
  id: number;
  runtime_id: string;
  project_id: string;
  timestamp: number;
  kind: GuiEventKind;
  payload: string;
};

export type ConversationMessageRow = {
  runtime_id: string;
  project_id: string;
  message_id: string;
  role: ConversationMessage["role"];
  text: string;
  thinking: string | null;
  title: string | null;
  is_streaming: number;
  tool_details_json: string | null;
  timestamp: number | null;
  created_at: number;
  updated_at: number;
};

export type RuntimeConversationStateRow = {
  runtime_id: string;
  project_id: string;
  tokens: number | null;
  context_window: number | null;
  percent: number | null;
  session_tokens_json: string | null;
  updated_at: number;
  busy: number;
};

export type RuntimeConversationSummaryRow = {
  runtime_id: string;
  project_id: string;
  first_user_text: string | null;
  first_message_text: string | null;
  latest_message_text: string | null;
  latest_updated_at: number | null;
  latest_assistant_completed_at: number | null;
  message_count: number;
};

export type SubagentRunRow = {
  id: string;
  project_id: string;
  parent_runtime_id: string;
  parent_tool_call_id: string;
  parent_tool_message_id: string;
  agent: string;
  mode: SubagentRunMode;
  context_mode: string | null;
  status: SubagentRunStatus;
  started_at: number;
  updated_at: number;
  finished_at: number | null;
  final_text: string | null;
  error_message: string | null;
  runs_json: string;
};
