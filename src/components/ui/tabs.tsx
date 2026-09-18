import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "@/components/motion";

/**
 * The active value, mirrored out of Radix so `TabsTrigger` can render the
 * sliding indicator for the active tab *only*. Framer needs exactly one mounted
 * element per `layoutId` to animate between positions; one indicator per
 * trigger (toggled with CSS) would be several elements sharing an id.
 */
const ActiveValue = React.createContext<string | undefined>(undefined);
/** One `layoutId` per list, so two tab rows on a page don't slide into each other. */
const IndicatorId = React.createContext<string | null>(null);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) {
  // Mirrors the uncontrolled case; ignored when `value` is supplied.
  const [internal, setInternal] = React.useState(defaultValue);
  return (
    <ActiveValue.Provider value={value ?? internal}>
      <TabsPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => {
          setInternal(v);
          onValueChange?.(v);
        }}
        {...props}
      />
    </ActiveValue.Provider>
  );
}

/** Underline tabs — the row reads as part of the page, not a pill widget. */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const id = React.useId();
  return (
    <IndicatorId.Provider value={id}>
      <TabsPrimitive.List
        ref={ref}
        // Scrolls sideways rather than wrapping on a phone: a wrapped row would
        // strand an active underline mid-block instead of on the list's own
        // bottom border. Scrollbars are already slim (index.css) and
        // `SegmentedControl` handles the same overflow the same way.
        //
        // Height comes from the triggers, deliberately: `h-9` here would be 36px
        // *including* the 1px border, leaving a 35px content box that a 36px
        // trigger overflows — and `overflow-x-auto` computes `overflow-y` to
        // `auto`, so that 1px would clip the indicator and can raise a stray
        // vertical scrollbar.
        className={cn("flex items-center gap-1 overflow-x-auto border-b border-border", className)}
        {...props}
      />
    </IndicatorId.Provider>
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    /** Row count for this tab, shown as a chip (same markup as `SectionHeader`). */
    count?: number;
  }
>(({ className, count, children, ...props }, ref) => {
  const layoutId = React.useContext(IndicatorId);
  const active = React.useContext(ActiveValue) === props.value;
  // Rendered outside a `Tabs` (a bare Radix root, a story, an isolated test)
  // there is no context to read the active value from, so the sliding indicator
  // cannot mount. Fall back to a CSS-only underline there rather than shipping a
  // trigger row with no active marker at all.
  const standalone = layoutId === null;
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        // The indicator is an absolutely positioned child rather than a `-mb-px`
        // bottom border, so nothing sticks out past the list's box to be clipped
        // by its horizontal scroll.
        "relative inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground",
        standalone && "data-[state=active]:shadow-[inset_0_-2px_0_hsl(var(--primary))]",
        className,
      )}
      {...props}
    >
      {children}
      {count != null && (
        <span className="tnum rounded-sm bg-muted px-1.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      )}
      {active && (
        // `<MotionConfig reducedMotion="user">` in src/main.tsx turns the slide
        // into a plain jump for anyone who asked for less motion.
        <motion.span
          aria-hidden
          layoutId={layoutId ?? undefined}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
        />
      )}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    // No entrance animation: "page content just appears" (docs/design-system.md
    // principle 6). The sliding indicator carries the state change; the panes
    // below it would also double-fade against `QueryState`'s own phase fade.
    className={cn("mt-4 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
