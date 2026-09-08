import * as React from "react";
import { controlClass } from "./input";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlClass, "min-h-[72px] px-2.5 py-2 leading-5", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
