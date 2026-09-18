import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useAgentScratchPage,
  useAgentScratchpad,
  useDeleteAgentScratchPage,
  useSaveAgentScratchPage,
} from "@/api/queries/agents";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { When } from "@/components/when";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { confirm } from "@/lib/confirm";
import { toastError } from "@/lib/errors";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { cn } from "@/lib/utils";

/** Agent-scoped scratchpad: list, edit, delete pages owned by this agent. */
export function AgentScratchpadCard({ name }: { name: string }) {
  const list = useAgentScratchpad(name);
  const [page, setPage] = useState<string | null>(null);
  const detail = useAgentScratchPage(name, page);
  const save = useSaveAgentScratchPage(name);
  const del = useDeleteAgentScratchPage(name);
  const [content, setContent] = useState("");
  // The text the server last confirmed for this page. Unlike the scratchpad
  // dialog, this editor stays open after a save — and the save invalidates the
  // very query it renders from. Without a baseline to compare against, that
  // refetch silently replaces everything typed since with the server copy.
  //
  // State, not a ref: `dirty` and the `useBlocker` inside `useDirtyGuard` are
  // both derived from it, and a ref assignment renders nothing — so after a
  // save the blocker stayed armed and a fully-saved document still prompted
  // "Discard unsaved changes?" (and "Leave site?" on reload). Training people
  // to click through a false prompt is how they click through the true one.
  const [baseline, setBaseline] = useState<string | null>(null);
  const dirty = baseline != null && content !== baseline;
  const { confirmDiscard } = useDirtyGuard(dirty);

  // A different page is a different document: clear the baseline so the sync
  // below treats the incoming content as a first load rather than a remote edit.
  useEffect(() => {
    setBaseline(null);
    setContent("");
  }, [page]);

  useEffect(() => {
    const server = detail.data?.content;
    if (server == null) return;
    // Adopt the server copy on first load, and on a genuine remote edit — but
    // only while the editor is untouched, never over unsaved keystrokes.
    const remoteEdit = server !== baseline && content === baseline;
    if (baseline === null || remoteEdit) {
      setBaseline(server);
      setContent(server);
    }
    // Deliberately not keyed on `baseline`: a save sets it while the query it
    // invalidated still holds the *pre-save* copy, so re-running here would see
    // an untouched editor against a "different" server value and revert the
    // text that was just saved. Only new server data or new keystrokes should
    // re-evaluate; the closure already reads the latest baseline when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, content]);

  // Switching pages stays on the same route, so `useDirtyGuard`'s blocker never
  // sees it — ask here instead.
  async function selectPage(title: string) {
    if (title === page || !(await confirmDiscard())) return;
    setPage(title);
  }

  function onSave() {
    if (save.isPending || page == null) return;
    const sent = content;
    save
      .mutateAsync(
        { page, content: sent },
        {
          // Baseline what we sent, so the refetch this save triggers reads as
          // the same document. If the server normalised the body the next load
          // differs from the baseline and is adopted — but only if nothing was
          // typed since. In `onSuccess` rather than a `.then()` so clearing the
          // dirty guard does not ride on promise/network ordering.
          onSuccess: () => setBaseline(sent),
        },
      )
      .then(() => toast.success("Saved"))
      .catch(toastError);
  }

  return (
    <Card>
      <CardContent className="p-4">
        {/* Page list beside the editor from `md` up, stacked below it on a phone
            where a 220px column would leave no room to type.

            The editor is a SIBLING of `QueryState`, not inside it: `QueryState`
            keys its wrapper on the phase, so a failed refetch of the page *list*
            (the save above invalidates it) would unmount the editor and take the
            "Unsaved changes" notice with it, while `useDirtyGuard` stayed armed
            over text nobody could see any more. */}
        <div className="grid gap-4 md:grid-cols-[13.75rem_1fr]">
          <QueryState
            query={list}
            isEmpty={(d) => d.pages.length === 0}
            empty={
              <EmptyState
                compact
                title="No private pages"
                description={`${name} keeps its own working notes here.`}
              />
            }
          >
            {(data) => (
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto md:max-h-[28rem]">
                {data.pages.map((p) => {
                  const active = page === p.title;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-current={active}
                      onClick={() => void selectPage(p.title)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border hover:border-input",
                      )}
                    >
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <When iso={p.updated_at} />
                        {p.tags.length > 0 && (
                          <Badge variant="muted">
                            {p.tags.length} {p.tags.length === 1 ? "tag" : "tags"}
                          </Badge>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </QueryState>

          {page == null ? (
            // Only worth saying once there is something to pick.
            list.data?.pages.length ? (
              <EmptyState
                compact
                title="No page selected"
                description="Pick a page on the left to read or edit it."
              />
            ) : null
          ) : (
            <div className="min-w-0 space-y-2">
              {/* `isLoading`, never `isPending`: a disabled or paused query is
                  also pending, and gating the skeleton on that would shimmer
                  forever. Save stays disabled until the page loads. */}
              {detail.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  aria-label={`${page} contents`}
                  className="min-h-[16rem] font-mono text-xs"
                />
              )}
              <div className="flex items-center justify-end gap-2">
                {dirty && (
                  <span role="status" className="mr-auto text-xs text-warning">
                    Unsaved changes
                  </span>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={del.isPending}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Delete "${page}"?`,
                        description: `This page is removed from ${name}'s scratchpad.`,
                        destructive: true,
                        confirmLabel: "Delete",
                      }))
                    )
                      return;
                    del
                      .mutateAsync(page)
                      .then(() => {
                        toast.success("Deleted");
                        setPage(null);
                      })
                      .catch(toastError);
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" disabled={save.isPending || !detail.data} onClick={onSave}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
