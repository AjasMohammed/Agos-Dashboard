import { useEffect, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";

/** Shared ease-out curve for entrances (snappy start, soft landing). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Per-route entrance: subtle rise + fade. Keyed by pathname in the shell. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } },
};

/** Container that reveals its <StaggerItem> children one after another. */
export function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={staggerContainer} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}

/**
 * Count-up number driven by a spring, used by dashboard stat cards. Falls back
 * to plain text when the user prefers reduced motion.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const spring = useSpring(0, { stiffness: 90, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  if (reduced) return <span className={className}>{value.toLocaleString()}</span>;
  return <motion.span className={className}>{display}</motion.span>;
}
