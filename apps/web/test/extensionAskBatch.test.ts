import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionUiAskBatchQuestion } from "@pi-gui/shared";
import {
  batchAnswerStats,
  customAnswer,
  multiAnswer,
  normalizeBatchQuestion,
  optionAnswer,
  seedBatchAnswer,
  seedBatchOtherValue,
  serializeAskBatchResponse,
} from "../src/domain/extensionAskBatch";

test("askBatch adapter normalizes required questions and serializes the existing response JSON shape", () => {
  const rawQuestions: ExtensionUiAskBatchQuestion[] = [
    { id: "scope", prompt: "Choose scope", options: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }] },
    { id: "notes", label: "Notes", prompt: "Any notes?", kind: "text", required: false, defaultValue: "Keep behavior" },
    { id: "confirm", prompt: "Proceed?", kind: "confirm", defaultValue: true },
  ];
  const questions = rawQuestions.map(normalizeBatchQuestion);
  const answers = {
    notes: seedBatchAnswer(questions[1])!,
    confirm: seedBatchAnswer(questions[2])!,
  };

  assert.equal(questions[0].required, true);
  assert.equal(questions[1].required, false);
  assert.deepEqual(batchAnswerStats(questions, answers), { answered: 2, total: 3, missingRequired: [questions[0]] });

  const response = serializeAskBatchResponse({ title: "Clarify", questions, answers, cancelled: false });
  assert.deepEqual(JSON.parse(response.value), {
    title: "Clarify",
    questions: JSON.parse(JSON.stringify(questions)),
    answers: [answers.notes, answers.confirm],
    unanswered: ["scope"],
    cancelled: false,
  });
});

test("askBatch adapter preserves option, custom, multi, and confirm answer conventions", () => {
  const single = normalizeBatchQuestion({ id: "model", prompt: "Model?", options: [{ value: "a", label: "A" }] }, 0);
  const multi = normalizeBatchQuestion({ id: "areas", prompt: "Areas?", kind: "multi", options: [{ value: "ui", label: "UI" }], defaultValue: ["ui", "docs"] }, 1);
  const confirm = normalizeBatchQuestion({ id: "ship", prompt: "Ship?", kind: "confirm" }, 2);

  assert.deepEqual(optionAnswer(single, single.options[0], 1), { id: "model", kind: "single", value: "a", label: "A", wasCustom: false, index: 1 });
  assert.deepEqual(customAnswer(single, " custom "), { id: "model", kind: "single", value: " custom ", label: "custom", wasCustom: true });
  assert.deepEqual(seedBatchOtherValue(multi), "docs");
  assert.deepEqual(seedBatchAnswer(multi), { id: "areas", kind: "multi", value: ["ui", "docs"], label: "UI, docs", wasCustom: true });
  assert.deepEqual(multiAnswer(multi, new Set(["ui"]), " api "), { id: "areas", kind: "multi", value: ["ui", "api"], label: "UI, api", wasCustom: true });
  assert.deepEqual(confirm.options.map((option) => option.value), ["yes", "no", "unsure"]);
  assert.deepEqual(optionAnswer(confirm, confirm.options[2], 3), { id: "ship", kind: "confirm", value: "unsure", label: "Not sure / 让 AI 推荐", wasCustom: false, index: 3 });
});
