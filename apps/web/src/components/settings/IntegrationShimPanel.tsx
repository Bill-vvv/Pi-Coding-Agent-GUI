import { implementationHostLabel, releaseStanceLabel, temporaryShimCounts, TEMPORARY_SHIMS } from "../../domain/temporaryShims";

export function IntegrationShimPanel() {
  const counts = temporaryShimCounts();

  return (
    <details className="settings-shim-dropdown">
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>适配层</span>
          <small>{counts.total} 个临时 shim · {counts.explicitSetup} 个需显式设置 · {counts.mutating} 个会改写用户环境</small>
        </span>
        <span className="settings-diagnostics-pill warning">Shim</span>
      </summary>

      <div className="settings-shim-body">
        <div className="settings-shim-list">
          {TEMPORARY_SHIMS.map((shim) => (
            <div className="settings-shim-row" key={shim.id}>
              <span className="settings-shim-main">
                <span>{shim.label}</span>
                <small>{shim.summary}</small>
              </span>
              <span className="settings-shim-tags">
                <span>{implementationHostLabel(shim.implementationHost)}</span>
                <span className={shim.mutatesPiEnvironment ? "warning" : undefined}>{releaseStanceLabel(shim.releaseStance)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="settings-shim-note">默认安装和启动不会改写 Pi、本机 wrapper、provider、portproxy 或外部工具；需要改写环境的适配必须由用户显式执行。</p>
      </div>
    </details>
  );
}
