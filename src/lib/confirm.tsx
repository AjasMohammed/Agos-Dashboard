import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Present → the dialog asks for a line of text and resolves with it. */
  input?: { defaultValue?: string; placeholder?: string; label?: string };
}

type Settled = boolean | string | null;

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: Settled) => void) | null;
  request: (options: ConfirmOptions) => Promise<Settled>;
  settle: (value: Settled) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  request: (options) =>
    new Promise<Settled>((resolve) => {
      // If a dialog is already pending, settle it false so its promise never hangs.
      get().resolve?.(options.input ? null : false);
      set({ open: true, options, resolve });
    }),
  settle: (value) => {
    get().resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

/**
 * Imperatively ask the user to confirm a (usually destructive) action.
 * Resolves `true` on confirm, `false` on cancel/dismiss. Requires
 * {@link ConfirmDialog} to be mounted once near the app root.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function confirm(options: Omit<ConfirmOptions, "input">): Promise<boolean> {
  return useConfirmStore.getState().request(options).then((v) => v === true);
}

/**
 * Ask for a single line of text in the same dialog chrome as {@link confirm}
 * (replaces `window.prompt`). Resolves with the trimmed text, or `null` on cancel.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function promptText(
  options: Omit<ConfirmOptions, "input"> & { input?: ConfirmOptions["input"] },
): Promise<string | null> {
  return useConfirmStore
    .getState()
    .request({ ...options, input: options.input ?? {} })
    .then((v) => (typeof v === "string" ? v : null));
}

export function ConfirmDialog() {
  const { open, options, settle } = useConfirmStore();
  const [value, setValue] = useState("");
  const isPrompt = Boolean(options?.input);
  useEffect(() => {
    if (open) setValue(options?.input?.defaultValue ?? "");
  }, [open, options]);
  const cancel = () => settle(isPrompt ? null : false);
  const ok = () => settle(isPrompt ? value.trim() : true);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus:outline-none">
          <Dialog.Title className="text-lg font-semibold">{options?.title}</Dialog.Title>
          {/* Always render a description: Radix warns (a11y) when a dialog has none. */}
          <Dialog.Description
            className={options?.description ? "mt-2 text-sm text-muted-foreground" : "sr-only"}
          >
            {options?.description ?? (isPrompt ? "Enter a value." : "This action requires confirmation.")}
          </Dialog.Description>
          {isPrompt && (
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                ok();
              }}
            >
              <Input
                autoFocus
                aria-label={options?.input?.label ?? options?.title}
                value={value}
                placeholder={options?.input?.placeholder}
                onChange={(e) => setValue(e.target.value)}
              />
            </form>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={cancel}>
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={options?.destructive ? "destructive" : "default"} onClick={ok}>
              {options?.confirmLabel ?? (isPrompt ? "Save" : "Confirm")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
