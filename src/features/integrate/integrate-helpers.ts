import type {
  AttachMcpRequest,
  ChannelSummary,
  ConnectChannelRequest,
  McpServer,
  UpdateChannelRequest,
} from "@/api/models";

/** Channel kinds the kernel can actually build an adapter for. */
export const CHANNEL_KINDS = [
  "telegram",
  "ntfy",
  "email",
  "discord",
  "slack",
  "whatsapp",
  "webhook",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * Which fields a given channel kind actually uses, so the form shows three
 * inputs instead of eight. `external_id` is optional only for Telegram, which
 * auto-discovers the chat id from the first `/start`.
 */
export interface ChannelFieldSpec {
  externalId: { label: string; required: boolean; placeholder: string } | null;
  credential: { label: string; hint: string } | null;
  replyTopic: boolean;
  serverUrl: boolean;
  webhookUrl: boolean;
}

export function channelFieldsFor(kind: string): ChannelFieldSpec {
  switch (kind) {
    case "telegram":
      return {
        externalId: {
          label: "Chat ID",
          required: false,
          placeholder: "leave blank to auto-discover from /start",
        },
        credential: { label: "Bot token", hint: "From @BotFather." },
        replyTopic: false,
        serverUrl: false,
        webhookUrl: true,
      };
    case "ntfy":
      return {
        externalId: { label: "Topic", required: true, placeholder: "agentos-alerts" },
        // ntfy topics are public by default; a token is only needed for
        // protected topics, so this stays optional.
        credential: { label: "Access token (optional)", hint: "Only for protected topics." },
        replyTopic: true,
        serverUrl: true,
        webhookUrl: false,
      };
    case "email":
      return {
        externalId: { label: "Address", required: true, placeholder: "you@example.com" },
        credential: { label: "SMTP password", hint: "Stored in the vault." },
        replyTopic: false,
        serverUrl: true,
        webhookUrl: false,
      };
    case "webhook":
      return {
        externalId: { label: "Endpoint URL", required: true, placeholder: "https://example.com/hook" },
        credential: null,
        replyTopic: false,
        serverUrl: false,
        webhookUrl: false,
      };
    default:
      // discord / slack / whatsapp: a bot token plus the destination id.
      return {
        externalId: { label: "Channel / chat ID", required: true, placeholder: "C0123456789" },
        credential: { label: "Bot token", hint: "Stored in the vault." },
        replyTopic: false,
        serverUrl: false,
        webhookUrl: false,
      };
  }
}

/** Parse `KEY=VALUE` lines into an env map, ignoring blanks and `#` comments. */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Inverse of `splitArgs`: re-quote anything that would not survive the split.
 * Without this an arg like `/my files` comes back as two, so opening Edit and
 * saving an untouched form would silently re-point the server.
 */
export function quoteArgs(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

/** Split a shell-ish argument string on whitespace, honouring quoted spans. */
export function splitArgs(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) =>
    (a.startsWith('"') && a.endsWith('"')) || (a.startsWith("'") && a.endsWith("'"))
      ? a.slice(1, -1)
      : a,
  );
}

export interface McpFormState {
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  token: string;
  connectorId: string;
  env: string;
  timeout: string;
}

/**
 * Validate + shape an attach request. The API rejects an ambiguous transport
 * with a 400, so catch it here where the message can point at a field.
 */
export function buildAttachBody(f: McpFormState): { body: AttachMcpRequest } | { error: string } {
  const name = f.name.trim();
  if (!name) return { error: "Name is required" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name))
    return { error: "Name may use letters, digits, '-' and '_' (max 64)" };
  const timeout_secs = f.timeout.trim() ? Number(f.timeout.trim()) : undefined;
  if (timeout_secs !== undefined && (!Number.isFinite(timeout_secs) || timeout_secs <= 0))
    return { error: "Timeout must be a positive number of seconds" };
  // Blank must stay absent, not `{}`: on an edit the API reads an omitted
  // `env` as "keep what is stored" and an empty object as "clear it".
  const env = f.env.trim() ? parseEnvLines(f.env) : undefined;

  if (f.transport === "stdio") {
    const command = f.command.trim();
    if (!command) return { error: "Command is required for a stdio server" };
    return {
      body: { name, command, args: splitArgs(f.args), env, timeout_secs },
    };
  }
  const url = f.url.trim();
  if (!url) return { error: "URL is required for an http server" };
  if (!/^https?:\/\//i.test(url)) return { error: "URL must start with http:// or https://" };
  return {
    body: {
      name,
      url,
      args: [],
      env,
      timeout_secs,
      auth_token: f.token.trim() || undefined,
      // Borrow a connector's stored OAuth token instead of pasting one; the
      // kernel refreshes it, a pasted bearer goes stale.
      oauth_connector_id: f.connectorId.trim() || undefined,
    },
  };
}

