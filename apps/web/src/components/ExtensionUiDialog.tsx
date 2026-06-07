import { useEffect, useMemo, useState } from "react";
import type { ExtensionUiAskBatchOption, ExtensionUiAskBatchQuestion, ExtensionUiAskBatchQuestionKind, ExtensionUiRequest, ExtensionUiResponse } from "@pi-gui/shared";

type ExtensionUiDialogProps = {
  request?: ExtensionUiRequest;
  onRespond: (response: ExtensionUiResponse) => void;
  onCancel: () => void;
};

type NormalizedBatchQuestion = {
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

type BatchAnswer = {
  id: string;
  kind: ExtensionUiAskBatchQuestionKind;
  value: string | string[] | boolean | null;
  label: string;
  wasCustom: boolean;
  index?: number;
  skipped?: boolean;
};

type BatchAnswers = Record<string, BatchAnswer>;
type BatchOtherValues = Record<string, string>;

export function ExtensionUiDialog({ request, onRespond, onCancel }: ExtensionUiDialogProps) {
  const [value, setValue] = useState("");
  const [batchAnswers, setBatchAnswers] = useState<BatchAnswers>({});
  const [batchOtherValues, setBatchOtherValues] = useState<BatchOtherValues>({});
  const batchQuestions = useMemo(() => (request?.method === "askBatch" ? request.questions.map(normalizeBatchQuestion) : []), [request]);

  useEffect(() => {
    if (!request) return;
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
    if (request.method === "askBatch") {
      const seeded: BatchAnswers = {};
      for (const question of request.questions.map(normalizeBatchQuestion)) {
        const answer = seedBatchAnswer(question);
        if (answer) seeded[question.id] = answer;
      }
      setBatchAnswers(seeded);
      setBatchOtherValues({});
    }
  }, [request]);

  if (!request || !isDialogRequest(request)) return null;

  function submit() {
    if (!request) return;
    if (request.method === "confirm") onRespond({ confirmed: true });
    else if (request.method === "askBatch") submitBatch(false);
    else onRespond({ value });
  }

  function submitBatch(cancelled: boolean) {
    if (!request || request.method !== "askBatch") return;
    const unanswered = batchQuestions.filter((question) => question.required && !isBatchQuestionAnswered(batchAnswers[question.id])).map((question) => question.id);
    const result = {
      title: request.title || "Clarify requirements",
      answers: Object.values(batchAnswers),
      unanswered,
      cancelled,
    };
    onRespond({ value: JSON.stringify(result) });
  }

  function saveBatchAnswer(answer: BatchAnswer | undefined, questionId: string) {
    setBatchAnswers((current) => {
      const next = { ...current };
      if (answer) next[questionId] = answer;
      else delete next[questionId];
      return next;
    });
  }

  function setOtherValue(question: NormalizedBatchQuestion, nextValue: string) {
    setBatchOtherValues((current) => ({ ...current, [question.id]: nextValue }));
    if (question.kind === "single") {
      const trimmed = nextValue.trim();
      saveBatchAnswer(trimmed ? customAnswer(question, trimmed) : undefined, question.id);
    }
    if (question.kind === "multi") {
      const selected = selectedMultiValues(question, batchAnswers[question.id]);
      saveBatchAnswer(multiAnswer(question, selected, nextValue), question.id);
    }
  }

  const title = dialogTitle(request);
  const canSubmitBatch = request.method !== "askBatch" || request.submitPolicy === "allow_partial" || batchQuestions.every((question) => !question.required || isBatchQuestionAnswered(batchAnswers[question.id]));

  return (
    <div className="extension-ui-backdrop" onMouseDown={onCancel}>
      <section className={`extension-ui-dialog${request.method === "askBatch" ? " ask-batch-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          {"message" in request ? <p>{request.message}</p> : null}
          {request.method === "askBatch" && request.context ? <p>{request.context}</p> : null}
        </header>

        {request.method === "select" ? (
          <div className="extension-ui-options">
            {request.options.map((option) => (
              <button key={option} type="button" onClick={() => onRespond({ value: option })}>
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {request.method === "input" ? (
          <input autoFocus value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
        ) : null}

        {request.method === "editor" ? <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} /> : null}

        {request.method === "askBatch" ? (
          <div className="ask-batch-form">
            {batchQuestions.map((question, questionIndex) => (
              <fieldset className="ask-batch-question" key={question.id}>
                <legend>
                  <span>{questionIndex + 1}. {question.label}</span>
                  {question.required ? <em>必填</em> : <em>可选</em>}
                </legend>
                <p className="ask-batch-prompt">{question.prompt}</p>
                {question.situation ? <p className="ask-batch-note"><strong>情况：</strong>{question.situation}</p> : null}
                {question.suggestion ? <p className="ask-batch-note suggestion"><strong>建议：</strong>{question.suggestion}</p> : null}
                <BatchQuestionControl
                  question={question}
                  answer={batchAnswers[question.id]}
                  otherValue={batchOtherValues[question.id] ?? ""}
                  onAnswer={(answer) => saveBatchAnswer(answer, question.id)}
                  onOtherValue={(nextValue) => setOtherValue(question, nextValue)}
                />
              </fieldset>
            ))}
          </div>
        ) : null}

        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          {request.method === "confirm" ? <button type="button" onClick={() => onRespond({ confirmed: false })}>否</button> : null}
          {request.method !== "select" ? <button type="button" onClick={submit} disabled={request.method === "askBatch" && !canSubmitBatch}>{request.method === "confirm" ? "是" : "提交"}</button> : null}
        </footer>
      </section>
    </div>
  );
}

function BatchQuestionControl({ question, answer, otherValue, onAnswer, onOtherValue }: {
  question: NormalizedBatchQuestion;
  answer?: BatchAnswer;
  otherValue: string;
  onAnswer: (answer: BatchAnswer | undefined) => void;
  onOtherValue: (value: string) => void;
}) {
  if (question.kind === "text") {
    return (
      <textarea
        className="ask-batch-textarea"
        value={typeof answer?.value === "string" ? answer.value : ""}
        onChange={(event) => {
          const trimmed = event.target.value.trim();
          onAnswer(trimmed ? customAnswer(question, event.target.value) : undefined);
        }}
      />
    );
  }

  if (question.kind === "multi") {
    const selected = selectedMultiValues(question, answer);
    return (
      <div className="ask-batch-options">
        {question.options.map((option, index) => (
          <label className="ask-batch-option" key={option.value}>
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.value);
                else next.delete(option.value);
                onAnswer(multiAnswer(question, next, otherValue));
              }}
            />
            <span>{option.label}</span>
            {option.description ? <small>{option.description}</small> : null}
          </label>
        ))}
        {question.allowOther ? <OtherInput value={otherValue} onChange={onOtherValue} /> : null}
      </div>
    );
  }

  return (
    <div className="ask-batch-options">
      {question.options.map((option, index) => (
        <label className="ask-batch-option" key={option.value}>
          <input
            type="radio"
            name={question.id}
            checked={!answer?.wasCustom && answer?.value === optionValueForAnswer(question, option.value)}
            onChange={() => onAnswer(optionAnswer(question, option, index + 1))}
          />
          <span>{option.label}</span>
          {option.description ? <small>{option.description}</small> : null}
        </label>
      ))}
      {question.allowOther && question.kind === "single" ? <OtherInput value={otherValue} onChange={onOtherValue} /> : null}
    </div>
  );
}

function OtherInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input className="ask-batch-other" value={value} placeholder="其他 / 自定义答案" onChange={(event) => onChange(event.target.value)} />;
}

function normalizeBatchQuestion(raw: ExtensionUiAskBatchQuestion, index: number): NormalizedBatchQuestion {
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
    label: raw.label || raw.id || `Q${index + 1}`,
    prompt: raw.prompt,
    situation: raw.situation,
    suggestion: raw.suggestion,
    kind,
    options,
    allowOther: raw.allowOther !== undefined ? raw.allowOther : kind === "single" || kind === "multi",
    required: raw.required !== false,
    defaultValue: raw.defaultValue,
  };
}

function seedBatchAnswer(question: NormalizedBatchQuestion): BatchAnswer | undefined {
  const value = question.defaultValue;
  if (value === undefined) return undefined;
  if (question.kind === "confirm" && typeof value === "boolean") {
    const optionValue = value ? "yes" : "no";
    return { id: question.id, kind: question.kind, value, label: optionLabel(question, optionValue), wasCustom: false };
  }
  if (question.kind === "multi" && Array.isArray(value)) {
    return multiAnswer(question, new Set(value), "");
  }
  if (typeof value === "string") {
    if (question.kind === "text") return customAnswer(question, value);
    const option = question.options.find((candidate) => candidate.value === value);
    return option ? optionAnswer(question, option, question.options.indexOf(option) + 1) : customAnswer(question, value);
  }
  return undefined;
}

function optionAnswer(question: NormalizedBatchQuestion, option: ExtensionUiAskBatchOption, index: number): BatchAnswer {
  if (question.kind === "confirm") {
    return { id: question.id, kind: question.kind, value: option.value === "yes" ? true : option.value === "no" ? false : "unsure", label: option.label, wasCustom: false, index };
  }
  return { id: question.id, kind: question.kind, value: option.value, label: option.label, wasCustom: false, index };
}

function optionValueForAnswer(question: NormalizedBatchQuestion, optionValue: string): string | boolean {
  if (question.kind !== "confirm") return optionValue;
  if (optionValue === "yes") return true;
  if (optionValue === "no") return false;
  return "unsure";
}

function customAnswer(question: NormalizedBatchQuestion, value: string): BatchAnswer {
  return { id: question.id, kind: question.kind, value, label: value.trim(), wasCustom: true };
}

function multiAnswer(question: NormalizedBatchQuestion, selected: Set<string>, otherValue: string): BatchAnswer | undefined {
  const custom = otherValue.trim();
  const values = [...selected, ...(custom ? [custom] : [])];
  if (!values.length) return undefined;
  const labels = [...selected].map((value) => optionLabel(question, value));
  if (custom) labels.push(custom);
  return { id: question.id, kind: question.kind, value: values, label: labels.join(", "), wasCustom: Boolean(custom) };
}

function selectedMultiValues(question: NormalizedBatchQuestion, answer?: BatchAnswer): Set<string> {
  if (!answer || !Array.isArray(answer.value)) return new Set();
  const optionValues = new Set(question.options.map((option) => option.value));
  return new Set(answer.value.filter((value) => optionValues.has(value)));
}

function optionLabel(question: NormalizedBatchQuestion, value: string): string {
  return question.options.find((option) => option.value === value)?.label ?? value;
}

function isBatchQuestionAnswered(answer: BatchAnswer | undefined): boolean {
  if (!answer || answer.skipped) return false;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  if (typeof answer.value === "string") return answer.value.trim().length > 0;
  return answer.value !== null;
}

function isDialogRequest(request: ExtensionUiRequest): boolean {
  return request.method === "select" || request.method === "confirm" || request.method === "input" || request.method === "editor" || request.method === "askBatch";
}

function dialogTitle(request: ExtensionUiRequest): string {
  return "title" in request && typeof request.title === "string" ? request.title : "Extension UI";
}
