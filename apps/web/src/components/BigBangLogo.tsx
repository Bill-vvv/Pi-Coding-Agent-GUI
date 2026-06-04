type BigBangLogoProps = {
  size?: number;
  title?: string;
  className?: string;
};

export function BigBangLogo({ size = 48, title = "Pi GUI", className }: BigBangLogoProps) {
  return (
    <svg
      className={`bigbang-logo-sketch ${className ?? ""}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <g className="bigbang-logo-pencil" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path className="sketch-main" d="M31.5 68.5c1.2-19.1 16.1-34.7 34-35.9 19.6-1.4 33.9 14.2 34.8 31.8 1.1 20.8-15.1 32.3-31.9 33.8-17.6 1.6-38.5-8.8-36.9-29.7Z" />
        <path className="sketch-main sketch-offset" d="M28.8 66.7c3.9-21.4 21.8-32 38.6-30.1 18.7 2.1 31.9 16 30.7 31.9-1.3 18.6-16.6 31.4-34.3 30.3-20.8-1.2-37.6-12.2-35-32.1Z" />
        <path className="sketch-main sketch-light" d="M35.8 61.8c5.7-17.8 20.7-26.3 36.5-22.4 16.7 4.1 25.6 17.6 23 31.4-3.4 18.3-19.7 25.4-35.6 21.9-17.3-3.9-28.6-15.4-23.9-30.9Z" />
        <path className="sketch-hatch" d="M42 78.5c9.4 5.2 21.7 8 35.5 6.8" />
        <path className="sketch-hatch" d="M41.4 70.8c13.2 6.1 29.1 7.9 44.9 4.6" />
        <path className="sketch-hatch" d="M44.9 61.7c12.6 4.4 25.7 5.4 41.5 2.9" />
        <path className="sketch-hatch sketch-faint" d="M52.2 50.3c8.8 2.4 18.8 3.1 30.7 1.4" />
        <path className="sketch-hatch sketch-faint" d="M50.2 88.1c8 2.2 17.5 2.7 28.4 0.8" />
        <path className="sketch-cross" d="M57.6 41.2c-7.7 14.4-10.1 30.5-5.2 45.4" />
        <path className="sketch-cross" d="M72.5 39.9c-8.6 14.3-11.8 34.8-7.9 55" />
        <path className="sketch-cross sketch-faint" d="M86.1 48.1c-7.8 11.5-11.3 26.1-8.9 39.3" />
        <path className="sketch-axis" d="M64.6 23.5c0.8 12.9 0.8 25.2 0 36.8" />
        <path className="sketch-axis sketch-faint" d="M61.3 24.9c1.9 11.2 2.4 22.8 1.4 34.8" />
        <path className="sketch-spark" d="M53.5 25.2l-5.2-8.7" />
        <path className="sketch-spark" d="M76.1 25.1l5.6-8.4" />
      </g>
    </svg>
  );
}
