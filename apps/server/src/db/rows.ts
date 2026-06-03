import type { ConversationMessage, GuiEventKind, RuntimeStatus } from "@pi-gui/shared";

export type ProjectRow = {
  id: string;
  name: string;
  cwd: string;
  last_opened_at: number;
  default_model: string | null;
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
};

export type SessionRow = {
  id: string;
  project_id: string;
  pi_session_file: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  runtime_id: string | null;
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
  message_count: number;
};
