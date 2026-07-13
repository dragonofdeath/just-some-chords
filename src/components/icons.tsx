import type { ReactNode } from "react";

// The app icon set — imported from the chord-harmony-icons pack. All glyphs
// live on a 24×24 grid, stroke-drawn in currentColor, so they inherit the
// button's ink/paper color. Size is set per call site (the grid reads well
// down to ~11px).

interface IconProps {
  size?: number;
}

function I({ size = 16, sw, children }: IconProps & { sw?: number; children: ReactNode }) {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={sw ? "currentColor" : "none"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconAdd = (p: IconProps) => (
  <I {...p} sw={2}><path d="M12 4v16M4 12h16" /></I>
);

export const IconBack = (p: IconProps) => (
  <I {...p} sw={2}><path d="m15 5-7 7 7 7" /></I>
);

export const IconClose = (p: IconProps) => (
  <I {...p} sw={2}><path d="m5 5 14 14M19 5 5 19" /></I>
);

export const IconCompactView = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <rect x="2.5" y="8" width="19" height="8" rx="2" />
    <path d="M7.25 8v8m4.75-8v8m4.75-8v8" />
    <path d="M12 10.5v3" strokeWidth={3.2} />
  </I>
);

export const IconCountIn = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M4.5 8.5 7 6.5v11M4.5 17.5h5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <path d="M15.5 9a2.5 2.5 0 0 1 5 0c0 3-5 4.25-5 8.5h5" />
  </I>
);

export const IconDuplicate = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </I>
);

export const IconFullWheel = (p: IconProps) => (
  <I {...p} sw={1.6}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.25" />
    <path d="M12 3v4.75M12 16.25V21M3 12h4.75M16.25 12H21M5.64 5.64 9 9m6 6 3.36 3.36m0-12.72L15 9m-6 6-3.36 3.36" />
  </I>
);

export const IconKeyDropdown = (p: IconProps) => (
  <I {...p} sw={2}><path d="m5.5 8.5 6.5 7 6.5-7" /></I>
);

export const IconLoop = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M5 8h11a3 3 0 0 1 3 3v1" />
    <path d="m16 9 3 3 3-3M19 16H8a3 3 0 0 1-3-3v-1" />
    <path d="m8 15-3-3-3 3" />
  </I>
);

export const IconMenu = (p: IconProps) => (
  <I {...p}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
  </I>
);

export const IconMoveDown = (p: IconProps) => (
  <I {...p} sw={1.9}><path d="M12 4v15m-5-6 5 6 5-6" /></I>
);

export const IconMoveUp = (p: IconProps) => (
  <I {...p} sw={1.9}><path d="M12 20V5m-5 6 5-6 5 6" /></I>
);

export const IconMove = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M12 3v18m0-18-3 3m3-3 3 3m-3 15-3-3m3 3 3-3M3 12h18M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3" />
  </I>
);

export const IconMute = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M4 9h4l5-4v14l-5-4H4V9Z" />
    <path d="m17 9 4 6m0-6-4 6" />
  </I>
);

export const IconPiano = (p: IconProps) => (
  <I {...p} sw={1.5}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 6v12m4-12v12m4-12v12m4-12v12" />
    <path
      fill="currentColor"
      stroke="none"
      d="M4.6 6h2.8v5.3a1.4 1.4 0 0 1-2.8 0V6Zm4 0h2.8v5.3a1.4 1.4 0 0 1-2.8 0V6Zm8 0h2.8v5.3a1.4 1.4 0 0 1-2.8 0V6Z"
    />
  </I>
);

export const IconPlay = (p: IconProps) => (
  <I {...p}>
    <path fill="currentColor" d="M8 5.8c0-1.17 1.28-1.89 2.28-1.28l10.12 6.2a1.5 1.5 0 0 1 0 2.56l-10.12 6.2A1.5 1.5 0 0 1 8 18.2V5.8Z" />
  </I>
);

export const IconPreview = (p: IconProps) => (
  <I {...p} sw={1.7}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <path fill="currentColor" stroke="none" d="m10.4 9.25 4.5 2.75-4.5 2.75v-5.5Z" />
  </I>
);

export const IconRangeSelect = (p: IconProps) => (
  <I {...p} sw={1.7}>
    <path d="M5 4H3v16h2m14-16h2v16h-2" />
    <rect x="6.5" y="7" width="4" height="10" rx="1" />
    <rect x="13.5" y="7" width="4" height="10" rx="1" />
  </I>
);

export const IconRedo = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="m15 8 4 4-4 4" />
    <path d="M18.5 12H10a5 5 0 0 0-5 5v1" />
  </I>
);

export const IconRest = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M9 12h6" strokeWidth={2.2} />
  </I>
);

export const IconShare = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M5 8H4v10.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V8h-1" strokeLinecap="butt" />
    <path d="M12 15V3m-4 4 4-4 4 4" />
  </I>
);

export const IconSplit = (p: IconProps) => (
  <I {...p} sw={1.7}>
    <rect x="4" y="3" width="16" height="6" rx="1.5" />
    <rect x="4" y="15" width="7" height="6" rx="1.5" />
    <rect x="13" y="15" width="7" height="6" rx="1.5" />
    <path d="M12 9v3m0 0H7.5v3m4.5-3h4.5v3" />
  </I>
);

export const IconStop = (p: IconProps) => (
  <I {...p}><rect width="14" height="14" x="5" y="5" rx="2.5" fill="currentColor" /></I>
);

export const IconTrash = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M4 7h16m-10-3h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Zm-4 3 1 13h10l1-13M10 11v5m4-5v5" />
  </I>
);

export const IconUndo = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <path d="M9 8 5 12l4 4" />
    <path d="M5.5 12H14a5 5 0 0 1 5 5v1" />
  </I>
);

export const IconUseAgain = (p: IconProps) => (
  <I {...p} sw={1.8}>
    <rect x="2.5" y="4" width="9.5" height="5.5" rx="1.5" />
    <rect x="10" y="14.5" width="10.5" height="5.5" rx="1.5" />
    <path d="M14 6.75h2a3 3 0 0 1 3 3V13" />
    <path d="m16 10 3 3 3-3" />
  </I>
);
