import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  request: (options: ConfirmOptions) => Promise<boolean>;
  settle: (value: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  request: (options) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is already pending, settle it false so its promise never hangs.
      get().resolve?.(false);
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
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(options);
}

export function ConfirmDialog() {
  const { open, options, settle } = useConfirmStore();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg focus:outline-none">
          <Dialog.Title className="text-lg font-semibold">{options?.title}</Dialog.Title>
          {options?.description && (
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {options.description}
            </Dialog.Description>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => settle(false)}>
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={options?.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
