# NProgress Integration

Shared NProgress components for consistent navigation feedback across all apps.

## How It Works

`NProgressProvider` uses a **global click interceptor** that automatically triggers NProgress for all internal link clicks. You don't need special Link components or manual `NProgress.start()` calls.

## Usage

Just wrap your app with `NProgressProvider`:

```tsx
import { NProgressProvider } from "sharelib/ui/nprogress";

export default function DashboardLayout({ children }) {
  return (
    <TRPCProvider>
      <NProgressProvider>{children}</NProgressProvider>
    </TRPCProvider>
  );
}
```

That's it! All `<a>` tags pointing to internal routes will automatically show NProgress.

## What Gets Intercepted

✅ Internal links (`/dashboard`, `/settings`)
✅ Next.js `<Link>` components
✅ Wouter `<Link>` components
✅ Any `<a>` tag with internal href

❌ External links (`https://...`)
❌ Same-page hash navigation (`#section`)
❌ Links with `target="_blank"`
❌ Downloads (`download` attribute)

## Configuration

Adjust NProgress behavior in `nprogress-config.ts`:

```typescript
NProgress.configure({
  showSpinner: true,    // Show spinner in top-right
  speed: 400,           // Animation speed (ms)
  minimum: 0.08,        // Starting percentage
  easing: "ease",       // CSS easing function
  trickle: true,        // Auto-increment
  trickleSpeed: 200,    // Trickle interval (ms)
});
```

## Styling

Add to your app's `global.css`:

```css
@import "nprogress/nprogress.css";

@layer components {
  /* Theme-aware custom styles */
  #nprogress .bar {
    background: oklch(0.646 0.222 41.116); /* Light mode */
  }
  
  .dark #nprogress .bar {
    background: oklch(0.769 0.188 70.08); /* Dark mode */
  }
}
```

## Architecture

```
App Layout
  └─ NProgressProvider (global click interceptor + pathname tracking)
      └─ Your App
          └─ Any links work automatically
```

The provider:
1. Intercepts clicks on internal `<a>` tags → calls `NProgress.start()`
2. Tracks `usePathname()` + `useSearchParams()` → calls `NProgress.done()` on route change
