import type { SVGProps } from "react";

/** Compact glyph derived from the official ACP wordmark for dense session rows. */
export function AcpSourceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-label="ACP"
      role="img"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fill="currentColor"
        d="M18 1.5c-5.3 0-10.1 2.8-12.8 7.4L1.9 14.6a14.7 14.7 0 0 0 0 14.8A14.8 14.8 0 0 0 14.7 36h6.6a1.4 1.4 0 0 0 1.2-.7l3.7-6.4a1.4 1.4 0 0 0-1.2-2.1H14.7a5.5 5.5 0 0 1-4.8-2.7 5.4 5.4 0 0 1 0-5.5L13.2 13A5.5 5.5 0 0 1 18 10.2a5.5 5.5 0 0 1 4.8 2.8l3.3 5.6c1 1.7 1 3.8 0 5.5a1.4 1.4 0 0 0 0 1.4l3.7 6.4c.5.9 1.8.9 2.4 0a14.7 14.7 0 0 0 1.9-17.3l-3.3-5.7A14.8 14.8 0 0 0 18 1.5Z"
      />
    </svg>
  );
}
