# Migrating to kui

Guide for migrating existing apps to use the centralized kui design system.

## For Apps Currently Using shadcn/ui

If your app already has shadcn/ui components in `src/components/ui/`, here's how to migrate:

### Step 1: Add kui dependency

```json
// package.json
{
  "dependencies": {
    "kui": "workspace:*"
  }
}
```

Run: `pnpm install`

### Step 2: Update Next.js config

```javascript
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["kui"],
  // ... other config
};

export default nextConfig;
```

### Step 3: Update Tailwind config

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/kui/src/**/*.{js,ts,jsx,tsx}", // Add this
  ],
  // ... rest of config
};

export default config;
```

### Step 4: Import kui styles

```tsx
// app/layout.tsx (or pages/_app.tsx)
import "kui/styles.css";
// ... rest of imports
```

### Step 5: Replace local imports

**Before:**
```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
```

**After:**
```tsx
import { Button } from "kui/button";
import { Card } from "kui/card";
import { Input } from "kui/input";
```

### Step 6: Update cn utility import

**Before:**
```tsx
import { cn } from "../../lib/utils";
```

**After:**
```tsx
import { cn } from "kui/utils";
```

### Step 7: Remove local components (optional)

Once you've migrated all imports, you can remove:
- `src/components/ui/` directory
- `src/lib/utils.ts` (if only contains cn function)

Keep local `components.json` if you want to add custom components later.

## Automated Migration Script

You can use this find-and-replace pattern:

```bash
# In your app directory

# Replace Button imports (repeat for each component)
find ./src -type f -name "*.tsx" -o -name "*.ts" | xargs sed -i '' 's|from "@/components/ui/button"|from "kui/button"|g'

# Replace utils import
find ./src -type f -name "*.tsx" -o -name "*.ts" | xargs sed -i '' 's|from "../../lib/utils"|from "kui/utils"|g'
```

Or use VS Code's global find and replace:
1. Open Find in Files (Cmd+Shift+F)
2. Find: `from "@/components/ui/([^"]+)"`
3. Replace: `from "kui/$1"`
4. Enable regex mode
5. Replace All

## For New Apps

### Step 1: Install dependencies

```json
{
  "dependencies": {
    "kui": "workspace:*",
    "next-themes": "^0.4.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### Step 2: Configure Next.js

```javascript
// next.config.mjs
const nextConfig = {
  transpilePackages: ["kui"],
};

export default nextConfig;
```

### Step 3: Configure Tailwind

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/kui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

### Step 4: Set up root layout

```tsx
// app/layout.tsx
import "kui/styles.css";
import { ThemeProvider } from "next-themes";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My App",
  description: "Built with kui",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### Step 5: Start using components

```tsx
// app/page.tsx
import { Button } from "kui/button";
import { Card } from "kui/card";

export default function Home() {
  return (
    <main className="container mx-auto p-8">
      <Card className="p-6">
        <h1 className="text-2xl font-bold mb-4">Welcome</h1>
        <Button>Get Started</Button>
      </Card>
    </main>
  );
}
```

## Common Issues

### Issue: "Module not found: kui/button"

**Solution**: Make sure you've:
1. Added `"kui": "workspace:*"` to dependencies
2. Run `pnpm install`
3. Added `transpilePackages: ["kui"]` to next.config.mjs

### Issue: Styles not applying

**Solution**: 
1. Import `kui/styles.css` in your root layout
2. Add kui path to Tailwind content: `../../packages/kui/src/**/*.{js,ts,jsx,tsx}`
3. Restart dev server

### Issue: TypeScript errors

**Solution**:
1. Ensure tsconfig.json has proper module resolution
2. Restart TypeScript server in VS Code (Cmd+Shift+P → "TypeScript: Restart TS Server")
3. Check that kui's tsconfig.json exists and is valid

### Issue: Dark mode not working

**Solution**:
1. Wrap app with `ThemeProvider` from `next-themes`
2. Add `suppressHydrationWarning` to `<html>` tag
3. Make sure `darkMode: "class"` is in Tailwind config

## Component Mapping

All shadcn/ui components are available in kui:

| Local Path               | kui Import              |
| ------------------------ | ----------------------- |
| `@/components/ui/button` | `kui/button` |
| `@/components/ui/input`  | `kui/input`  |
| `@/components/ui/card`   | `kui/card`   |
| `@/lib/utils`            | `kui/utils`  |

See `SETUP_SUMMARY.md` for complete list of 45+ components.

## Benefits After Migration

✅ **Consistency**: All apps share the same design system  
✅ **Maintainability**: Update once, affects all apps  
✅ **Tree-shaking**: Import only what you need  
✅ **Type-safe**: Full TypeScript support  
✅ **Smaller apps**: No duplicate component code  
✅ **Faster development**: Reuse tested components  

## Rollback Plan

If you need to rollback:

1. Keep your local `src/components/ui/` directory
2. Revert imports back to `@/components/ui/...`
3. Remove kui from dependencies

The migration is non-destructive - you can keep both approaches running in parallel during transition.

## Support

For issues or questions:
1. Check `packages/kui/README.md` for documentation
2. See `packages/kui/EXAMPLES.md` for usage examples
3. Review `packages/kui/SETUP_SUMMARY.md` for complete setup guide

Happy migrating! 🚀
