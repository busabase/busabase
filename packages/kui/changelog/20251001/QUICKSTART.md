# Quick Start Guide - kui

## What is kui?

`kui` is your centralized design system based on shadcn/ui, providing 45+ React components with full tree-shaking support. No build step required - it's pure TypeScript consumed directly by your Next.js apps.

## 5-Minute Setup

### 1. Add Dependency

In your app's `package.json`:

```json
{
  "dependencies": {
    "kui": "workspace:*"
  }
}
```

Run: `pnpm install`

### 2. Configure Next.js

Update `next.config.mjs`:

```javascript
const nextConfig = {
  transpilePackages: ["kui"],
};

export default nextConfig;
```

### 3. Configure Tailwind

Update `tailwind.config.ts`:

```typescript
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/kui/src/**/*.{js,ts,jsx,tsx}", // Add this
  ],
};
```

### 4. Import Styles

In `app/layout.tsx`:

```tsx
import "kui/styles.css";
```

### 5. Use Components!

```tsx
import { Button } from "kui/button";
import { Card } from "kui/card";

export default function Page() {
  return (
    <Card className="p-6">
      <h1>Hello from kui!</h1>
      <Button>Click me</Button>
    </Card>
  );
}
```

## Common Components

```tsx
// Buttons
import { Button } from "kui/button";
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>

// Forms
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Textarea } from "kui/textarea";
import { Select } from "kui/select";
import { Checkbox } from "kui/checkbox";

// Layout
import { Card } from "kui/card";
import { Separator } from "kui/separator";
import { Tabs } from "kui/tabs";

// Overlays
import { Dialog } from "kui/dialog";
import { Sheet } from "kui/sheet";
import { Popover } from "kui/popover";
import { DropdownMenu } from "kui/dropdown-menu";

// Feedback
import { Sonner } from "kui/sonner";
import { Alert } from "kui/alert";
import { Skeleton } from "kui/skeleton";
import { Progress } from "kui/progress";

// Data Display
import { Table } from "kui/table";
import { Avatar } from "kui/avatar";
import { Badge } from "kui/badge";
```

## Utilities

### cn() - Class Name Merger

```tsx
import { cn } from "kui/utils";

<div className={cn(
  "base-class",
  isActive && "active-class",
  className
)} />
```

### useMobile - Responsive Hook

```tsx
import { useMobile } from "kui/hooks/use-mobile";

export function MyComponent() {
  const isMobile = useMobile();
  return <div>{isMobile ? "Mobile" : "Desktop"}</div>;
}
```

## Dark Mode Setup

Install `next-themes`:

```bash
pnpm add next-themes
```

Wrap your app:

```tsx
// app/layout.tsx
import "kui/styles.css";
import { ThemeProvider } from "next-themes";

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

## Complete Component List

See all 45+ components:
- Accordion, Alert, Alert Dialog, Aspect Ratio, Avatar
- Badge, Breadcrumb, Button
- Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Command, Context Menu
- Dialog, Drawer, Dropdown Menu
- Form
- Hover Card
- Input, Input OTP
- Label
- Menubar
- Navigation Menu
- Pagination, Popover, Progress
- Radio Group, Resizable
- Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner, Switch
- Table, Tabs, Textarea, Toggle, Toggle Group, Tooltip

## Need Help?

- 📚 Full docs: `packages/kui/README.md`
- 💡 Examples: `packages/kui/EXAMPLES.md`
- 🔧 Setup: `packages/kui/SETUP_SUMMARY.md`
- 🚀 Migration: `packages/kui/MIGRATION.md`

## Adding More Components

```bash
cd packages/kui
npx shadcn@latest add [component-name]
```

Then add to `package.json` exports.

---

**You're ready to build with kui! 🎉**
