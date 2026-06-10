import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Inbox, type LucideIcon } from "lucide-react";
import { EASE_OUT } from "@/components/motion";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted"
      >
        <Icon className="size-7 text-muted-foreground" />
      </motion.div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
