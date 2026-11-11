import type { ReactNode } from "react";
import { type AttachmentFileKind, attachmentFileType } from "../utils/attachment-file-type";

// Original, deliberately simple marks remain recognizable in compact rows.
// Their shared folded sheet makes files read as content rather than status.
const glyphs = {
  spreadsheet: <path d="m12 23 16 16m0-16L12 39" strokeWidth={3.6} />,
  document: <path d="m9 24 5 14 6-10 6 10 5-14" strokeWidth={3.2} />,
  pdf: (
    <path
      d="M8 38V24h4a4 4 0 0 1 0 8H8m11-8v14h2a7 7 0 0 0 0-14h-2Zm12 14V24h6m-6 7h5"
      strokeWidth={2.3}
    />
  ),
  presentation: <path d="M14 39V23h8a6 6 0 0 1 0 12h-8" strokeWidth={3.2} />,
  json: <path d="M15 22h-2c-4 0 0 9-5 9 5 0 1 9 5 9h2m10-18h2c4 0 0 9 5 9-5 0-1 9-5 9h-2" />,
  markdown: <path d="M8 38V24l7 8 7-8v14m8-14v14m-4-4 4 4 4-4" strokeWidth={2.8} />,
  code: <path d="m14 24-7 7 7 7m12-14 7 7-7 7m-4-16-4 18" />,
  config: (
    <>
      <circle cx={20} cy={31} r={6} />
      <circle cx={20} cy={31} r={1.5} fill="var(--attachment-file-foreground)" stroke="none" />
      <path d="M20 21v4m0 12v4M10 31h4m12 0h4m-17-7 3 3m8 8 3 3m0-14-3 3m-8 8-3 3" />
    </>
  ),
  archive: (
    <>
      <path d="M18 21h4m-4 5h4m-4 5h4m-4 5h4" strokeWidth={3} />
      <rect height={5} rx={1} width={8} x={16} y={38} strokeWidth={2.2} />
    </>
  ),
  text: <path d="M11 24h18M11 31h18M11 38h12" />,
  image: (
    <>
      <rect height={17} rx={2} width={22} x={9} y={23} strokeWidth={2.3} />
      <circle cx={16} cy={28} r={2} fill="var(--attachment-file-foreground)" stroke="none" />
      <path d="m10 37 7-6 5 5 4-5 4 6" strokeWidth={2.3} />
    </>
  ),
  audio: (
    <>
      <path d="M18 37V24l12-3v13M18 28l12-3" strokeWidth={2.5} />
      <ellipse
        cx={14}
        cy={37}
        fill="var(--attachment-file-foreground)"
        rx={4.5}
        ry={3.5}
        stroke="none"
      />
      <ellipse
        cx={26}
        cy={34}
        fill="var(--attachment-file-foreground)"
        rx={4.5}
        ry={3.5}
        stroke="none"
      />
    </>
  ),
  video: <path d="m14 23 16 9-16 9Z" fill="var(--attachment-file-foreground)" stroke="none" />,
  file: <path d="M12 25h16M12 32h16M12 39h9" />,
} satisfies Record<AttachmentFileKind, ReactNode>;

/** Color identifies file content; dedicated tokens never reuse review-state colors. */
export function AttachmentFileIcon({
  fileName,
  mimeType,
  size = 20,
}: {
  fileName: string;
  mimeType: string;
  /** Artwork height; its page aspect ratio stays constant as rows grow. */
  size?: number;
}) {
  const { kind } = attachmentFileType(fileName, mimeType);
  return (
    <svg
      aria-hidden="true"
      className="block shrink-0"
      data-attachment-file-kind={kind}
      data-attachment-icon-style="colorful-folded"
      focusable="false"
      height={size}
      role="presentation"
      style={{ color: `var(--attachment-file-${kind})` }}
      viewBox="0 0 40 48"
      width={(size * 5) / 6}
    >
      <path
        d="M5 1h20l14 14v28a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4Z"
        data-attachment-file-sheet
        fill="currentColor"
      />
      <path d="M25 1v10a4 4 0 0 0 4 4h10Z" fill="var(--attachment-file-foreground)" opacity={0.3} />
      <g
        data-attachment-file-symbol
        fill="none"
        stroke="var(--attachment-file-foreground)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.8}
        transform="translate(0 -3)"
      >
        {glyphs[kind]}
      </g>
    </svg>
  );
}
