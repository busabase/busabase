import { z } from "zod";

// ── Browser info (cloud-only; sandock exposes CDP/VNC of the containerized browser) ──
export const BrowserInfoSchema = z
  .object({
    user_agent: z.string(),
    cdp_url: z.string(),
    vnc_url: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
  })
  .nullable();
export type BrowserInfo = z.infer<typeof BrowserInfoSchema>;

// ── Preview URLs (cloud-only; proxy domain lives on sandock) ──
export const PreviewUrlResultSchema = z.object({ url: z.string(), token: z.string() });
export type PreviewUrlResult = z.infer<typeof PreviewUrlResultSchema>;

export const SignedPreviewUrlResultSchema = z.object({ url: z.string() });
export type SignedPreviewUrlResult = z.infer<typeof SignedPreviewUrlResultSchema>;

export const RevokePreviewTokenResultSchema = z.object({ revoked: z.boolean() });
export type RevokePreviewTokenResult = z.infer<typeof RevokePreviewTokenResultSchema>;
