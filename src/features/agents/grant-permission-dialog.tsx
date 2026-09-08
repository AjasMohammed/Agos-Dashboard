import { useMemo, useState, type FormEvent } from "react";
import { Plus, Search } from "lucide-react";
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
import { toastError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  PERMISSION_BITS,
  grantedBits,
  groupCatalog,
  isGranted,
  missingBits,
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
          <DialogTitle>Grant a permission</DialogTitle>
          <DialogDescription>
            Pick a resource {name} needs, then choose which operations it may perform on it.
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

  const permission = resource.trim() && bits ? `${resource.trim()}:${bits}` : "";
  const alreadyHeld = !!permission && isGranted(held, resource.trim(), bits);
  const loading = tools.isLoading || roles.isLoading;

  const selected = catalog.find((e) => e.resource === resource.trim());

  function select(entry: CatalogEntry) {
    setResource(entry.resource);
    setBits(entry.bits);
  }

  function toggleBit(bit: string) {
    setBits((b) => sortBits(b.includes(bit) ? b.replace(bit, "") : b + bit));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!permission || grant.isPending) return;
    try {
      await grant.mutateAsync(permission);
      toast.success(`Granted ${permission}`);
      onDone();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="perm-filter">
          Available resources
          {!loading && shown.length > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">({shown.length})</span>
          )}
        </Label>
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
                      <button
                        type="button"
                        onClick={() => select(e)}
                        aria-pressed={resource === e.resource}
                        title={`${resourceHint(e.resource)}\n${sourceLabel(e)}`}
                        className={cn(
                          "w-full border-b border-border px-3 py-1.5 text-left last:border-b-0 hover:bg-muted/60",
                          resource === e.resource && "bg-muted",
                        )}
                      >
                        <span className="flex items-baseline gap-2">
                          <code className="shrink-0 text-sm">{e.resource}</code>
                          <Badge variant="muted" className="shrink-0">
                            {e.bits}
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
                      </button>
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

      <Field
        label="Resource"
        hint="Editable — a path prefix like fs:/data/ grants everything under it."
      >
        <Input
          value={resource}
          onChange={(e) => setResource(e.target.value)}
          placeholder="fs.user_data"
        />
      </Field>

      {selected && (
        <Callout tone="muted" title={resourceHint(selected.resource) || selected.resource}>
          {sourceLabel(selected) && <p>{sourceLabel(selected)}.</p>}
        </Callout>
      )}

      <div className="grid gap-1.5">
        <Label>Operations</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PERMISSION_BITS.map((b) => {
            const alreadyOn = (held.get(resource.trim()) ?? "").includes(b.bit);
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
        {permission ? (
          <>
            Grants <code className="text-foreground">{permission}</code>
            {alreadyHeld && " — already held; granting again changes nothing."}
          </>
        ) : (
          "Pick a resource and at least one operation."
        )}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!permission || alreadyHeld || grant.isPending}>
          {grant.isPending ? "Granting…" : "Grant"}
        </Button>
      </DialogFooter>
    </form>
  );
}
