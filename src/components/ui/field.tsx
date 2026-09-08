import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint/error, wired for assistive tech. The single child
 * control receives `id`, `aria-describedby` and `aria-invalid` unless it
 * already sets them, so call sites stay one line:
 *
 *   <Field label="Name" hint="Lowercase, no spaces"><Input … /></Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // The error replaces the hint in the DOM, so only one of them is described.
  const describedBy = error ? errorId : hint ? hintId : "";
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        "aria-describedby":
          (children.props as { "aria-describedby"?: string })["aria-describedby"] ??
          (describedBy || undefined),
        "aria-invalid": error ? true : (children.props as { "aria-invalid"?: boolean })["aria-invalid"],
      })
    : children;
  const controlId = isValidElement(children) ? ((children.props as { id?: string }).id ?? id) : id;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={controlId}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
