import type { ExtensionUiAskBatchOption, ExtensionUiAskBatchQuestion, ExtensionUiAskBatchQuestionKind, ExtensionUiResponse } from "@pi-gui/shared";

// Web adapter for the current Pi extension ask_batch contract. The Pi
// extension owns the questions/validation intent; this module only normalizes
// typed request data for rendering and preserves the existing JSON response
// convention sent inside ExtensionUiResponse.value.
export type NormalizedBatchQuestion = {
  id: string;
  label: string;
  prompt: string;
  situation?: string;
  suggestion?: string;
  kind: ExtensionUiAskBatchQuestionKind;
  options: ExtensionUiAskBatchOption[];
  allowOther: boolean;
  required: boolean;
  defaultValue?: string | string[] | boolean;
};

export type BatchAnswer = {
  id: string;
  kind: ExtensionUiAskBatchQuestionKind;
  value: string | string[] | boolean | null;
  label: string;
  wasCustom: boolean;
  index?: number;
  skipped?: boolean;
};

export type BatchAnswers = Record<string, BatchAnswer>;
export type BatchOtherValues = Record<string, string>;

export type BatchAnswerStats = {
  answered: number;
  total: number;
  missingRequired: NormalizedBatchQuestion[];
};

export function normalizeBatchQuestion(raw: ExtensionUiAskBatchQuestion, index: number): NormalizedBatchQuestion {
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const kind = raw.kind || (rawOptions.length > 0 ? "single" : "text");
  const options = kind === "confirm"
    ? [
        { value: "yes", label: "Yes / 确认" },
        { value: "no", label: "No / 否定" },
        { value: "unsure", label: "Not sure / 让 AI 推荐" },
      ]
    : rawOptions;
  return {
    id: raw.id || `q${index + 1}`,
    label: raw.label || `问题 ${index + 1}`,
    prompt: raw.prompt,
    situation: raw.situation,
    suggestion: raw.suggestion,
    kind,
    options,
    allowOther: raw.allowOther === true,
    required: raw.required !== false,
    defaultValue: raw.defaultValue,
  };
}

export function seedBatchAnswer(question: NormalizedBatchQuestion): BatchAnswer | undefined {
  const value = question.defaultValue;
  if (value === undefined) return undefined;
  if (question.kind === "confirm" && typeof value === "boolean") {
    const optionValue = value ? "yes" : "no";
    return { id: question.id, kind: question.kind, value, label: optionLabel(question, optionValue), wasCustom: false };
  }
  if (question.kind === "multi" && Array.isArray(value)) {
    const optionValues = new Set(question.options.map((option) => option.value));
    const selected = new Set(value.filter((candidate) => optionValues.has(candidate)));
    const custom = value.filter((candidate) => !optionValues.has(candidate)).join(", ");
    return multiAnswer(question, selected, custom);
  }
  if (typeof value === "string") {
    if (question.kind === "text") return customAnswer(question, value);
    const option = question.options.find((candidate) => candidate.value === value);
    return option ? optionAnswer(question, option, question.options.indexOf(option) + 1) : customAnswer(question, value);
  }
  return undefined;
}

export function seedBatchOtherValue(question: NormalizedBatchQuestion): string | undefined {
  const value = question.defaultValue;
  const optionValues = new Set(question.options.map((option) => option.value));
  if (question.kind === "single" && typeof value === "string" && !optionValues.has(value)) return value;
  if (question.kind === "multi" && Array.isArray(value)) {
    const custom = value.filter((candidate) => !optionValues.has(candidate)).join(", ");
    return custom || undefined;
  }
  return undefined;
}

export function optionAnswer(question: NormalizedBatchQuestion, option: ExtensionUiAskBatchOption, index: number): BatchAnswer {
  if (question.kind === "confirm") {
    return { id: question.id, kind: question.kind, value: option.value === "yes" ? true : option.value === "no" ? false : "unsure", label: option.label, wasCustom: false, index };
  }
  return { id: question.id, kind: question.kind, value: option.value, label: option.label, wasCustom: false, index };
}

export function optionValueForAnswer(question: NormalizedBatchQuestion, optionValue: string): string | boolean {
  if (question.kind !== "confirm") return optionValue;
  if (optionValue === "yes") return true;
  if (optionValue === "no") return false;
  return "unsure";
}

export function customAnswer(question: NormalizedBatchQuestion, value: string): BatchAnswer {
  return { id: question.id, kind: question.kind, value, label: value.trim(), wasCustom: true };
}

export function multiAnswer(question: NormalizedBatchQuestion, selected: Set<string>, otherValue: string): BatchAnswer | undefined {
  const custom = otherValue.trim();
  const values = [...selected, ...(custom ? [custom] : [])];
  if (!values.length) return undefined;
  const labels = [...selected].map((value) => optionLabel(question, value));
  if (custom) labels.push(custom);
  return { id: question.id, kind: question.kind, value: values, label: labels.join(", "), wasCustom: Boolean(custom) };
}

export function selectedMultiValues(question: NormalizedBatchQuestion, answer?: BatchAnswer): Set<string> {
  if (!answer || !Array.isArray(answer.value)) return new Set();
  const optionValues = new Set(question.options.map((option) => option.value));
  return new Set(answer.value.filter((value) => optionValues.has(value)));
}

export function isBatchQuestionAnswered(answer: BatchAnswer | undefined): boolean {
  if (!answer || answer.skipped) return false;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  if (typeof answer.value === "string") return answer.value.trim().length > 0;
  return answer.value !== null;
}

export function batchAnswerStats(questions: NormalizedBatchQuestion[], answers: BatchAnswers): BatchAnswerStats {
  const answered = questions.filter((question) => isBatchQuestionAnswered(answers[question.id])).length;
  const missingRequired = questions.filter((question) => question.required && !isBatchQuestionAnswered(answers[question.id]));
  return { answered, total: questions.length, missingRequired };
}

export function serializeAskBatchResponse(options: {
  title?: string;
  questions: NormalizedBatchQuestion[];
  answers: BatchAnswers;
  cancelled: boolean;
}): ExtensionUiResponse {
  const unanswered = options.questions.filter((question) => question.required && !isBatchQuestionAnswered(options.answers[question.id])).map((question) => question.id);
  return {
    value: JSON.stringify({
      title: options.title || "Clarify requirements",
      questions: options.questions,
      answers: Object.values(options.answers),
      unanswered,
      cancelled: options.cancelled,
    }),
  };
}

function optionLabel(question: NormalizedBatchQuestion, value: string): string {
  return question.options.find((option) => option.value === value)?.label ?? value;
}
