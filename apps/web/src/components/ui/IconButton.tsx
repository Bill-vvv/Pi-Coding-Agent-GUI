import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../Icon";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title"> & {
  icon: IconName;
  label: string;
  title?: string;
};

export function IconButton({ icon, label, title, className, type = "button", ...buttonProps }: IconButtonProps) {
  return (
    <button {...buttonProps} className={["icon-button", className].filter(Boolean).join(" ")} type={type} title={title ?? label} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}
