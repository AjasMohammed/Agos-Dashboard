import { cn } from "@/lib/utils";

/** An agent's profile picture, or its initial on a muted tile when none is set. */
export function AgentAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const base = "flex size-7 shrink-0 items-center justify-center rounded-md";
  if (src) {
    return <img src={src} alt="" aria-hidden className={cn(base, "object-cover", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        base,
        "bg-muted text-xs font-semibold uppercase text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
