import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse } from "@pi-gui/shared";
import {
  batchAnswerStats,
  customAnswer,
  isBatchQuestionAnswered,
  multiAnswer,
  normalizeBatchQuestion,
  optionAnswer,
  optionValueForAnswer,
  seedBatchAnswer,
  seedBatchOtherValue,
  selectedMultiValues,
  serializeAskBatchResponse,
  type BatchAnswer,
  type BatchAnswers,
  type BatchOtherValues,
  type NormalizedBatchQuestion,
} from "../domain/extensionAskBatch";

type ExtensionUiDialogProps = {
  request?: ExtensionUiRequest;
  onRespond: (response: ExtensionUiResponse) => void;
  onCancel: () => void;
  variant?: "modal" | "inline";
};

export function ExtensionUiDialog({ request, onRespond, onCancel, variant = "modal" }: ExtensionUiDialogProps) {
  const [value, setValue] = useState("");
  const [batchAnswers, setBatchAnswers] = useState<BatchAnswers>({});
  const [batchOtherValues, setBatchOtherValues] = useState<BatchOtherValues>({});
  const batchQuestions = useMemo(() => (request?.method === "askBatch" ? request.questions.map(normalizeBatchQuestion) : []), [request]);
  const currentBatchAnswerStats = useMemo(() => batchAnswerStats(batchQuestions, batchAnswers), [batchAnswers, batchQuestions]);

  useEffect(() => {
    if (!request) return;
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
    if (request.method === "askBatch") {
      const seeded: BatchAnswers = {};
      const seededOther: BatchOtherValues = {};
      for (const question of request.questions.map(normalizeBatchQuestion)) {
        const answer = seedBatchAnswer(question);
        if (answer) seeded[question.id] = answer;
        const otherValue = seedBatchOtherValue(question);
        if (otherValue) seededOther[question.id] = otherValue;
      }
      setBatchAnswers(seeded);
      setBatchOtherValues(seededOther);
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
    onRespond(serializeAskBatchResponse({ title: request.title, questions: batchQuestions, answers: batchAnswers, cancelled }));
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
  const canSubmitBatch = request.method !== "askBatch" || request.submitPolicy === "allow_partial" || currentBatchAnswerStats.missingRequired.length === 0;
  const isAskBatch = request.method === "askBatch";

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (request?.method !== "askBatch" || canSubmitBatch) {
        event.preventDefault();
        submit();
      }
    }
  }

  const panel = (
    <section
      className={`extension-ui-dialog${isAskBatch ? " ask-batch-dialog" : ""}${variant === "inline" ? " extension-ui-inline" : ""}`}
      role={variant === "modal" ? "dialog" : "group"}
      aria-modal={variant === "modal" ? true : undefined}
      aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleDialogKeyDown}
    >
        <header className={isAskBatch ? "ask-batch-header" : undefined}>
          {isAskBatch ? (
            <div className="ask-batch-title-row">
              <div>
                <span className="ask-batch-eyebrow">Interactive Prompts</span>
                <h2>{title}</h2>
              </div>
              <span className="ask-batch-progress">{currentBatchAnswerStats.answered}/{currentBatchAnswerStats.total} 已回答</span>
            </div>
          ) : <h2>{title}</h2>}
          {"message" in request ? <p>{request.message}</p> : null}
          {isAskBatch && request.context ? <p className="ask-batch-context">{request.context}</p> : null}
          {isAskBatch && currentBatchAnswerStats.missingRequired.length > 0 ? (
            <p className="ask-batch-required-warning">还有 {currentBatchAnswerStats.missingRequired.length} 个必填问题未回答</p>
          ) : null}
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
            {batchQuestions.map((question, questionIndex) => {
              const answer = batchAnswers[question.id];
              const answered = isBatchQuestionAnswered(answer);
              const missing = question.required && !answered;
              return (
                <fieldset className={`ask-batch-question${answered ? " is-answered" : ""}${missing ? " is-missing" : ""}`} key={question.id}>
                  <legend>
                    <span className="ask-batch-question-index">{questionIndex + 1}</span>
                    <span className="ask-batch-question-title">{question.label}</span>
                    <em className={answered ? "is-complete" : missing ? "is-required" : undefined}>{answered ? "已回答" : question.required ? "必填" : "可选"}</em>
                  </legend>
                  <p className="ask-batch-prompt">{question.prompt}</p>
                  {question.situation ? (
                    <p className="ask-batch-note">
                      <span className="ask-batch-note-label">情况</span>
                      <span>{question.situation}</span>
                    </p>
                  ) : null}
                  {question.suggestion ? (
                    <p className="ask-batch-note suggestion">
                      <span className="ask-batch-note-label">建议</span>
                      <span>{question.suggestion}</span>
                    </p>
                  ) : null}
                  <BatchQuestionControl
                    question={question}
                    answer={answer}
                    otherValue={batchOtherValues[question.id] ?? ""}
                    autoFocus={questionIndex === 0}
                    onAnswer={(nextAnswer) => saveBatchAnswer(nextAnswer, question.id)}
                    onOtherValue={(nextValue) => setOtherValue(question, nextValue)}
                  />
                </fieldset>
              );
            })}
          </div>
        ) : null}

        <footer className={isAskBatch ? "ask-batch-footer" : undefined}>
          {isAskBatch ? <span className="ask-batch-submit-hint">Ctrl/⌘+Enter 提交</span> : null}
          <button type="button" onClick={onCancel}>取消</button>
          {request.method === "confirm" ? <button type="button" onClick={() => onRespond({ confirmed: false })}>否</button> : null}
          {request.method !== "select" ? <button type="button" onClick={submit} disabled={request.method === "askBatch" && !canSubmitBatch}>{request.method === "confirm" ? "是" : "提交"}</button> : null}
        </footer>
    </section>
  );

  if (variant === "inline") {
    return <div className="extension-ui-inline-host">{panel}</div>;
  }

  return (
    <div className="extension-ui-backdrop" onMouseDown={onCancel}>
      {panel}
    </div>
  );
}

