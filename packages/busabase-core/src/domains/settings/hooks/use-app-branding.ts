"use client";

import { useEffect, useState } from "react";
import type { AppBrandingVO } from "../types/app-branding";

/**
 * Broadcast when the Branding tab saves, so the already-mounted dashboard
 * shell picks up the new name/description/logo without a page reload.
 */
export const APP_BRANDING_CHANGED_EVENT = "busabase:app-branding-changed";

export const notifyAppBrandingChanged = (branding: AppBrandingVO) => {
  window.dispatchEvent(new CustomEvent(APP_BRANDING_CHANGED_EVENT, { detail: branding }));
};

export const fetchAppBranding = async (): Promise<AppBrandingVO | null> => {
  try {
    const res = await fetch("/api/branding");
    if (!res.ok) return null;
    return (await res.json()) as AppBrandingVO;
  } catch {
    // Branding is cosmetic — a failed read just leaves the defaults in place.
    return null;
  }
};

/**
 * Reads the operator's white-label branding for the sidebar. Returns `null`
 * until the first read resolves (and forever if nothing is customized), which
 * is exactly the "render the stock chrome" signal the shell needs.
 */
export const useAppBranding = (): AppBrandingVO | null => {
  const [branding, setBranding] = useState<AppBrandingVO | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAppBranding().then((next) => {
      if (!cancelled) setBranding(next);
    });

    const onChanged = (event: Event) => {
      setBranding((event as CustomEvent<AppBrandingVO>).detail);
    };
    window.addEventListener(APP_BRANDING_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_BRANDING_CHANGED_EVENT, onChanged);
    };
  }, []);

  return branding;
};
