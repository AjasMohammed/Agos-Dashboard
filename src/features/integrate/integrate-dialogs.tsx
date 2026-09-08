import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  useAttachMcp,
  useUpdateMcp,
  useMcpCatalog,
  useInstallMcp,
  useConnectChannel,
  useUpdateChannel,
  useSetChannelAgent,
  useInstallPlugin,
  useAddConnector,
  useUpdateConnector,
  useUpdatePlugin,
  useStoreConnectorCredential,
  useConnectors,
  useConnectorDetail,
  usePluginDetail,
} from "@/api/queries/extensibility";
import { useAgents } from "@/api/queries/agents";
import {
  buildAttachBody,
  buildConnectChannelBody,
  buildUpdateChannelBody,
  channelFieldsFor,
  channelFormFrom,
  mcpFormFrom,
  CHANNEL_KINDS,
  type ChannelFormState,
  type McpFormState,
} from "./integrate-helpers";
import type { ChannelSummary, McpServer } from "@/api/models";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toastError } from "@/lib/errors";
import { confirm } from "@/lib/confirm";

/**
 * Label + control, the shape every form row in these dialogs uses.
 *
 * The hint is wired with `aria-describedby` rather than left as a loose
 * paragraph: "leave blank to keep the stored one" is load-bearing here, and a
 * screen-reader user who never hears it would wipe a secret by tabbing past.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": hintId,
      })
    : children;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

const EMPTY_MCP: McpFormState = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  token: "",
  connectorId: "",
  env: "",
  timeout: "",
};

/**
 * Attach a tool server by hand — the UI twin of `agentos mcp attach`.
 *
 * Pass `edit` to reuse the same form as an editor: the dialog is then mounted
 * open by its caller and saves with a re-attach instead of an attach.
 */
