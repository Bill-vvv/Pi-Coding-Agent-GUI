export type IconName = "archive" | "arrow-left" | "arrow-right" | "checkpoint" | "copy" | "folder" | "mic" | "play" | "plus" | "send" | "settings" | "stop" | "x";

export function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true };

  switch (name) {
    case "archive":
      return (
        <svg {...common}>
          <path d="M5.25 8.5h13.5v9.25A2.25 2.25 0 0 1 16.5 20h-9a2.25 2.25 0 0 1-2.25-2.25V8.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M4.75 4h14.5a1 1 0 0 1 1 1v2.5h-16.5V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9.25 12h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="m11 6-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h13.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="m13 6 6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "checkpoint":
      return (
        <svg {...common}>
          <path d="M7.25 4.75h9.5A1.75 1.75 0 0 1 18.5 6.5v13l-6.5-3.75-6.5 3.75v-13a1.75 1.75 0 0 1 1.75-1.75Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m9 10.75 2.25 2.25L15.5 8.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6.5 14H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3.75 7.75A2.75 2.75 0 0 1 6.5 5h3.2c.72 0 1.39.34 1.82.92l.78 1.05c.24.32.61.51 1.01.51h5.19A2.75 2.75 0 0 1 21.25 10.23v5.52A3.25 3.25 0 0 1 18 19H6a3.25 3.25 0 0 1-3.25-3.25v-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <path d="M12 4.5a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0v-4a3 3 0 0 0-3-3Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6.5 10.5v1a5.5 5.5 0 0 0 11 0v-1M12 17v3M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M8 5.75v12.5l10-6.25-10-6.25Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m4.5 11.5 15-7-4.9 15-3.2-6.4-6.9-1.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m11.4 13.1 8.1-8.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4.5 7h5.25M13.75 7H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 12h8.25M16.75 12h2.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4.5 17h2.75M11.25 17h8.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="11.75" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="14.75" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="9.25" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.9" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}
