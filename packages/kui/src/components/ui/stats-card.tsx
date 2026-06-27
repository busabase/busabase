import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "./card";

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  variant?: "default" | "success" | "info" | "primary";
  className?: string;
}

const variantStyles = {
  default: {
    card: "border-border bg-gradient-to-br from-muted/30 to-background",
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
  },
  success: {
    card: "border-green-200 dark:border-green-900/50 bg-gradient-to-br from-green-50 to-background dark:from-green-950/30 dark:to-background",
    iconBg: "bg-green-100 dark:bg-green-900/50",
    iconColor: "text-green-600 dark:text-green-400",
  },
  info: {
    card: "border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-background dark:from-blue-950/30 dark:to-background",
    iconBg: "bg-blue-100 dark:bg-blue-900/50",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  primary: {
    card: "border-primary/20 bg-gradient-to-br from-primary/5 to-background",
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
  },
};

export function StatsCard({
  icon: Icon,
  label,
  value,
  variant = "default",
  className = "",
}: StatsCardProps) {
  const styles = variantStyles[variant];

  return (
    <Card
      className={`relative overflow-hidden hover:shadow-md transition-all duration-200 ${styles.card} ${className}`}
    >
      <CardContent className="p-5 flex items-center gap-4">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${styles.iconBg}`}
        >
          <Icon className={`h-6 w-6 ${styles.iconColor}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
          <div className="text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
