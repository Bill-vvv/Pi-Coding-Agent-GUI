import { useEffect, useState } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse } from "@pi-gui/shared";

type ExtensionUiDialogProps = {
  request?: ExtensionUiRequest;
  onRespond: (response: ExtensionUiResponse) => void;
  onCancel: () => void;
};

export function ExtensionUiDialog({ request, onRespond, onCancel }: ExtensionUiDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!request) return;
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  if (!request || !isDialogRequest(request)) return null;

  function submit() {
    if (!request) return;
    if (request.method === "confirm") onRespond({ confirmed: true });
    else onRespond({ value });
  }

  return (
    <div className="extension-ui-backdrop" onMouseDown={onCancel}>
      <section className="extension-ui-dialog" role="dialog" aria-modal="true" aria-label={dialogTitle(request)} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{dialogTitle(request)}</h2>
          {"message" in request ? <p>{request.message}</p> : null}
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

        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          {request.method === "confirm" ? <button type="button" onClick={() => onRespond({ confirmed: false })}>否</button> : null}
          {request.method !== "select" ? <button type="button" onClick={submit}>{request.method === "confirm" ? "是" : "提交"}</button> : null}
        </footer>
      </section>
    </div>
  );
}

function isDialogRequest(request: ExtensionUiRequest): boolean {
  return request.method === "select" || request.method === "confirm" || request.method === "input" || request.method === "editor";
}

function dialogTitle(request: ExtensionUiRequest): string {
  return "title" in request && typeof request.title === "string" ? request.title : "Extension UI";
}
