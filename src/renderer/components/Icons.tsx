interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function StatusIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2 12h4l2.5-7 4 14 2.5-7H22" />
    </svg>
  );
}

export function SettingsIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
    </svg>
  );
}

export function FilesIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function NotesIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" />
    </svg>
  );
}

export function JarvisIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2M6 6l2.3 2.3M15.7 15.7L18 18M18 6l-2.3 2.3M8.3 15.7L6 18" />
    </svg>
  );
}

export function SendIcon({ size = 20 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 12l16-8-6 16-2.5-6.5z" />
    </svg>
  );
}

export function StopIcon({ size = 20 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MicIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </svg>
  );
}

export function ShieldIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 3l7.5 3v5.5c0 4.4-3.1 7.9-7.5 9.5-4.4-1.6-7.5-5.1-7.5-9.5V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}

export function SpeakerIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function MemoryIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </svg>
  );
}

export function TasksIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function CalendarIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function FinanceIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 19V9M10 19V5M16 19v-7M21 19H3" />
    </svg>
  );
}

export function MonitorIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8M12 16v4M6.5 11l2-2.5 2 3 2-4 2 3.5 1.5-1" />
    </svg>
  );
}

export function ActivityIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1z" />
      <path d="M9 9h6M9 12.5h4" />
    </svg>
  );
}

export function MailIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
    </svg>
  );
}

export function CalculatorIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
    </svg>
  );
}

export function CameraIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function AgentsIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="6" cy="7" r="2.3" />
      <circle cx="18" cy="7" r="2.3" />
      <circle cx="12" cy="17" r="2.3" />
      <path d="M8 8.4l2.6 6.4M16 8.4l-2.6 6.4M8.4 7h7.2" />
    </svg>
  );
}

export function BriefingIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </svg>
  );
}

export function BrainIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 2.8A3 3 0 0 0 5.5 13 3 3 0 0 0 9 17.5V4z" />
      <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 2.8 3 3 0 0 1-1.5 3.2A3 3 0 0 1 15 17.5V4z" />
      <path d="M12 4v16" />
    </svg>
  );
}

export function DocumentsIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 15.5h5" />
    </svg>
  );
}

export function ScenesIcon({ size = 24 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l2.5 1.5M9 3h6" />
    </svg>
  );
}
