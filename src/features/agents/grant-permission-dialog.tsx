import { useMemo, useState, type FormEvent } from "react";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useGrantPermission } from "@/api/queries/agents";
import { useRoles } from "@/api/queries/governance";
import { useTools } from "@/api/queries/tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  PERMISSION_BITS,
  grantedBits,
  groupCatalog,
  isGranted,
  missingBits,
  parsePermission,
  permissionCatalog,
  resourceHint,
  sortBits,
  type CatalogEntry,
} from "./permission-catalog";

/**
 * "What can I even grant?" — the kernel takes a free-form `resource:BITS`
 * string, so the catalog is derived from live data: the resources installed
 * tools declare in `[capabilities_required]` and the ones roles bundle. The
 * resource field stays editable, because path-scoped grants (`fs:/data/`)
 * are legal and no manifest declares them.
 *
 * Grants are staged as a set and submitted together: setting up an agent means
 * handing it a dozen resources at once, and the API's one-permission-per-POST
 * shape is no reason to make the operator reopen this dialog a dozen times.
 */
export function GrantPermissionDialog({ name, granted }: { name: string; granted: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> Grant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Grant permissions</DialogTitle>
          <DialogDescription>
            Tick every resource {name} needs, then adjust which operations it may perform on each.
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts a closed dialog, so the catalog is only fetched on open. */}
        <GrantForm name={name} granted={granted} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** "needed by shell, notes · role analyst" — why this resource exists. */
function sourceLabel(e: CatalogEntry): string {
  return [
    e.tools.length > 0 && `needed by ${e.tools.join(", ")}`,
    e.roles.length > 0 && `role ${e.roles.join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function GrantForm({
  name,
  granted,
  onDone,
}: {
  name: string;
  granted: string[];
  onDone: () => void;
}) {
  const tools = useTools();
  const roles = useRoles();
  const grant = useGrantPermission(name);
  const [filter, setFilter] = useState("");
  const [resource, setResource] = useState("");
  const [bits, setBits] = useState("");
  /** Staged grants, resource -> bits. Insertion order is the display order. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());

  const held = useMemo(() => grantedBits(granted), [granted]);
  const catalog = useMemo(
    () => permissionCatalog(tools.data ?? [], roles.data ?? []),
    [tools.data, roles.data],
  );
  // What is already granted is not offered again: each entry carries only the
  // bits the agent is still missing, and a fully-granted resource drops out.
  const offered = useMemo(
    () =>
      catalog
        .map((e) => ({ ...e, bits: missingBits(held, e.resource, e.bits) }))
        .filter((e) => e.bits !== ""),
    [catalog, held],
  );
  const hidden = catalog.length - offered.length;

  const q = filter.trim().toLowerCase();
  const shown = q
    ? offered.filter(
        (e) =>
          e.resource.toLowerCase().includes(q) ||
          e.tools.some((t) => t.toLowerCase().includes(q)) ||
          e.roles.some((r) => r.toLowerCase().includes(q)),
      )
    : offered;
  const groups = useMemo(() => groupCatalog(shown), [shown]);

  // The resource field doubles as the editor for whichever staged row is active.
  const active = resource.trim();
  const alreadyHeld = !!bits && isGranted(held, active, bits);
  const stagedBits = staged.get(active);
  const loading = tools.isLoading || roles.isLoading;

  const selected = catalog.find((e) => e.resource === active);
  const permissions = useMemo(() => [...staged].map(([r, b]) => `${r}:${b}`), [staged]);

  /** Stage `resource:bits`, or drop the row when `bits` is empty. */
  function stage(res: string, next: string) {
    setStaged((m) => {
      const copy = new Map(m);
      if (next) copy.set(res, next);
      else copy.delete(res);
      return copy;
    });
  }

  function toggleRow(entry: CatalogEntry) {
    if (staged.has(entry.resource)) {
      stage(entry.resource, "");
      return;
    }
    stage(entry.resource, entry.bits);
    // Ticking a row also makes it the one the Operations checkboxes edit.
    setResource(entry.resource);
    setBits(entry.bits);
  }

  function toggleBit(bit: string) {
    const next = sortBits(bits.includes(bit) ? bits.replace(bit, "") : bits + bit);
    setBits(next);
    // Editing operations writes through to an already-staged row, so trimming
    // `rw` down to `r` needs no second "update" step.
    if (staged.has(active)) stage(active, next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (permissions.length === 0 || grant.isPending) return;
    try {
      const { granted: ok, failed } = await grant.mutateAsync(permissions);
      if (ok.length > 0) {
        toast.success(
          ok.length === 1 ? `Granted ${ok[0]}` : `Granted ${ok.length} permissions to ${name}`,
        );
      }
      if (failed.length === 0) {
        onDone();
        return;
      }
      // Keep the dialog open with only the failures staged, so a retry does not
      // re-send what already landed.
      setStaged(
        new Map(
          failed.flatMap((f) => {
            const parsed = parsePermission(f.permission);
            return parsed ? [[parsed.resource, parsed.bits] as [string, string]] : [];
          }),
        ),
      );
      toast.error(`${failed.length} of ${permissions.length} grants failed`, {
        description: `${failed[0].permission}: ${errorMessage(failed[0].error)}`,
      });
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="perm-filter">
            Available resources
            {!loading && shown.length > 0 && (
              <span className="ml-1 font-normal text-muted-foreground">({shown.length})</span>
            )}
          </Label>
          {!loading && shown.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                shown.forEach((e) => !staged.has(e.resource) && stage(e.resource, e.bits))
              }
            >
              Select all{q && " shown"}
            </Button>
          )}
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="perm-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by resource, tool or role…"
            className="pl-8"
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : groups.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {offered.length === 0
                ? `${name} already holds every catalogued permission. Type a resource below to grant something else — e.g. fs:/data/ for a path-scoped grant.`
                : "No resource matches that filter."}
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.group}>
                <h4 className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {g.group}
                </h4>
                <ul>
                  {g.entries.map((e) => (
                    <li key={e.resource}>
                      <label
                        title={`${resourceHint(e.resource)}\n${sourceLabel(e)}`}
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-2 border-b border-border px-3 py-1.5 text-left last:border-b-0 hover:bg-muted/60",
                          active === e.resource && "bg-muted",
                        )}
                      >
                        <Checkbox
                          className="mt-1"
                          checked={staged.has(e.resource)}
                          onChange={() => toggleRow(e)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <code className="shrink-0 text-sm">{e.resource}</code>
                            <Badge variant="muted" className="shrink-0">
                              {staged.get(e.resource) ?? e.bits}
                            </Badge>
                            {held.has(e.resource) && (
                              <Badge
                                variant="info"
                                className="shrink-0"
                                title="Some bits already granted"
                              >
                                partial
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {resourceHint(e.resource)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            {hidden} already granted {hidden === 1 ? "resource is" : "resources are"} hidden.
          </p>
        )}
      </div>

      {staged.size > 0 && (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label>Staged ({staged.size})</Label>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStaged(new Map())}>
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...staged].map(([res, b]) => (
              <Badge
                key={res}
                variant={active === res ? "default" : "outline"}
                className="gap-0.5 pr-0.5"
              >
                <button
                  type="button"
                  className="font-mono"
                  title="Edit which operations this grant covers"
                  onClick={() => {
                    setResource(res);
                    setBits(b);
                  }}
                >
                  {res}:{b}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${res}`}
                  className="rounded-sm p-0.5 hover:bg-foreground/10"
                  onClick={() => stage(res, "")}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Field
        label="Resource"
        hint="Editable — a path prefix like fs:/data/ grants everything under it."
      >
        <div className="flex gap-2">
          <Input
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            placeholder="fs.user_data"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!active || !bits || stagedBits === bits}
            onClick={() => stage(active, bits)}
          >
            {staged.has(active) ? "Update" : "Add"}
          </Button>
        </div>
      </Field>

      {selected && (
        <Callout tone="muted" title={resourceHint(selected.resource) || selected.resource}>
          {sourceLabel(selected) && <p>{sourceLabel(selected)}.</p>}
        </Callout>
      )}

      <div className="grid gap-1.5">
        <Label>
          Operations
          {active && <span className="ml-1 font-normal text-muted-foreground">for {active}</span>}
        </Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PERMISSION_BITS.map((b) => {
            const alreadyOn = (held.get(active) ?? "").includes(b.bit);
            return (
              <label key={b.bit} className="flex items-center gap-2 text-sm" title={b.hint}>
                <Checkbox checked={bits.includes(b.bit)} onChange={() => toggleBit(b.bit)} />
                {b.label} <code className="text-xs text-muted-foreground">{b.bit}</code>
                {alreadyOn && <span className="text-xs text-muted-foreground">· held</span>}
              </label>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {staged.size === 0
          ? "Tick a resource above, or type one and pick at least one operation."
          : alreadyHeld && stagedBits === bits
            ? `${name} already holds ${active}:${bits} — granting it again changes nothing.`
            : `Grants ${staged.size} permission${staged.size === 1 ? "" : "s"}.`}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={staged.size === 0 || grant.isPending}>
          {grant.isPending
            ? `Granting ${staged.size}…`
            : staged.size > 1
              ? `Grant ${staged.size}`
              : "Grant"}
        </Button>
      </DialogFooter>
    </form>
  );
}