function BatchQuestionControl({ question, answer, otherValue, autoFocus, onAnswer, onOtherValue }: {
  question: NormalizedBatchQuestion;
  answer?: BatchAnswer;
  otherValue: string;
  autoFocus?: boolean;
  onAnswer: (answer: BatchAnswer | undefined) => void;
  onOtherValue: (value: string) => void;
}) {
  if (question.kind === "text") {
    return (
      <textarea
        autoFocus={autoFocus}
        className="ask-batch-textarea"
        value={typeof answer?.value === "string" ? answer.value : ""}
        placeholder="输入你的回答…"
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
        {question.options.map((option, index) => {
          const checked = selected.has(option.value);
          return (
            <label className={`ask-batch-option${checked ? " is-selected" : ""}`} key={option.value}>
              <input
                autoFocus={autoFocus && index === 0}
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.value);
                  else next.delete(option.value);
                  onAnswer(multiAnswer(question, next, otherValue));
                }}
              />
              <span className="ask-batch-option-label">{option.label}</span>
              {option.description ? <small>{option.description}</small> : null}
            </label>
          );
        })}
        {question.allowOther ? <OtherInput value={otherValue} active={Boolean(otherValue.trim())} autoFocus={autoFocus && question.options.length === 0} onChange={onOtherValue} /> : null}
      </div>
    );
  }

  return (
    <div className="ask-batch-options">
      {question.options.map((option, index) => {
        const checked = !answer?.wasCustom && answer?.value === optionValueForAnswer(question, option.value);
        return (
          <label className={`ask-batch-option${checked ? " is-selected" : ""}`} key={option.value}>
            <input
              autoFocus={autoFocus && index === 0}
              type="radio"
              name={question.id}
              checked={checked}
              onChange={() => onAnswer(optionAnswer(question, option, index + 1))}
            />
            <span className="ask-batch-option-label">{option.label}</span>
            {option.description ? <small>{option.description}</small> : null}
          </label>
        );
      })}
      {question.allowOther && question.kind === "single" ? <OtherInput value={otherValue} active={Boolean(answer?.wasCustom)} autoFocus={autoFocus && question.options.length === 0} onChange={onOtherValue} /> : null}
    </div>
  );
}

function OtherInput({ value, active, autoFocus, onChange }: { value: string; active: boolean; autoFocus?: boolean; onChange: (value: string) => void }) {
  return (
    <div className={`ask-batch-custom-answer${active ? " is-selected" : ""}`}>
      <label className="ask-batch-custom-label">自定义输入</label>
      <input className="ask-batch-other" autoFocus={autoFocus} value={value} placeholder="输入其他答案…" onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function isDialogRequest(request: ExtensionUiRequest): boolean {
  return request.method === "select" || request.method === "confirm" || request.method === "input" || request.method === "editor" || request.method === "askBatch";
}

function dialogTitle(request: ExtensionUiRequest): string {
  return "title" in request && typeof request.title === "string" ? request.title : "Extension UI";
}
