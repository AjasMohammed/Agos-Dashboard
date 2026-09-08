import * as React from "react";
import { controlClass } from "./input";
import { cn } from "@/lib/utils";

/**
 * Styled native select — sufficient for the panel's short, static option lists,
 * and it keeps keyboard/mobile behaviour the OS already gets right. The chevron
 * is a CSS background (`.select-chevron`) so the element stays a plain
 * `<select>` that accepts width classes directly.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(controlClass, "select-chevron h-8 cursor-pointer appearance-none pl-2.5 pr-8", className)}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
