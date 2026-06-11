import { useState } from "react";
import { IconButton } from "../ui";
import { copyWithTemporaryTextarea } from "./clipboard";

type CopyIconButtonProps = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function CopyIconButton({ value, label, disabled = false }: CopyIconButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (disabled) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        copyWithTemporaryTextarea(value);
      }
    } catch {
      copyWithTemporaryTextarea(value);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const title = copied ? "已复制" : label;

  return (
    <IconButton
      className={["markdown-copy-button", copied ? "is-copied" : ""].filter(Boolean).join(" ")}
      icon="copy"
      label={title}
      title={title}
      onClick={() => void handleCopy()}
      disabled={disabled}
    />
  );
}
