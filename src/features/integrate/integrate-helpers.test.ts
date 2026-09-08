import { describe, expect, it } from "vitest";
import {
  buildAttachBody,
  buildConnectChannelBody,
  buildUpdateChannelBody,
  channelFieldsFor,
  channelFormFrom,
  mcpFormFrom,
  parseEnvLines,
  splitArgs,
  type ChannelFormState,
  type McpFormState,
} from "./integrate-helpers";
import type { ChannelSummary, McpServer } from "@/api/models";

const mcp = (over: Partial<McpFormState> = {}): McpFormState => ({
  name: "fs",
  transport: "stdio",
  command: "npx",
  args: "-y @modelcontextprotocol/server-filesystem /tmp",
  url: "",
  token: "",
  connectorId: "",
  env: "",
  timeout: "",
  ...over,
});

describe("parseEnvLines", () => {
  it("keeps KEY=VALUE pairs and drops blanks and comments", () => {
    expect(parseEnvLines("A=1\n\n# note\nB = two \n")).toEqual({ A: "1", B: "two" });
  });
  it("preserves '=' inside the value", () => {
    expect(parseEnvLines("TOKEN=a=b=c")).toEqual({ TOKEN: "a=b=c" });
  });
  it("ignores a line with no key", () => {
    expect(parseEnvLines("=orphan")).toEqual({});
  });
});

describe("splitArgs", () => {
  it("splits on whitespace", () => {
    expect(splitArgs("-y pkg /tmp")).toEqual(["-y", "pkg", "/tmp"]);
  });
  it("keeps a quoted span together and strips the quotes", () => {
    expect(splitArgs('--dir "/my files" -v')).toEqual(["--dir", "/my files", "-v"]);
  });
});

describe("buildAttachBody", () => {
  it("builds a stdio body with parsed args", () => {
    const r = buildAttachBody(mcp());
    expect("body" in r && r.body.command).toBe("npx");
    expect("body" in r && r.body.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/tmp",
    ]);
    // A stdio server must not carry an http field, or the API 400s on ambiguity.
    expect("body" in r && r.body.url).toBeUndefined();
  });
  it("rejects a stdio server with no command", () => {
    expect(buildAttachBody(mcp({ command: "  " }))).toEqual({
      error: "Command is required for a stdio server",
    });
  });
  it("rejects an http server with no url, and a non-http url", () => {
    expect(buildAttachBody(mcp({ transport: "http", url: "" }))).toHaveProperty("error");
    expect(buildAttachBody(mcp({ transport: "http", url: "ftp://x" }))).toHaveProperty("error");
  });
  it("omits an empty auth token rather than sending a blank one", () => {
    const r = buildAttachBody(mcp({ transport: "http", url: "https://x/mcp", token: "  " }));
    expect("body" in r && r.body.auth_token).toBeUndefined();
  });
  it("carries an oauth connector on the http branch and drops a blank one", () => {
    const http = { transport: "http", url: "https://x/mcp" } as const;
    const withConn = buildAttachBody(mcp({ ...http, connectorId: "github" }));
    expect("body" in withConn && withConn.body.oauth_connector_id).toBe("github");
    const without = buildAttachBody(mcp({ ...http, connectorId: "  " }));
    expect("body" in without && without.body.oauth_connector_id).toBeUndefined();
    // A stdio server has no remote to authenticate to.
    const stdio = buildAttachBody(mcp({ connectorId: "github" }));
    expect("body" in stdio && stdio.body.oauth_connector_id).toBeUndefined();
  });
  it("rejects a name with path separators", () => {
    expect(buildAttachBody(mcp({ name: "../evil" }))).toHaveProperty("error");
  });
  it("rejects a non-numeric timeout", () => {
    expect(buildAttachBody(mcp({ timeout: "soon" }))).toHaveProperty("error");
  });
});

const chan = (over: Partial<ChannelFormState> = {}): ChannelFormState => ({
  kind: "ntfy",
  display_name: "Ops alerts",
  external_id: "agentos-ops",
  credential: "",
  reply_topic: "",
  server_url: "",
  webhook_url: "",
  active_agent_name: "",
  ...over,
});

describe("buildConnectChannelBody", () => {
  it("requires the external id when the kind needs one", () => {
    expect(buildConnectChannelBody(chan({ external_id: "" }))).toEqual({
      error: "Topic is required for ntfy",
    });
  });
  it("allows Telegram without a chat id (auto-discovered from /start)", () => {
    const r = buildConnectChannelBody(chan({ kind: "telegram", external_id: "" }));
    expect("body" in r).toBe(true);
  });
  it("drops fields the kind does not use", () => {
    const r = buildConnectChannelBody(
      chan({ kind: "slack", webhook_url: "https://x", server_url: "https://y" }),
    );
    expect("body" in r && r.body.webhook_url).toBeUndefined();
    expect("body" in r && r.body.server_url).toBeUndefined();
  });
  it("drops a credential typed before switching to a kind that takes none", () => {
    const r = buildConnectChannelBody(
      chan({ kind: "webhook", external_id: "https://x/hook", credential: "leftover-token" }),
    );
    expect("body" in r && r.body.credential).toBeUndefined();
  });
  it("requires a display name", () => {
    expect(buildConnectChannelBody(chan({ display_name: " " }))).toHaveProperty("error");
  });
});

