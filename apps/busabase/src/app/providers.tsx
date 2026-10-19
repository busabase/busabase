"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
      {/*
        The host owns the Toaster, as Cloud's root shell does. It must come from
        the same `sonner` that busabase-core's `toast()` calls resolve to: kui's
        Toaster wrapper pins its own copy, and a Toaster on a different copy
        never receives a single toast.
      */}
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  );
}
