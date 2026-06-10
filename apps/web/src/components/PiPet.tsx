import { useEffect, useMemo, useRef, useState } from "react";
import type { PiPetDisplay } from "../domain/piPet";

type PiPetProps = {
  display: PiPetDisplay;
  collapsed: boolean;
  onChangeCollapsed: (collapsed: boolean) => void;
  onHide: () => void;
  onOpenRuntimeLogs?: () => void;
  onOpenSubagentRun?: (runId: string) => void;
  onOpenCapabilitySettings?: () => void;
  onOpenUsageOverview?: () => void;
  onOpenBackgroundRuntime?: () => void;
  desktopPetAvailable?: boolean;
  desktopPetEnabled?: boolean;
  onToggleDesktopPet?: (enabled: boolean) => void;
};

export function PiPet({ display, collapsed, onChangeCollapsed, onHide, onOpenRuntimeLogs, onOpenSubagentRun, onOpenCapabilitySettings, onOpenUsageOverview, onOpenBackgroundRuntime, desktopPetAvailable, desktopPetEnabled, onToggleDesktopPet }: PiPetProps) {
  const hasBadges = display.badges.length > 0;
  const canOpenSubagent = Boolean(display.activeSubagentRunId && onOpenSubagentRun);
  const canOpenLogs = display.canOpenRuntimeLogs && Boolean(onOpenRuntimeLogs);
  const canOpenUsageOverview = display.mood === "context" && Boolean(onOpenUsageOverview);
  const canOpenBackgroundRuntime = display.mood === "background" && Boolean(onOpenBackgroundRuntime);
  const livePriority = display.tone === "attention" || display.tone === "danger" ? "polite" : "off";
  const reactionKey = useMemo(() => piPetReactionKey(display), [display]);
  const lastReactionKeyRef = useRef(reactionKey);
  const [reacting, setReacting] = useState(false);
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    if (lastReactionKeyRef.current === reactionKey) return undefined;
    lastReactionKeyRef.current = reactionKey;
    setReacting(true);
    if (collapsed && piPetShouldPeek(display)) setPeeking(true);
    const reactionTimer = window.setTimeout(() => setReacting(false), 780);
    const peekTimer = window.setTimeout(() => setPeeking(false), 3600);
    return () => {
      window.clearTimeout(reactionTimer);
      window.clearTimeout(peekTimer);
    };
  }, [collapsed, display, reactionKey]);

  useEffect(() => {
    if (!collapsed) setPeeking(false);
  }, [collapsed]);

  return (
    <aside className={`pi-pet pi-pet-${display.mood} tone-${display.tone} ${collapsed ? "collapsed" : "expanded"} ${reacting ? "reacting" : ""}`} aria-label="Pi PET">
      <button
        className="pi-pet-orb-button"
        type="button"
        aria-label={collapsed ? `展开 Pi PET：${display.title}` : `折叠 Pi PET：${display.title}`}
        title={collapsed ? display.title : "折叠 Pi PET"}
        onClick={() => onChangeCollapsed(!collapsed)}
      >
        <PiPetOrb mood={display.mood} satelliteCount={display.satelliteCount} />
        {hasBadges ? <span className="pi-pet-badge-dot" aria-hidden="true">{display.badges.length}</span> : null}
      </button>

      {collapsed && peeking ? <span className="pi-pet-peek">{display.title}</span> : null}

      {collapsed ? null : (
        <section className="pi-pet-panel">
          <div className="pi-pet-copy" role="status" aria-live={livePriority} aria-atomic="true">
            <span className="pi-pet-heading-row">
              <strong>{display.title}</strong>
              <span className="pi-pet-capability-chip" title="Pi GUI built-in capability · UI-only">Capability</span>
            </span>
            <span>{display.detail}</span>
          </div>

          {display.signals.length > 0 ? (
            <dl className="pi-pet-signals" aria-label="Pi PET 原生信号">
              {display.signals.map((signal) => (
                <div className={`pi-pet-signal tone-${signal.tone}`} key={`${signal.label}:${signal.value}`}>
                  <dt>{signal.label}</dt>
                  <dd>{signal.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {display.activities.length > 0 ? (
            <ol className="pi-pet-activity" aria-label="Pi PET 近期活动">
              {display.activities.map((activity) => (
                <li className={`tone-${activity.tone}`} key={activity.text}>{activity.text}</li>
              ))}
            </ol>
          ) : null}

          {hasBadges ? (
            <div className="pi-pet-badges" aria-label="Pi PET 徽标">
              {display.badges.map((badge) => <span key={badge}>{badge}</span>)}
            </div>
          ) : null}

          <div className="pi-pet-actions">
            {canOpenSubagent && display.activeSubagentRunId ? (
              <button type="button" onClick={() => onOpenSubagentRun?.(display.activeSubagentRunId!)}>查看分身</button>
            ) : null}
            {canOpenLogs ? <button type="button" onClick={onOpenRuntimeLogs}>打开日志</button> : null}
            {canOpenUsageOverview ? <button type="button" onClick={onOpenUsageOverview}>用量概览</button> : null}
            {canOpenBackgroundRuntime ? <button type="button" onClick={onOpenBackgroundRuntime}>查看后台</button> : null}
            {desktopPetAvailable && onToggleDesktopPet ? <button type="button" onClick={() => onToggleDesktopPet(!desktopPetEnabled)}>{desktopPetEnabled ? "关闭桌宠" : "打开桌宠"}</button> : null}
            {onOpenCapabilitySettings ? <button type="button" onClick={onOpenCapabilitySettings}>能力设置</button> : null}
            <button type="button" onClick={() => onChangeCollapsed(true)}>折叠</button>
            <button type="button" onClick={onHide}>隐藏</button>
          </div>
        </section>
      )}
    </aside>
  );
}

function PiPetOrb({ mood, satelliteCount }: { mood: PiPetDisplay["mood"]; satelliteCount: number }) {
  return (
    <span className={`pi-pet-orb mood-${mood}`} aria-hidden="true">
      <span className="pi-pet-orb-aura" />
      <span className="pi-pet-orb-core" />
      <span className="pi-pet-orb-face">
        <span className="pi-pet-eye eye-left" />
        <span className="pi-pet-eye eye-right" />
        <span className="pi-pet-mouth" />
      </span>
      <span className="pi-pet-orb-tail" />
      {Array.from({ length: satelliteCount }, (_, index) => (
        <span className={`pi-pet-orb-satellite satellite-${index + 1}`} key={index} />
      ))}
      <span className="pi-pet-orb-spark spark-a" />
      <span className="pi-pet-orb-spark spark-b" />
      <span className="pi-pet-orb-spark spark-c" />
    </span>
  );
}

function piPetShouldPeek(display: PiPetDisplay): boolean {
  return display.tone === "attention" || display.tone === "danger" || display.mood === "subagents" || display.mood === "tool";
}

function piPetReactionKey(display: PiPetDisplay): string {
  return [
    display.mood,
    display.tone,
    display.title,
    display.detail,
    ...display.signals.map((signal) => `${signal.label}:${signal.value}:${signal.tone}`),
    ...display.activities.map((activity) => `${activity.text}:${activity.tone}`),
    ...display.badges,
  ].join("|");
}
