import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { FileText } from "lucide-react";
import { useFiles } from "@/api/queries/system";
import { useAuthStore } from "@/auth/store";
import { Textarea } from "@/components/ui/textarea";
import { bytes } from "@/lib/format";
import { mentionAt, matchFiles } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import type { FileMeta } from "@/api/models";

interface MentionTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Class for the relative wrapper (the textarea itself takes `className`). */
  containerClassName?: string;
  /** Where the suggestion list opens relative to the textarea. */
  menuPlacement?: "top" | "bottom";
  /** Fires when the suggestion menu opens/closes. Inside a Radix Dialog, use
   *  this to `preventDefault()` the dialog's `onEscapeKeyDown` while open —
   *  Radix's document-capture Escape listener runs before ours. */
  onMenuOpenChange?: (open: boolean) => void;
}

/**
 * Textarea with `@file` autocomplete over the uploaded files (Files page).
 * Selecting a suggestion inserts `@<name>` — the sanitized display name the
 * kernel resolves via `user-file-reader` / @mention matching.
 */
export function MentionTextarea({
  value,
  onValueChange,
  containerClassName,
  menuPlacement = "top",
  onMenuOpenChange,
  onKeyDown,
  onSelect,
  onBlur,
  ...props
}: MentionTextareaProps) {
  const canReadFiles = useAuthStore((s) => s.can("files:r"));
  const files = useFiles(canReadFiles);
  const listboxId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(
    () => (mention ? matchFiles(files.data?.items ?? [], mention.query) : []),
    [mention, files.data],
  );
  const open = mention != null && matches.length > 0;

  useEffect(() => setActive(0), [mention?.query, matches.length]);
  useEffect(() => {
    onMenuOpenChange?.(open);
  }, [open, onMenuOpenChange]);

  // Restore the caret after a programmatic insert (controlled value update).
  useLayoutEffect(() => {
    if (pendingCaret.current != null && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  // Keep the mention in sync with the rendered value — also covers external
  // resets (e.g. chat clearing the composer on send), so a stale mention can
  // never point past the end of the new text.
  useEffect(() => {
    const caret = Math.min(ref.current?.selectionStart ?? value.length, value.length);
    const next = mentionAt(value, caret);
    setMention((prev) =>
      prev?.start === next?.start && prev?.query === next?.query ? prev : next,
    );
  }, [value]);

  function syncMention() {
    const el = ref.current;
    if (!el) return;
    setMention(mentionAt(el.value, el.selectionStart ?? el.value.length));
  }

  function pick(file: FileMeta) {
    if (!mention || mention.start > value.length) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const inserted = `@${file.name} `;
    pendingCaret.current = mention.start + inserted.length;
    onValueChange(value.slice(0, mention.start) + inserted + value.slice(caret));
    setMention(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An IME commit also fires Enter — never treat it as pick/send.
    if (e.nativeEvent.isComposing) {
      onKeyDown?.(e);
      return;
    }
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <Textarea
        {...props}
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={(e) => {
          onSelect?.(e);
          syncMention();
        }}
        onBlur={(e) => {
          onBlur?.(e);
          setMention(null);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-opt-${active}` : undefined}
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Uploaded files"
          className={cn(
            "absolute inset-x-0 z-50 max-h-56 overflow-y-auto rounded-md border border-border bg-card text-card-foreground shadow-md",
            menuPlacement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {matches.map((f, i) => (
            <button
              key={f.id}
              id={`${listboxId}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              // preventDefault so the textarea keeps focus (blur would close the list).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(f)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                i === active && "bg-muted",
              )}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">@{f.name}</span>
              {f.original_name && f.original_name !== f.name && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {f.original_name}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{bytes(f.size)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
