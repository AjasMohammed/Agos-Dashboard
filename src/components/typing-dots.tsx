import { motion } from "framer-motion";

/** Bouncing dots for a reply that has started but has no text yet. */
export function TypingDots({
  label = "Thinking…",
  srLabel = "Assistant is typing",
}: {
  label?: string;
  srLabel?: string;
}) {
  return (
    // role="status" — an aria-label on a bare <span> has no role to hang off, so
    // assistive tech never announced that a reply had started.
    <span role="status" className="flex items-center gap-1.5 py-1" aria-label={srLabel}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
