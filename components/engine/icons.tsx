/**
 * Monochrome line icons for the Engine tool. All inherit
 * `currentColor` so state is expressed by the parent's color/opacity —
 * never by a hue (spec §3a).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, strokeWidth = 1.6, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden>
      <path d="m15 5-7 7 7 7" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden>
      <path d="M19 12H5" />
      <path d="m12 5-7 7 7 7" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 12 })} aria-hidden>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 14 })} aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 14 })} aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 21 })} aria-hidden>
      <path d="M12 20s-7-4.6-9.3-9C1.3 8.3 2.5 5 5.8 5c2 0 3.2 1.3 4.2 2.6C11 6.3 12.2 5 14.2 5c3.3 0 4.5 3.3 3.1 6-2.3 4.4-9.3 9-9.3 9Z" />
    </svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 21 })} aria-hidden>
      <path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5Z" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 21 })} aria-hidden>
      <path d="M22 3 11 14" />
      <path d="M22 3 15 21l-4-7-7-4 18-7Z" />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 21 })} aria-hidden>
      <path d="M6 4h12v17l-6-4.2L6 21V4Z" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M12 3.5c.4 3.8 1.7 5.1 5.5 5.5-3.8.4-5.1 1.7-5.5 5.5-.4-3.8-1.7-5.1-5.5-5.5 3.8-.4 5.1-1.7 5.5-5.5Z" />
      <path d="M18.5 14c.2 1.7.8 2.3 2.5 2.5-1.7.2-2.3.8-2.5 2.5-.2-1.7-.8-2.3-2.5-2.5 1.7-.2 2.3-.8 2.5-2.5Z" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L20 21" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M20 11.5 11.8 19.7a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2a3 3 0 0 1 4.3 4.3l-8.2 8.2a1.5 1.5 0 0 1-2.2-2.2l7.5-7.5" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function LayoutIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 9h16" />
    </svg>
  );
}

export function TextIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v10h12V10" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

export function ChannelsIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="2" />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="2" />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="2" />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="2" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M16.9 7.1h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function StarIcon({
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base({ ...props, size: props.size ?? 16 })}
      fill={filled ? "currentColor" : "none"}
      aria-hidden
    >
      <path d="M12 3.4l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />
    </svg>
  );
}

export function ArchiveIcon(props: IconProps) {
  return (
    <svg {...base({ ...props, size: props.size ?? 16 })} aria-hidden>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

/** Instagram-style speaker: waves when on, slash when muted. */
export function SpeakerIcon({
  off = false,
  ...props
}: IconProps & { off?: boolean }) {
  return (
    <svg
      {...base({ ...props, size: props.size ?? 14, strokeWidth: 2 })}
      aria-hidden
    >
      <path d="M11 5 6.5 8.5H3.5v7h3L11 19z" fill="currentColor" stroke="none" />
      {off ? (
        <path d="m15 9.5 5 5m0-5-5 5" />
      ) : (
        <>
          <path d="M14.5 9a4.4 4.4 0 0 1 0 6" />
          <path d="M17 6.8a8 8 0 0 1 0 10.4" />
        </>
      )}
    </svg>
  );
}
