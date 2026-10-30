# NProgress Integration

Shared NProgress components for consistent navigation feedback across all apps.

## How It Works

`NProgressProvider` uses a **global click interceptor** that automatically triggers NProgress for all internal link clicks. You don't need special Link components or manual `NProgress.start()` calls.

## Usage

Render `NavigationProgress` next to the page, not around it:

```tsx
import { NavigationProgress } from "openlib/ui/nprogress";

export default function PublicLayout({ children }) {
  return (
    <ORPCProvider>
      <NavigationProgress />
      {children}
    </ORPCProvider>
  );
}
```

That's it! All `<a>` tags pointing to internal routes will automatically show NProgress.

Don't wrap the page in `NProgressProvider` inside a layout. It reads
`useSearchParams()`, so a static page bails out to client rendering up to the
nearest Suspense boundary, and the boundary you add around it costs you either
way: `<Suspense fallback={children}>` streams every page twice (two `<h1>`s for
crawlers), and a bare `<Suspense>` streams the page before `notFound()` runs (a
404 goes out as HTTP 200). `NavigationProgress` keeps the listener in a
boundary of its own. `NProgressProvider` stays exported for client-only trees
(a dashboard SPA) where neither problem applies.

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
  ├─ NavigationProgress
  │   └─ Suspense (fallback: nothing)
  │       └─ NProgressProvider (global click interceptor + pathname tracking)
  └─ Your page (rendered once, outside the boundary)
```

The provider:
1. Intercepts clicks on internal `<a>` tags → calls `NProgress.start()`
2. Tracks `usePathname()` + `useSearchParams()` → calls `NProgress.done()` on route change

## Links handled without navigation

Mark an enhanced link with `data-nprogress="ignore"` when its normal click opens
an in-page dialog instead of navigating. This lets the capture-phase listener
skip the navigation indicator while the link retains a real URL for fallback
navigation. Ordinary links and custom destinations keep their existing behavior.