export interface ChannelFormState {
  kind: string;
  display_name: string;
  external_id: string;
  credential: string;
  reply_topic: string;
  server_url: string;
  webhook_url: string;
  active_agent_name: string;
}

export function buildConnectChannelBody(
  f: ChannelFormState,
): { body: ConnectChannelRequest } | { error: string } {
  const display_name = f.display_name.trim();
  if (!display_name) return { error: "Name is required" };
  const spec = channelFieldsFor(f.kind);
  const external_id = f.external_id.trim();
  if (spec.externalId?.required && !external_id)
    return { error: `${spec.externalId.label} is required for ${f.kind}` };
  return {
    body: {
      kind: f.kind,
      display_name,
      external_id: external_id || undefined,
      // Gated on the spec like every other optional field: switching kind after
      // typing must not smuggle a stale secret into a kind that takes none.
      credential: spec.credential ? f.credential.trim() || undefined : undefined,
      reply_topic: spec.replyTopic ? f.reply_topic.trim() || undefined : undefined,
      server_url: spec.serverUrl ? f.server_url.trim() || undefined : undefined,
      webhook_url: spec.webhookUrl ? f.webhook_url.trim() || undefined : undefined,
      active_agent_name: f.active_agent_name.trim() || undefined,
    },
  };
}

/** Seed the attach form from an attached server, for editing it in place. */
export function mcpFormFrom(m: McpServer): McpFormState {
  return {
    name: m.name,
    // The API states the transport outright; `url` is only a fallback for a
    // live server with no persisted attachment row.
    transport: m.transport === "http" || m.transport === "stdio"
      ? m.transport
      : m.url
        ? "http"
        : "stdio",
    command: m.command ?? "",
    args: quoteArgs(m.args ?? []),
    url: m.url ?? "",
    // The token is never returned; blank means "keep the stored one".
    token: "",
    connectorId: m.oauth_connector_id ?? "",
    // Env values are withheld for the same reason, so the textarea starts
    // empty and an untouched edit keeps whatever is stored.
    env: "",
    timeout: m.timeout_secs != null ? String(m.timeout_secs) : "",
  };
}

/** Seed the connect form from a connected channel, for editing it in place. */
export function channelFormFrom(c: ChannelSummary): ChannelFormState {
  return {
    kind: c.kind,
    display_name: c.display_name,
    external_id: c.external_id ?? "",
    credential: "",
    reply_topic: c.reply_topic ?? "",
    server_url: c.server_url ?? "",
    webhook_url: c.webhook_url ?? "",
    active_agent_name: c.active_agent_name ?? "",
  };
}

/**
 * Shape a channel edit. Every field is sent, so clearing an input clears the
 * value — except the credential, where blank means "keep the stored secret".
 */
export function buildUpdateChannelBody(
  f: ChannelFormState,
): { body: UpdateChannelRequest } | { error: string } {
  const display_name = f.display_name.trim();
  if (!display_name) return { error: "Name is required" };
  const spec = channelFieldsFor(f.kind);
  const external_id = f.external_id.trim();
  if (spec.externalId?.required && !external_id)
    return { error: `${spec.externalId.label} is required for ${f.kind}` };
  return {
    body: {
      display_name,
      external_id,
      credential: (spec.credential && f.credential.trim()) || undefined,
      // A field this kind's spec hides was never on screen, so the operator did
      // not choose to empty it: omit it (unchanged) rather than send "" (clear).
      // Only a field they could actually see may clear itself.
      reply_topic: spec.replyTopic ? f.reply_topic.trim() : undefined,
      server_url: spec.serverUrl ? f.server_url.trim() : undefined,
      webhook_url: spec.webhookUrl ? f.webhook_url.trim() : undefined,
      active_agent_name: f.active_agent_name.trim(),
    },
  };
}
