import { IconButton } from "./ui";

type ProviderAuthPanelProps = {
  action: "login" | "logout";
  onClose: () => void;
};

export function ProviderAuthPanel({ action, onClose }: ProviderAuthPanelProps) {
  const command = action === "login" ? "pi  # 然后在 TUI 中执行 /login" : "pi  # 然后在 TUI 中执行 /logout";
  return (
    <section className="provider-auth-panel" aria-label="Provider auth">
      <header className="provider-auth-header">
        <div>
          <h2>{action === "login" ? "Provider 登录" : "Provider 退出"}</h2>
          <p>当前 Pi RPC 尚未暴露可由 GUI 安全接管的 provider auth 流程。</p>
        </div>
        <IconButton icon="x" label="关闭" onClick={onClose} />
      </header>

      <div className="provider-auth-card">
        <span className="provider-auth-pill">Terminal fallback</span>
        <strong>{action === "login" ? "请暂时在终端完成登录。" : "请暂时在终端完成退出登录。"}</strong>
        <code>{command}</code>
        <small>GUI 不会读取或保存 provider 密钥；当 Pi RPC 暴露 auth 能力后可在此接入原生流程。</small>
      </div>
    </section>
  );
}
