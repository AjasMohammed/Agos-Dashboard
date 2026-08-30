import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-follow that a reader can win. Chat used to `scrollIntoView` on every
 * streamed chunk, which yanked the view back down the moment you scrolled up to
 * re-read something. Here, new content only scrolls the viewport while the
 * reader is already parked at the bottom.
 */

/** Distance from the bottom (px) still counted as "at the bottom". */
export const PIN_THRESHOLD = 64;

export function isPinned(
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = PIN_THRESHOLD,
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

export function useStickToBottom() {
  const viewportRef = useRef<HTMLDivElement>(null);
  /** The growing content INSIDE the viewport — what actually changes height. */
  const contentRef = useRef<HTMLDivElement>(null);
  // A ref, not state: `stick()` must stay referentially stable so the effect
  // that calls it fires on new content, not on every scroll event.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pinned = isPinned(el);
    pinnedRef.current = pinned;
    setShowJump((cur) => (cur === !pinned ? cur : !pinned));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  /** Follow new content — but only if the reader hasn't scrolled away. */
  const stick = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (pinnedRef.current) scrollToBottom(behavior);
    },
    [scrollToBottom],
  );

  // Re-stick on the CONTENT's measured height, not on a query's data. Sticking
  // in the render that data arrives measured the wrong thing: the transcript is
  // swapped in behind `AnimatePresence mode="wait"`, so the skeleton was still
  // the only box in the viewport and the view only jumped once the next token
  // landed. The observer also covers what React can't see at all — images and
  // tables that resize after paint.
  useEffect(() => {
    const el = contentRef.current;
    // jsdom (unit tests) has no ResizeObserver; auto-follow is a browser affordance.
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => stick());
    ro.observe(el);
    return () => ro.disconnect();
  }, [stick]);

  return { viewportRef, contentRef, onScroll, showJump, scrollToBottom, stick };
}
