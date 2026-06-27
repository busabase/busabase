# kui

A custom design system built on top of shadcn/ui with full tree-shaking support.

## Features

- 🎨 **45+ Components**: Complete UI component library based on shadcn/ui
- 🌲 **Tree-shakeable**: Individual component exports for optimal bundle size
- ⚡ **Zero Build Step**: Pure TypeScript library consumed directly by Next.js
- 🎭 **React 19**: Built with the latest React
- 🎨 **Tailwind CSS 4**: Modern styling with CSS variables
- 🔒 **Type-safe**: Full TypeScript support with strict mode
- 🎯 **Accessible**: Built on Radix UI primitives

## Installation

Add to your project using pnpm workspace:

```json
{
  "dependencies": {
    "kui": "workspace:*"
  }
}
```

## Usage

### 1. Configure Tailwind CSS

**IMPORTANT**: Add kui source files to your Tailwind content configuration to ensure all component styles are generated:

```js
// tailwind.config.js or tailwind.config.ts
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    // Add this line to scan kui components ↓
    "../../packages/kui/src/**/*.{js,ts,jsx,tsx}",
  ],
  // ... rest of config
};
```

Without this configuration, utility classes used in kui components (like `right-4`, `top-4`, etc.) won't be generated, causing styling issues.

### 2. Import Styles

Import the CSS in your app root (e.g., `app/layout.tsx` or `_app.tsx`):

```tsx
import "kui/styles.css";
```

### 3. Import Components

Import components individually for optimal tree-shaking:

```tsx
import { Button } from "kui/button";
import { Card } from "kui/card";
import { Input } from "kui/input";

export function MyComponent() {
  return (
    <Card>
      <Input placeholder="Enter text..." />
      <Button>Submit</Button>
    </Card>
  );
}
```

### Use Utilities

```tsx
import { cn } from "kui/utils";

// Merge Tailwind classes safely
const className = cn("text-lg font-bold", isActive && "text-blue-500");
```

### Use Hooks

```tsx
import { useMobile } from "kui/hooks/use-mobile";

export function ResponsiveComponent() {
  const isMobile = useMobile();
  
  return (
    <div>
      {isMobile ? "Mobile View" : "Desktop View"}
    </div>
  );
}
```

## Available Components

- **Layout**: Aspect Ratio, Card, Separator, Resizable
- **Navigation**: Breadcrumb, Menubar, Navigation Menu, Pagination, Sidebar, Tabs
- **Forms**: Button, Checkbox, Form, Input, Input OTP, Label, Radio Group, Select, Slider, Switch, Textarea, Toggle, Toggle Group
- **Data Display**: Avatar, Badge, Calendar, Table, Chart, Progress
- **Feedback**: Alert, Alert Dialog, Dialog, Drawer, Hover Card, Popover, Sheet, Sonner (Toast), Tooltip
- **Overlays**: Command, Context Menu, Dropdown Menu
- **Utilities**: Collapsible, Scroll Area, Skeleton, Carousel

## Component Exports

All components are exported individually:

```tsx
import { Accordion } from "kui/accordion";
import { Alert } from "kui/alert";
import { AlertDialog } from "kui/alert-dialog";
import { AspectRatio } from "kui/aspect-ratio";
import { Avatar } from "kui/avatar";
import { Badge } from "kui/badge";
import { Breadcrumb } from "kui/breadcrumb";
import { Button } from "kui/button";
import { Calendar } from "kui/calendar";
import { Card } from "kui/card";
import { Carousel } from "kui/carousel";
import { Chart } from "kui/chart";
import { Checkbox } from "kui/checkbox";
import { Collapsible } from "kui/collapsible";
import { Command } from "kui/command";
import { ContextMenu } from "kui/context-menu";
import { Dialog } from "kui/dialog";
import { Drawer } from "kui/drawer";
import { DropdownMenu } from "kui/dropdown-menu";
import { Form } from "kui/form";
import { HoverCard } from "kui/hover-card";
import { Input } from "kui/input";
import { InputOTP } from "kui/input-otp";
import { Label } from "kui/label";
import { Menubar } from "kui/menubar";
import { NavigationMenu } from "kui/navigation-menu";
import { Pagination } from "kui/pagination";
import { Popover } from "kui/popover";
import { Progress } from "kui/progress";
import { RadioGroup } from "kui/radio-group";
import { Resizable } from "kui/resizable";
import { ScrollArea } from "kui/scroll-area";
import { Select } from "kui/select";
import { Separator } from "kui/separator";
import { Sheet } from "kui/sheet";
import { Sidebar } from "kui/sidebar";
import { Skeleton } from "kui/skeleton";
import { Slider } from "kui/slider";
import { Sonner } from "kui/sonner";
import { Switch } from "kui/switch";
import { Table } from "kui/table";
import { Tabs } from "kui/tabs";
import { Textarea } from "kui/textarea";
import { Toggle } from "kui/toggle";
import { ToggleGroup } from "kui/toggle-group";
import { Tooltip } from "kui/tooltip";
```

## Next.js Configuration

Add to your `next.config.mjs` to properly transpile the package:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["kui"],
};

export default nextConfig;
```

## Tailwind Configuration

Extend your `tailwind.config.ts` to include kui components:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/kui/src/**/*.{js,ts,jsx,tsx}", // Add this line
  ],
  // ... rest of your config
};

export default config;
```

## Dark Mode

kui supports dark mode out of the box. Make sure your app wraps content with a dark mode provider:

```tsx
import { ThemeProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
```

## Architecture

- **No Build Step**: Components are pure TypeScript files consumed directly
- **Tree-shaking**: Each component is exported individually via package.json subpath exports
- **Type Safety**: Full TypeScript with strict mode enabled
- **CSS Variables**: Theming through CSS custom properties
- **Radix UI**: Built on accessible, unstyled primitives

## Why No Build Step?

This library is designed to be consumed by Next.js/webpack bundlers that can:
- Compile TypeScript on-the-fly
- Tree-shake unused exports
- Apply proper optimizations during the app build

This approach:
- ✅ Simplifies the development workflow
- ✅ Ensures consumers get the latest changes immediately in monorepo setups
- ✅ Lets the consuming app's bundler apply its optimizations
- ✅ Eliminates dual package hazards

## Development

```bash
# Lint
pnpm lint

# Add new component
npx shadcn@latest add [component-name]

# Remember to add the new component to package.json exports!
```

## License

ISC
