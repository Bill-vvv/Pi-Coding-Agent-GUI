import { useMemo, type CSSProperties } from "react";

export type ThinkingAnimationVariant = "bigbang" | "collapse" | "slow" | "sharp" | "wide";

type ThinkingAnimationProps = {
  variant?: ThinkingAnimationVariant;
  size?: number;
  label?: string;
  className?: string;
};

const RAY_COUNT = 16;
const RAY_LENGTHS = [1, 0.72, 1.22, 0.86, 1.08, 0.78, 1.32, 0.92];

export function ThinkingAnimation({ variant = "bigbang", size = 46, label = "Pi 正在思考…", className }: ThinkingAnimationProps) {
  const style = useMemo(() => ({ "--thinking-size": `${size}px` }) as CSSProperties, [size]);

  return (
    <span className={`thinking-status ${className ?? ""}`.trim()} aria-label={label} role="status">
      <span className={`thinking-visual thinking-${variant}`} style={style} aria-hidden="true">
        <span className="thinking-core" />
        <span className="thinking-line" />
        <span className="thinking-rays">
          {Array.from({ length: RAY_COUNT }, (_, index) => (
            <span
              className="thinking-ray"
              key={index}
              style={{
                "--ray-angle": `${(360 / RAY_COUNT) * index}deg`,
                "--ray-length": RAY_LENGTHS[index % RAY_LENGTHS.length],
                "--ray-delay": `${(index % 4) * 18 + Math.floor(index / 4) * 7}ms`,
              } as CSSProperties}
            />
          ))}
        </span>
      </span>
      <span className="thinking-label">{label}</span>
    </span>
  );
}

export function ThinkingStatus(props: ThinkingAnimationProps) {
  return <ThinkingAnimation {...props} />;
}