export function AttachMcpDialog({
  edit,
  onClose,
}: { edit?: McpServer; onClose?: () => void } = {}) {
  const isEdit = edit != null;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<McpFormState>(() => (edit ? mcpFormFrom(edit) : EMPTY_MCP));
  const attach = useAttachMcp();
  const update = useUpdateMcp();
  const pending = isEdit ? update.isPending : attach.isPending;
  // Only the http branch offers this, and `connectors:r` is a scope the MCP
  // page does not otherwise need — don't 403 an operator who lacks it.
  const connectors = useConnectors((isEdit || open) && form.transport === "http");
  const set = (k: keyof McpFormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function close() {
    if (isEdit) onClose?.();
    else {
      setOpen(false);
      setForm(EMPTY_MCP);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const built = buildAttachBody(form);
    if ("error" in built) {
      toast.error(built.error);
      return;
    }
    // Detach asks first, and an edit is a detach plus an attach that may fail —
    // the strictly worse operation must not be the unguarded one.
    if (
      isEdit &&
      !(await confirm({
        title: `Save changes to ${edit.name}?`,
        description:
          "The server is detached and re-attached: its tools disappear for a moment, a task calling one mid-run will fail, and if the new settings do not attach it stays detached.",
        confirmLabel: "Save",
      }))
    )
      return;
    try {
      const res = isEdit
        ? await update.mutateAsync({ name: edit.name, body: built.body })
        : await attach.mutateAsync(built.body);
      toast.success(
        `${isEdit ? "Updated" : "Attached"} ${res.name}${res.tools.length ? ` — ${res.tools.length} tools` : ""}`,
      );
      close();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={isEdit ? true : open}
      onOpenChange={(o) => {
        if (o && !isEdit) setOpen(true);
        if (!o) close();
      }}
    >
      {!isEdit && (
        <DialogTrigger asChild>
          <Button size="sm">Attach server</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${edit.name}` : "Attach a tool server"}</DialogTitle>
        </DialogHeader>
        {isEdit && (
          <p className="text-xs text-muted-foreground">
            Saving detaches and re-attaches the server: its tools vanish for a moment, and a task
            calling one mid-run will fail.
          </p>
        )}
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field
            label="Name"
            hint={
              isEdit
                ? "The name identifies the server — remove and re-attach to rename it."
                : "Used in logs and to detach it later."
            }
          >
            <Input
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="filesystem"
              readOnly={isEdit}
              autoFocus={!isEdit}
            />
          </Field>
          <Field label="Transport">
            <Select
              value={form.transport}
              onChange={(e) => set("transport")(e.target.value)}
            >
              <option value="stdio">stdio — run a local command</option>
              <option value="http">http — call a remote server</option>
            </Select>
          </Field>
          {form.transport === "stdio" ? (
            <>
              <Field label="Command">
                <Input
                  value={form.command}
                  onChange={(e) => set("command")(e.target.value)}
                  placeholder="npx"
                />
              </Field>
              <Field label="Arguments" hint="Space-separated; quote anything containing spaces.">
                <Input
                  value={form.args}
                  onChange={(e) => set("args")(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="URL">
                <Input
                  value={form.url}
                  onChange={(e) => set("url")(e.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </Field>
              <Field
                label="Bearer token (optional)"
                hint={
                  isEdit && edit.has_auth_token
                    ? "A token is stored — leave blank to keep it, type a new one to replace it."
                    : "Stored in the vault, never on disk in the clear."
                }
              >
                <Input
                  type="password"
                  value={form.token}
                  onChange={(e) => set("token")(e.target.value)}
                />
              </Field>
              <Field
                label="OAuth connector (optional)"
                hint="Use a connected connector's token instead of a pasted one — the kernel refreshes it."
              >
                <Select
                  value={form.connectorId}
                  onChange={(e) => set("connectorId")(e.target.value)}
                >
                  <option value="">None</option>
                  {(connectors.data ?? [])
                    .filter((c) => c.connected)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </>
          )}
          <Field
            label="Environment (optional)"
            hint={
              isEdit && (edit.env_keys ?? []).length
                ? `Stored: ${(edit.env_keys ?? []).join(", ")}. Values are never shown — leave blank to keep them, or retype the whole set to replace it.`
                : "One KEY=VALUE per line. Use vault:SECRET_NAME to read a stored secret."
            }
          >
            <Textarea
              rows={3}
              value={form.env}
              onChange={(e) => set("env")(e.target.value)}
              placeholder={"GITHUB_TOKEN=vault:github_token"}
            />
          </Field>
          <Field label="Timeout (seconds, optional)">
            <Input
              value={form.timeout}
              onChange={(e) => set("timeout")(e.target.value)}
              placeholder="30"
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Attaching…"
                : isEdit
                  ? "Save"
                  : "Attach"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Browse the curated catalog and install in one step. */
export function McpCatalogDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Debounced like the marketplace search: one request per pause, not per
  // keystroke — the API's per-IP governor is sized for a human.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const catalog = useMcpCatalog(debouncedQ);
  const install = useInstallMcp();
  const [installing, setInstalling] = useState<string | null>(null);

  async function onInstall(id: string, community: boolean) {
    setInstalling(id);
    try {
      const res = await install.mutateAsync({ id, allow_community: community });
      toast.success(`Installed ${id}${res.tools.length ? ` — ${res.tools.length} tools` : ""}`);
    } catch (err) {
      toastError(err);
    } finally {
      setInstalling(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Browse catalog
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tool server catalog</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            autoFocus
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          <QueryState
            query={catalog}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title="No matching servers" />}
          >
            {(rows) => (
              <ul className="divide-y divide-border">
                {rows.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        {e.display_name}
                        <Badge variant="outline">{e.trust_tier}</Badge>
                        <Badge variant="muted">{e.transport}</Badge>
                      </p>
                      <p className="text-sm text-muted-foreground">{e.description}</p>
                      {e.runtime && (
                        <p className="text-xs text-muted-foreground">runtime: {e.runtime}</p>
                      )}
                    </div>
                    {e.installed ? (
                      <Badge variant="secondary">installed</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={installing === e.id}
                        // A community entry is unreviewed code; the API refuses it
                        // unless the caller opts in explicitly, so mirror that here.
                        onClick={() => void onInstall(e.id, e.trust_tier === "community")}
                      >
                        {installing === e.id
                          ? "Installing…"
                          : e.trust_tier === "community"
                            ? "Install (unverified)"
                            : "Install"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_CHANNEL: ChannelFormState = {
  kind: "telegram",
  display_name: "",
  external_id: "",
  credential: "",
  reply_topic: "",
  server_url: "",
  webhook_url: "",
  active_agent_name: "",
};

/** Connect a channel — the UI twin of `agentos channel connect`. */
export function ConnectChannelDialog({
  edit,
  onClose,
}: { edit?: ChannelSummary; onClose?: () => void } = {}) {
  const isEdit = edit != null;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(() =>
    edit ? channelFormFrom(edit) : EMPTY_CHANNEL,
  );
  const connect = useConnectChannel();
  const update = useUpdateChannel();
  const agents = useAgents();
  const spec = channelFieldsFor(form.kind);
  const pending = isEdit ? update.isPending : connect.isPending;
  const set = (k: keyof ChannelFormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function close() {
    if (isEdit) onClose?.();
    else {
      setOpen(false);
      setForm(EMPTY_CHANNEL);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (isEdit) {
      const built = buildUpdateChannelBody(form);
      if ("error" in built) {
        toast.error(built.error);
        return;
      }
      try {
        const ch = await update.mutateAsync({ id: edit.id, body: built.body });
        toast.success(`Updated ${ch.display_name}`);
        close();
      } catch (err) {
        toastError(err);
      }
      return;
    }
    const built = buildConnectChannelBody(form);
    if ("error" in built) {
      toast.error(built.error);
      return;
    }
    try {
      const ch = await connect.mutateAsync(built.body);
      toast.success(
        ch.external_id
          ? `Connected ${ch.display_name}`
          : `${ch.display_name} is waiting — send /start to the bot to finish setup`,
      );
      close();
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <Dialog
      open={isEdit ? true : open}
      onOpenChange={(o) => {
        if (o && !isEdit) setOpen(true);
        if (!o) close();
      }}
    >
      {!isEdit && (
        <DialogTrigger asChild>
          <Button size="sm">Connect channel</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${edit.display_name}` : "Connect a channel"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field
            label="Kind"
            hint={
              isEdit
                ? "A different kind is a different adapter — disconnect and reconnect to change it."
                : undefined
            }
          >
            {isEdit ? (
              <p className="text-sm font-medium">{form.kind}</p>
            ) : (
              <Select value={form.kind} onChange={(e) => set("kind")(e.target.value)}>
                {CHANNEL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Name" hint="Shown in the channel list; pick something you'll recognise.">
            <Input
              value={form.display_name}
              onChange={(e) => set("display_name")(e.target.value)}
              placeholder="Ops alerts"
              autoFocus
            />
          </Field>
          {spec.externalId && (
            <Field
              label={spec.externalId.label}
              hint={spec.externalId.required ? undefined : "Optional."}
            >
              <Input
                value={form.external_id}
                onChange={(e) => set("external_id")(e.target.value)}
                placeholder={spec.externalId.placeholder}
              />
            </Field>
          )}
          {spec.credential && (
            <Field
              label={spec.credential.label}
              hint={
                isEdit
                  ? `${spec.credential.hint} Leave blank to keep the stored one.`
                  : spec.credential.hint
              }
            >
              <Input
                type="password"
                value={form.credential}
                onChange={(e) => set("credential")(e.target.value)}
              />
            </Field>
          )}
          {spec.replyTopic && (
            <Field label="Reply topic (optional)" hint="Where inbound replies arrive.">
              <Input
                value={form.reply_topic}
                onChange={(e) => set("reply_topic")(e.target.value)}
              />
            </Field>
          )}
          {spec.serverUrl && (
            <Field label="Server URL (optional)">
              <Input
                value={form.server_url}
                onChange={(e) => set("server_url")(e.target.value)}
                placeholder="https://ntfy.sh"
              />
            </Field>
          )}
          {spec.webhookUrl && (
            <Field
              label="Public webhook URL (optional)"
              hint="Set this to receive updates by webhook instead of long-polling."
            >
              <Input
                value={form.webhook_url}
                onChange={(e) => set("webhook_url")(e.target.value)}
                placeholder="https://example.com"
              />
            </Field>
          )}
          <Field label="Default agent (optional)" hint="Answers inbound messages on this channel.">
            <Select
              value={form.active_agent_name}
              onChange={(e) => set("active_agent_name")(e.target.value)}
            >
              <option value="">No default</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Connecting…"
                : isEdit
                  ? "Save"
                  : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Set or clear a channel's default agent. */
export function SetChannelAgentDialog({
  channel,
  onOpenChange,
}: {
  channel: { id: string; display_name: string; active_agent_name?: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const agents = useAgents();
  const setAgent = useSetChannelAgent();
  const open = channel != null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName(channel?.active_agent_name ?? "");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Default agent for {channel?.display_name}</DialogTitle>
        </DialogHeader>
        <Select value={name} onChange={(e) => setName(e.target.value)}>
          <option value="">No default</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
            </option>
          ))}
        </Select>
        <DialogFooter>
          <Button
            disabled={setAgent.isPending || !channel}
            onClick={() =>
              setAgent
                .mutateAsync({ id: channel!.id, agent_name: name || null })
                .then(() => {
                  toast.success(name ? `Default agent set to ${name}` : "Default agent cleared");
                  onOpenChange(false);
                })
                .catch(toastError)
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared "paste a TOML manifest" dialog, used by plugins and connectors. */
/**
 * Paste-a-manifest dialog. With `trigger` it opens itself for an add; with
 * `initial` set it is mounted open by its caller as an editor instead.
 */
function ManifestDialog({
  trigger,
  title,
  hint,
  placeholder,
  onSubmit,
  pending,
  initial,
  submitLabel = "Add",
  onClose,
}: {
  trigger?: ReactNode;
  title: string;
  hint: string;
  placeholder: string;
  onSubmit: (toml: string) => Promise<unknown>;
  pending: boolean;
  initial?: string;
  submitLabel?: string;
  onClose?: () => void;
}) {
  const controlled = onClose != null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial ?? "");
  function close() {
    if (controlled) onClose?.();
    else {
      setOpen(false);
      setText("");
    }
  }
  return (
    <Dialog
      open={controlled ? true : open}
      onOpenChange={(o) => {
        if (o && !controlled) setOpen(true);
        if (!o) close();
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <Textarea
          rows={14}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <DialogFooter>
          <Button
            disabled={pending || !text.trim()}
            onClick={() => onSubmit(text).then(close).catch(toastError)}
          >
            {pending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddPluginDialog() {
  const install = useInstallPlugin();
  return (
    <ManifestDialog
      trigger={<Button size="sm">Add plugin</Button>}
      title="Add a plugin"
      hint="Paste a plugin.toml. It is saved under plugins/user and discovered immediately. Community and verified manifests still need a valid signature — an unsigned one is installed but stays blocked."
      placeholder={`id = "my-plugin"
display_name = "My plugin"
version = "0.1.0"
description = "What it does"
trust_tier = "core"
tools = []`}
      pending={install.isPending}
      onSubmit={async (toml) => {
        const p = await install.mutateAsync(toml);
        if (p.status === "blocked") {
          toast.warning(`Added ${p.display_name}, but it is blocked: ${p.blocked_reason ?? "unsigned"}`);
        } else {
          toast.success(`Added ${p.display_name}`);
        }
      }}
    />
  );
}

export function AddConnectorDialog() {
  const add = useAddConnector();
  return (
    <ManifestDialog
      trigger={<Button size="sm">Add connector</Button>}
      title="Add a connector"
      hint="Paste a connector manifest. It is saved under the kernel's connectors directory and registered right away; connect its credentials afterwards."
      placeholder={`[connector]
id = "my-api"
name = "My API"
version = "0.1.0"
description = "What it does"
base_url = "https://api.example.com"

[connector.auth]
type = "oauth2"

[[tools]]
name = "list-things"
description = "List things"
method = "get"
path = "/things"`}
      pending={add.isPending}
      onSubmit={async (toml) => {
        const c = await add.mutateAsync(toml);
        toast.success(`Added ${c.name}`);
      }}
    />
  );
}

/**
 * The states a manifest editor has before it can show a textarea. Without these
 * the Edit button is silently dead while the detail request is in flight, and
 * permanently dead if it fails — clicking again re-sets the same id, which is a
 * no-op against a query the client will not retry on a 4xx.
 */
function ManifestUnavailableDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit a connector's manifest. Prefilled from the file the kernel stores, so a
 * typo in a base URL or a tool path is a two-click fix instead of a
 * remove-and-re-authorise.
 */
export function EditConnectorDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useConnectorDetail(id);
  const update = useUpdateConnector();
  const error = detail.error;
  useEffect(() => {
    if (error) toastError(error);
  }, [error]);
  if (id == null) return null;
  if (detail.isError)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${id}`}
        message="Could not load this connector. Close and try again."
        onClose={() => onOpenChange(false)}
      />
    );
  if (!detail.isSuccess)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${id}`}
        message="Loading the stored manifest…"
        onClose={() => onOpenChange(false)}
      />
    );
  // A registered connector whose file the kernel cannot read: offering a blank
  // editor here would invite a "fix" that replaces the real manifest — and
  // every tool it defines — with whatever stub makes Save clickable.
  if (detail.data.manifest_toml == null)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${detail.data.name}`}
        message="This connector has no manifest file the kernel can read, so there is nothing to edit here — saving would replace its real definition. Remove and re-add it if you need to change it."
        onClose={() => onOpenChange(false)}
      />
    );
  return (
    <ManifestDialog
      key={id}
      title={`Edit ${detail.data.name}`}
      hint="The manifest replaces the stored one. Its `id` must stay the same; the OAuth credential is kept."
      placeholder=""
      initial={detail.data.manifest_toml}
      submitLabel="Save"
      pending={update.isPending}
      onClose={() => onOpenChange(false)}
      onSubmit={async (manifest_toml) => {
        const c = await update.mutateAsync({ id, manifest_toml });
        toast.success(`Updated ${c.name}`);
      }}
    />
  );
}

/** Edit a user-installed plugin's `plugin.toml` in place. */
export function EditPluginDialog({
  id,
  onOpenChange,
}: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = usePluginDetail(id);
  const update = useUpdatePlugin();
  const error = detail.error;
  useEffect(() => {
    if (error) toastError(error);
  }, [error]);
  if (id == null) return null;
  if (detail.isError)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${id}`}
        message="Could not load this plugin. Close and try again."
        onClose={() => onOpenChange(false)}
      />
    );
  if (!detail.isSuccess)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${id}`}
        message="Loading the stored manifest…"
        onClose={() => onOpenChange(false)}
      />
    );
  if (detail.data.manifest_toml == null)
    return (
      <ManifestUnavailableDialog
        title={`Edit ${detail.data.display_name}`}
        message="This plugin's manifest file could not be read, so there is nothing to edit here — saving would replace it. Remove and re-add it if you need to change it."
        onClose={() => onOpenChange(false)}
      />
    );
  return (
    <ManifestDialog
      key={id}
      title={`Edit ${detail.data.display_name}`}
      hint="Replaces plugin.toml on disk. Its `id` must stay the same; an active plugin is re-enabled after the edit."
      placeholder=""
      initial={detail.data.manifest_toml}
      submitLabel="Save"
      pending={update.isPending}
      onClose={() => onOpenChange(false)}
      onSubmit={async (manifest_toml) => {
        const p = await update.mutateAsync({ id, manifest_toml });
        if (p.status === "blocked") {
          toast.warning(`Saved, but ${p.display_name} is blocked: ${p.blocked_reason ?? "unsigned"}`);
        } else {
          toast.success(`Updated ${p.display_name}`);
        }
      }}
    />
  );
}

/** Paste a token obtained outside AgentOS (the CLI's `mcp oauth-store`). */
export function StoreCredentialDialog({
  connectorId,
  onOpenChange,
}: {
  connectorId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState("");
  const store = useStoreConnectorCredential();

  function reset() {
    setAccessToken("");
    setRefreshToken("");
    setTokenEndpoint("");
    setClientId("");
    setScopes("");
  }

  return (
    <Dialog
      open={connectorId != null}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Store a token for {connectorId}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Access token">
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoFocus
            />
          </Field>
          <Field
            label="Refresh token (optional)"
            hint="Without a refresh token, the connector stops working when the access token expires."
          >
            <Input
              type="password"
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
            />
          </Field>
          {/* Not optional: the vault refuses to store a credential without an
              https token endpoint (its SSRF guard), and it is what makes refresh
              possible at all. */}
          <Field label="Token endpoint" hint="Must be an https:// URL.">
            <Input
              value={tokenEndpoint}
              onChange={(e) => setTokenEndpoint(e.target.value)}
              placeholder="https://provider.example.com/oauth/token"
            />
          </Field>
          <Field label="Client ID (optional)">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </Field>
          <Field label="Scopes (optional)" hint="Comma-separated.">
            <Input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="read,write"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={
              store.isPending ||
              !accessToken.trim() ||
              !tokenEndpoint.trim().startsWith("https://") ||
              !connectorId
            }
            onClick={() =>
              store
                .mutateAsync({
                  id: connectorId!,
                  body: {
                    access_token: accessToken.trim(),
                    refresh_token: refreshToken.trim() || undefined,
                    token_endpoint: tokenEndpoint.trim(),
                    client_id: clientId.trim() || undefined,
                    scopes: scopes
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
                .then(() => {
                  toast.success("Token stored");
                  onOpenChange(false);
                  reset();
                })
                .catch(toastError)
            }
          >
            {store.isPending ? "Storing…" : "Store token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
