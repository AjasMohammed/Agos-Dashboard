import { useCallback } from "react";
import { useBlocker } from "@tanstack/react-router";
import { confirm } from "@/lib/confirm";

const DISCARD: Parameters<typeof confirm>[0] = {
  title: "Discard unsaved changes?",
  description: "Your edits have not been saved. Leaving now loses them.",
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
  destructive: true,
};

/**
 * Guard an editor's unsaved work.
 *
 * Covers the two exits the router can see — an in-app navigation and a
 * reload/tab-close — and returns `confirmDiscard` for the ones it cannot: a
 * dialog closing, or an editor swapping to a different document while staying
 * on the same route. Every editor in the panel used to lose work on at least
 * one of those three paths, so the check lives here once rather than in each.
 *
 * `dirty` should be a comparison against the last loaded/saved content, not a
 * "touched" flag — typing a character and deleting it again is not dirty.
 */
export function useDirtyGuard(dirty: boolean) {
  // Stable identity: the blocker re-subscribes to `history.block` whenever this
  // changes, and an inline arrow changes on every render of the host — once per
  // drag frame in the graph editor. Nothing from the render is captured.
  const shouldBlockFn = useCallback(async () => !(await confirm(DISCARD)), []);
  // `enableBeforeUnload` is left at its default `true`: while `disabled` is true
  // there is no blocker registered at all, so the beforeunload prompt is already
  // gone — a `() => dirty` function form could not be any fresher.
  useBlocker({ disabled: !dirty, shouldBlockFn });

  /** Resolves true when it is safe to discard (not dirty, or the user agreed). */
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm(DISCARD);
  }, [dirty]);

  return { confirmDiscard };
}