describe("channelFieldsFor", () => {
  it("marks the telegram chat id optional and everything else required", () => {
    expect(channelFieldsFor("telegram").externalId?.required).toBe(false);
    expect(channelFieldsFor("slack").externalId?.required).toBe(true);
  });
  it("gives webhook no credential field", () => {
    expect(channelFieldsFor("webhook").credential).toBeNull();
  });
});

describe("editing an attached server", () => {
  const server: McpServer = {
    name: "gh",
    tool_count: 3,
    args: ["-y", "server-github"],
    command: "npx",
    timeout_secs: 45,
    has_auth_token: true,
    env_keys: ["GITHUB_TOKEN"],
  };

  it("seeds the form from the server, minus the secrets it never returns", () => {
    expect(mcpFormFrom(server)).toMatchObject({
      name: "gh",
      transport: "stdio",
      command: "npx",
      args: "-y server-github",
      timeout: "45",
      token: "",
      env: "",
    });
  });

  // splitArgs honours quotes going in, so the way back out has to add them —
  // otherwise opening Edit and saving an untouched form re-points the server.
  it("round-trips an argument containing a space", () => {
    const spaced: McpServer = { ...server, args: ["--dir", "/my files"] };
    const built = buildAttachBody(mcpFormFrom(spaced));
    expect("body" in built && built.body.args).toEqual(["--dir", "/my files"]);
  });

  it("trusts the transport the API reports over guessing from url", () => {
    expect(mcpFormFrom({ ...server, transport: "http", url: "https://x/mcp" }).transport).toBe(
      "http",
    );
  });

  it("picks http when the server has a url", () => {
    expect(mcpFormFrom({ ...server, command: undefined, url: "https://x/mcp" }).transport).toBe(
      "http",
    );
  });

  // The API reads an omitted `env` as "keep the stored one" and `{}` as "clear
  // it" — an untouched textarea must not wipe an MCP server's environment.
  it("omits env entirely when the textarea is blank", () => {
    const built = buildAttachBody(mcpFormFrom(server));
    expect("body" in built && built.body.env).toBeUndefined();
  });

  it("sends env once the operator types some", () => {
    const built = buildAttachBody(mcpFormFrom({ ...server, env_keys: [] }));
    expect("body" in built).toBe(true);
    const withEnv = buildAttachBody({ ...mcpFormFrom(server), env: "A=1" });
    expect("body" in withEnv && withEnv.body.env).toEqual({ A: "1" });
  });
});

describe("buildUpdateChannelBody", () => {
  const channel: ChannelSummary = {
    id: "c1",
    kind: "ntfy",
    display_name: "Alerts",
    external_id: "agentos-alerts",
    reply_topic: "agentos-replies",
    server_url: "https://ntfy.sh",
    connected_at: "2026-01-01T00:00:00Z",
    last_active: "2026-01-01T00:00:00Z",
  };

  it("round-trips a channel through the form unchanged", () => {
    const built = buildUpdateChannelBody(channelFormFrom(channel));
    expect("body" in built && built.body).toMatchObject({
      display_name: "Alerts",
      external_id: "agentos-alerts",
      reply_topic: "agentos-replies",
      server_url: "https://ntfy.sh",
    });
  });

  // Blank credential means "keep the stored secret", so it must not be sent.
  it("omits a blank credential but sends a typed one", () => {
    const form = channelFormFrom(channel);
    const kept = buildUpdateChannelBody(form);
    expect("body" in kept && kept.body.credential).toBeUndefined();
    const rotated = buildUpdateChannelBody({ ...form, credential: "tk_new" });
    expect("body" in rotated && rotated.body.credential).toBe("tk_new");
  });

  // An emptied input must reach the API as "" — that is what clears the field.
  it("sends an emptied optional field as a clear", () => {
    const built = buildUpdateChannelBody({ ...channelFormFrom(channel), reply_topic: "" });
    expect("body" in built && built.body.reply_topic).toBe("");
  });

  // A field this kind's form never renders was not "emptied by the operator" —
  // sending "" would clear a value they were never shown.
  it("omits a field the kind's spec hides instead of clearing it", () => {
    const slack: ChannelSummary = {
      ...channel,
      kind: "slack",
      external_id: "C0123456789",
      server_url: "https://slack.corp.internal",
    };
    const built = buildUpdateChannelBody(channelFormFrom(slack));
    expect("body" in built && built.body.server_url).toBeUndefined();
    expect("body" in built && built.body.reply_topic).toBeUndefined();
  });

  it("still requires the kind's mandatory id", () => {
    const built = buildUpdateChannelBody({ ...channelFormFrom(channel), external_id: "" });
    expect("error" in built).toBe(true);
  });
});
