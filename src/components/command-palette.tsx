import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Search } from "lucide-react";
import { NAV } from "@/app/nav";
import { useAuthStore } from "@/auth/store";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Command {
  label: string;
  to: string;
  group: string;
}

/**
 * Cmd/Ctrl-K jump-to. Every route stays reachable by name regardless of which
 * sidebar groups are folded.
 *
 * ponytail: a filtered list over the nav, no `cmdk` dependency — substring
 * match is enough for ~35 destinations.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listboxId = useId();
  const can = useAuthStore((s) => s.can);
  // Mounted at the root route, which also renders /login — there is nothing to
  // jump to before sign-in.
  const signedIn = useAuthStore((s) => Boolean(s.apiKey));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const openPalette = () => setOpen(true);
    window.addEventListener("agentos:command-palette", openPalette);
    return () => window.removeEventListener("agentos:command-palette", openPalette);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(
    () => [
      // Same scope gate the nav entries get — a key without chat:r would only
      // be bounced to the dashboard.
      ...(can("chat:r") ? [{ label: "New chat", to: "/", group: "Actions" }] : []),
      { label: "Set up an assistant", to: "/welcome", group: "Actions" },
      ...NAV.flatMap((g) =>
        g.items
          .filter((i) => !i.scope || can(i.scope))
          .map((i) => ({ label: i.label, to: i.to, group: g.label })),
      ),
    ],
    [can],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return hits.slice(0, 12);
  }, [commands, query]);

  // Keep the highlighted option visible: the list caps its height but shows up
  // to 12 results, so arrowing to the last few would move the highlight (and
  // aria-activedescendant) off-screen. `block: "nearest"` scrolls only when needed.
  useEffect(() => {
    if (matches.length === 0) return;
    document.getElementById(`${listboxId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listboxId, matches]);

  function run(cmd: Command | undefined) {
    if (!cmd) return;
    setOpen(false);
    // Section routes are registered dynamically from NAV, so the router's
    // static type union doesn't know them.
    void navigate({ to: cmd.to as string });
  }

  if (!signedIn) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter pages, then press Enter to jump.
        </DialogDescription>
        <div className="flex items-center gap-2.5 border-b border-border px-3">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(matches[active]);
              }
            }}
            placeholder="Go to page or action…"
            spellCheck={false}
            autoComplete="off"
            // Combobox semantics mirroring mention-textarea.tsx: without them a
            // screen reader announces a plain text field and never reads the
            // highlighted result. pr-8 keeps the text clear of the close button.
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            aria-controls={matches.length > 0 ? listboxId : undefined}
            aria-activedescendant={matches.length > 0 ? `${listboxId}-opt-${active}` : undefined}
            className="h-11 w-full bg-transparent pr-8 text-sm outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <ul id={listboxId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-1.5">
          {matches.length === 0 && (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches
            </li>
          )}
          {matches.map((c, i) => (
            // The <li> is presentational so the listbox's only children are options.
            <li role="presentation" key={`${c.group}-${c.to}-${c.label}`}>
              <button
                type="button"
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-100",
                  i === active ? "bg-accent text-foreground" : "text-foreground/90",
                )}
              >
                <span className="truncate">{c.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {c.group}
                  {i === active && <CornerDownLeft aria-hidden className="size-3.5" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
