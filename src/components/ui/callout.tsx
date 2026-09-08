import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "success" | "warning" | "danger" | "muted";

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: "border-info/30 bg-info/[0.07]", icon: "text-info", Icon: Info },
  success: { box: "border-success/30 bg-success/[0.07]", icon: "text-success", Icon: CheckCircle2 },
  warning: { box: "border-warning/35 bg-warning/[0.08]", icon: "text-warning", Icon: AlertTriangle },
  danger: {
    box: "border-destructive/35 bg-destructive/[0.07]",
    icon: "text-destructive",
    Icon: OctagonAlert,
  },
  muted: { box: "border-border bg-muted/50", icon: "text-muted-foreground", Icon: Info },
};

/** Inline notice. One shape for every warning/error/info banner in the panel. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  actions,
  className,
  role,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Override the tone's default icon; pass `null` to hide it. */
  icon?: LucideIcon | null;
  actions?: ReactNode;
  className?: string;
  /** `alert` for errors that appear after an action; `status` for passive notices. */
  role?: "alert" | "status";
}) {
  const t = TONE[tone];
  const Icon = icon === undefined ? t.Icon : icon;
  return (
    <div
      role={role}
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", t.box, className)}
    >
      {Icon && <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.icon)} />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && (
          <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}
