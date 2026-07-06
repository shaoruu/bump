import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain, type BrowserWindow } from "electron";
import { BUMP_DIR } from "./paths.js";
import {
  closeTerminal,
  getAllTerminalInfo,
  getTerminalBuffer,
  getTerminalDetails,
  hasTerminal,
  writeTerminal,
} from "./pty-manager.js";
import type {
  ControlBridgeParams,
  ControlBridgeResult,
  ControlResponseMessage,
  ControlSplitDirection,
  ControlStateReport,
  ControlWorkspaceInfo,
} from "../shared/types.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 7317;
const MAX_BODY_BYTES = 1024 * 1024;
const RENDERER_TIMEOUT_MS = 20000;

interface ControlRequestBody {
  data?: string;
  command?: string;
  enter?: boolean;
  direction?: ControlSplitDirection;
  cwd?: string;
  name?: string;
  workspaceId?: string;
}

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
}

interface Route {
  method: string;
  template: string[];
  auth: boolean;
  handler: (ctx: RouteContext) => Promise<void>;
}

interface PendingRequest {
  resolve: (result: ControlBridgeResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let server: Server | null = null;
let token = "";
let port = DEFAULT_PORT;
let startedAt = "";
let startedAtMs = 0;
let lastWorkspaceCount = 0;
let getWindowRef: (() => BrowserWindow | null) | null = null;

const pendingRequests = new Map<string, PendingRequest>();

function controlFilePath(): string {
  return join(BUMP_DIR, "control.json");
}

function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const withoutPort = hostHeader.replace(/:\d+$/, "").toLowerCase();
  const host =
    withoutPort.startsWith("[") && withoutPort.endsWith("]")
      ? withoutPort.slice(1, -1)
      : withoutPort;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function checkSecurity(req: IncomingMessage): string | null {
  if (!isLocalHost(req.headers.host)) return "invalid host header";
  // A cross-origin fetch always carries an Origin header and the CLI never
  // sets one, so this (with the bearer token) blocks DNS-rebinding and
  // drive-by requests from web pages.
  if (req.headers.origin) return "cross-origin requests are not allowed";
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  return safeEqual(header, `Bearer ${token}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<ControlRequestBody> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as ControlRequestBody;
  } catch {
    throw new Error("invalid JSON body");
  }
}

function sendJson(res: ServerResponse, status: number, payload: object): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendData(res: ServerResponse, data: object): void {
  sendJson(res, 200, { ok: true, data });
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, error: message });
}

function matchRoute(
  segments: string[],
  template: string[]
): Record<string, string> | null {
  if (segments.length !== template.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < template.length; i++) {
    const part = template[i];
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(segments[i]);
    } else if (part !== segments[i]) {
      return null;
    }
  }
  return params;
}

function callRenderer(
  method: string,
  params: ControlBridgeParams
): Promise<ControlBridgeResult> {
  return new Promise((resolve, reject) => {
    const win = getWindowRef?.();
    if (!win || win.isDestroyed()) {
      reject(new Error("bump window is not available"));
      return;
    }
    const reqId = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error(`control request '${method}' timed out`));
    }, RENDERER_TIMEOUT_MS);
    pendingRequests.set(reqId, { resolve, reject, timer });
    win.webContents.send("control:request", { reqId, method, params });
  });
}

function onControlResponse(
  _event: Electron.IpcMainEvent,
  message: ControlResponseMessage
): void {
  const pending = pendingRequests.get(message.reqId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRequests.delete(message.reqId);
  if (message.error) {
    pending.reject(new Error(message.error));
  } else {
    pending.resolve(message.result ?? {});
  }
}

function onControlState(
  _event: Electron.IpcMainEvent,
  state: ControlStateReport
): void {
  if (state && typeof state.workspaceCount === "number") {
    lastWorkspaceCount = state.workspaceCount;
  }
}

function buildLocationMap(
  workspaces: ControlWorkspaceInfo[]
): Map<string, { workspaceId: string; paneId: string }> {
  const map = new Map<string, { workspaceId: string; paneId: string }>();
  for (const ws of workspaces) {
    for (const pane of ws.panes) {
      if (pane.terminalId) {
        map.set(pane.terminalId, { workspaceId: ws.id, paneId: pane.paneId });
      }
    }
  }
  return map;
}

async function handleStatus(ctx: RouteContext): Promise<void> {
  sendData(ctx.res, {
    version: app.getVersion(),
    pid: process.pid,
    terminalCount: getAllTerminalInfo().length,
    workspaceCount: lastWorkspaceCount,
    uptimeMs: Date.now() - startedAtMs,
  });
}

async function handleListTerminals(ctx: RouteContext): Promise<void> {
  const infos = getAllTerminalInfo();
  let locations = new Map<string, { workspaceId: string; paneId: string }>();
  try {
    const result = await callRenderer("workspaces.list", {});
    locations = buildLocationMap(result.workspaces ?? []);
  } catch {
    // Renderer may be unavailable; still report terminals known to main.
  }

  const terminals = await Promise.all(
    infos.map(async (info) => {
      const details = await getTerminalDetails(info.id);
      const location = locations.get(info.id);
      return {
        id: info.id,
        title: info.title,
        pid: details?.pid ?? null,
        cwd: details?.cwd ?? null,
        gitBranch: details?.gitBranch ?? null,
        logPath: info.logPath,
        workspaceId: location?.workspaceId ?? null,
        paneId: location?.paneId ?? null,
      };
    })
  );

  sendData(ctx.res, { terminals });
}

async function handleReadBuffer(ctx: RouteContext): Promise<void> {
  const id = ctx.params.id;
  if (!hasTerminal(id)) {
    sendError(ctx.res, 404, `unknown terminal '${id}'`);
    return;
  }
  const buffer = getTerminalBuffer(id);
  const linesParam = ctx.query.get("lines");
  let output = buffer;
  let lines: number | null = null;
  if (linesParam) {
    const n = parseInt(linesParam, 10);
    if (!Number.isNaN(n) && n > 0) {
      output = buffer.split("\n").slice(-n).join("\n");
      lines = n;
    }
  }
  sendData(ctx.res, { id, lines, buffer: output });
}

async function handleWrite(ctx: RouteContext): Promise<void> {
  const id = ctx.params.id;
  if (!hasTerminal(id)) {
    sendError(ctx.res, 404, `unknown terminal '${id}'`);
    return;
  }
  const body = await readJson(ctx.req);
  if (typeof body.data !== "string") {
    sendError(ctx.res, 400, "'data' (string) is required");
    return;
  }
  writeTerminal(id, body.data);
  sendData(ctx.res, { id, bytes: Buffer.byteLength(body.data) });
}

async function handleRun(ctx: RouteContext): Promise<void> {
  const id = ctx.params.id;
  if (!hasTerminal(id)) {
    sendError(ctx.res, 404, `unknown terminal '${id}'`);
    return;
  }
  const body = await readJson(ctx.req);
  if (typeof body.command !== "string" || body.command.length === 0) {
    sendError(ctx.res, 400, "'command' (non-empty string) is required");
    return;
  }
  const enter = body.enter !== false;
  writeTerminal(id, body.command + (enter ? "\r" : ""));
  sendData(ctx.res, { id, command: body.command, enter });
}

async function handleDeleteTerminal(ctx: RouteContext): Promise<void> {
  const id = ctx.params.id;
  if (!hasTerminal(id)) {
    sendError(ctx.res, 404, `unknown terminal '${id}'`);
    return;
  }
  closeTerminal(id);
  sendData(ctx.res, { id, closed: true });
}

async function handleListWorkspaces(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("workspaces.list", {});
  const workspaces = result.workspaces ?? [];
  const active = workspaces.find((w) => w.isActive);
  sendData(ctx.res, {
    workspaces,
    activeWorkspaceId: active?.id ?? null,
  });
}

async function handleCreateWorkspace(ctx: RouteContext): Promise<void> {
  const body = await readJson(ctx.req);
  const result = await callRenderer("workspaces.create", { cwd: body.cwd });
  sendData(ctx.res, {
    workspaceId: result.workspaceId,
    paneId: result.paneId,
    terminalId: result.terminalId,
  });
}

async function handleActivateWorkspace(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("workspaces.activate", {
    id: ctx.params.id,
  });
  sendData(ctx.res, { workspaceId: result.workspaceId });
}

async function handleRenameWorkspace(ctx: RouteContext): Promise<void> {
  const body = await readJson(ctx.req);
  if (typeof body.name !== "string" || !body.name.trim()) {
    sendError(ctx.res, 400, "'name' (non-empty string) is required");
    return;
  }
  const result = await callRenderer("workspaces.rename", {
    id: ctx.params.id,
    name: body.name,
  });
  sendData(ctx.res, { workspaceId: result.workspaceId });
}

async function handleCloseWorkspace(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("workspaces.close", { id: ctx.params.id });
  sendData(ctx.res, {
    workspaceId: result.workspaceId,
    closed: result.closed ?? true,
  });
}

async function handleSplitPane(ctx: RouteContext): Promise<void> {
  const body = await readJson(ctx.req);
  const direction: ControlSplitDirection =
    body.direction === "vertical" ? "vertical" : "horizontal";
  const result = await callRenderer("panes.split", {
    paneId: ctx.params.id,
    direction,
    cwd: body.cwd,
    command: body.command,
  });
  sendData(ctx.res, { paneId: result.paneId, terminalId: result.terminalId });
}

async function handleFocusPane(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("panes.focus", { paneId: ctx.params.id });
  sendData(ctx.res, { paneId: result.paneId });
}

async function handleClosePane(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("panes.close", { paneId: ctx.params.id });
  sendData(ctx.res, { paneId: ctx.params.id, closed: result.closed ?? true });
}

async function handleCloseOtherPanes(ctx: RouteContext): Promise<void> {
  const result = await callRenderer("panes.closeOthers", {
    paneId: ctx.params.id,
  });
  sendData(ctx.res, { paneId: result.paneId });
}

async function handleCreateTerminal(ctx: RouteContext): Promise<void> {
  const body = await readJson(ctx.req);
  const result = await callRenderer("terminals.create", {
    workspaceId: body.workspaceId,
    cwd: body.cwd,
    command: body.command,
  });
  sendData(ctx.res, {
    workspaceId: result.workspaceId,
    paneId: result.paneId,
    terminalId: result.terminalId,
  });
}

const routes: Route[] = [
  { method: "GET", template: ["status"], auth: false, handler: handleStatus },
  {
    method: "GET",
    template: ["terminals"],
    auth: true,
    handler: handleListTerminals,
  },
  {
    method: "POST",
    template: ["terminals"],
    auth: true,
    handler: handleCreateTerminal,
  },
  {
    method: "GET",
    template: ["terminals", ":id", "buffer"],
    auth: true,
    handler: handleReadBuffer,
  },
  {
    method: "POST",
    template: ["terminals", ":id", "write"],
    auth: true,
    handler: handleWrite,
  },
  {
    method: "POST",
    template: ["terminals", ":id", "run"],
    auth: true,
    handler: handleRun,
  },
  {
    method: "DELETE",
    template: ["terminals", ":id"],
    auth: true,
    handler: handleDeleteTerminal,
  },
  {
    method: "GET",
    template: ["workspaces"],
    auth: true,
    handler: handleListWorkspaces,
  },
  {
    method: "POST",
    template: ["workspaces"],
    auth: true,
    handler: handleCreateWorkspace,
  },
  {
    method: "POST",
    template: ["workspaces", ":id", "activate"],
    auth: true,
    handler: handleActivateWorkspace,
  },
  {
    method: "PATCH",
    template: ["workspaces", ":id"],
    auth: true,
    handler: handleRenameWorkspace,
  },
  {
    method: "DELETE",
    template: ["workspaces", ":id"],
    auth: true,
    handler: handleCloseWorkspace,
  },
  {
    method: "POST",
    template: ["panes", ":id", "split"],
    auth: true,
    handler: handleSplitPane,
  },
  {
    method: "POST",
    template: ["panes", ":id", "focus"],
    auth: true,
    handler: handleFocusPane,
  },
  {
    method: "POST",
    template: ["panes", ":id", "close-others"],
    auth: true,
    handler: handleCloseOtherPanes,
  },
  {
    method: "DELETE",
    template: ["panes", ":id"],
    auth: true,
    handler: handleClosePane,
  },
];

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const securityError = checkSecurity(req);
    if (securityError) {
      sendError(res, 403, securityError);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const method = req.method ?? "GET";

    let isPathMatched = false;
    for (const route of routes) {
      const params = matchRoute(segments, route.template);
      if (!params) continue;
      isPathMatched = true;
      if (route.method !== method) continue;
      if (route.auth && !isAuthorized(req)) {
        sendError(res, 401, "missing or invalid bearer token");
        return;
      }
      await route.handler({ req, res, params, query: url.searchParams });
      return;
    }

    sendError(
      res,
      isPathMatched ? 405 : 404,
      isPathMatched ? "method not allowed" : "not found"
    );
  } catch (err) {
    if (!res.headersSent) {
      sendError(
        res,
        500,
        err instanceof Error ? err.message : "internal error"
      );
    }
  }
}

function listen(target: Server, listenPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      target.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      target.removeListener("error", onError);
      resolve();
    };
    target.once("error", onError);
    target.once("listening", onListening);
    target.listen(listenPort, HOST);
  });
}

function writeDiscoveryFile(): void {
  mkdirSync(BUMP_DIR, { recursive: true });
  const payload = JSON.stringify(
    { port, token, pid: process.pid, startedAt },
    null,
    2
  );
  writeFileSync(controlFilePath(), payload, { mode: 0o600 });
}

export async function startControlServer(
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (server) return;
  getWindowRef = getWindow;

  try {
    token = randomBytes(32).toString("hex");
    startedAt = new Date().toISOString();
    startedAtMs = Date.now();

    ipcMain.on("control:response", onControlResponse);
    ipcMain.on("control:state", onControlState);

    const created = createServer((req, res) => {
      void handleRequest(req, res);
    });

    try {
      await listen(created, DEFAULT_PORT);
    } catch {
      await listen(created, 0);
    }

    const address = created.address();
    port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
    server = created;
    server.on("error", (err) => {
      console.warn("[control-server] runtime error:", err.message);
    });

    writeDiscoveryFile();
    console.log(`[control-server] listening on http://${HOST}:${port}`);
  } catch (err) {
    console.warn(
      "[control-server] failed to start:",
      err instanceof Error ? err.message : err
    );
    ipcMain.removeListener("control:response", onControlResponse);
    ipcMain.removeListener("control:state", onControlState);
    server = null;
  }
}

export function stopControlServer(): void {
  if (server) {
    try {
      server.close();
    } catch {
      // ignore
    }
    server = null;
  }
  ipcMain.removeListener("control:response", onControlResponse);
  ipcMain.removeListener("control:state", onControlState);
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("control server stopped"));
  }
  pendingRequests.clear();
  try {
    unlinkSync(controlFilePath());
  } catch {
    // file may not exist
  }
}
