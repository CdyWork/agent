import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const reportsDir = join(publicDir, "reports");

const defaultAgentId = "2b6f6369-c969-4a26-acd9-5d80cf1282c0";
const defaultFastAgentId = "81991cc3-cc70-415c-9446-9583c6b48058";

const apiKey = process.env.AGENT_API_KEY || "";
const port = Number(process.env.PORT || 5173);
const agentBaseUrl = process.env.AGENT_API_URL || "";
const agentCardUrl =
  process.env.AGENT_CARD_URL ||
  `https://appbuilder.baidu.com/v2/a2a/${defaultAgentId}/.well-known/agent.json${apiKey ? `?api_key=${apiKey}` : ""}`;
const chatTimeoutMs = Number(process.env.AGENT_CHAT_TIMEOUT_MS || 0);
const fastAgentApiKey = process.env.FAST_AGENT_API_KEY || apiKey;
const fastAgentBaseUrl = process.env.FAST_AGENT_API_URL || "";
const fastAgentCardUrl =
  process.env.FAST_AGENT_CARD_URL ||
  `https://appbuilder.baidu.com/v2/a2a/${defaultFastAgentId}/.well-known/agent.json${
    fastAgentApiKey ? `?api_key=${fastAgentApiKey}` : ""
  }`;

const cachedAgentCards = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/agent-card" && req.method === "GET") {
      await handleAgentCard(res, url.searchParams.get("mode"));
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      await handleChat(req, res);
      return;
    }

    if (url.pathname === "/api/debug-chat" && req.method === "POST") {
      await handleDebugChat(req, res);
      return;
    }

    if (url.pathname === "/api/report" && req.method === "POST") {
      await handleCreateReport(req, res);
      return;
    }

    if (url.pathname === "/api/preview-markdown" && req.method === "GET") {
      await handlePreviewMarkdown(url, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "服务器内部错误，请稍后再试。" });
    } else {
      res.end();
    }
  }
});

server.on("error", (error) => {
  console.error("server error", error);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`山东大学求职助手已启动: http://localhost:${port}`);
});

process.on("unhandledRejection", (error) => {
  console.error("unhandledRejection", error);
});

async function handleAgentCard(res, mode) {
  const config = getAgentConfig(mode);
  if (!config.cardUrl) {
    sendJson(res, 404, { error: "Agent 元数据地址未配置。" });
    return;
  }

  const headers = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers["X-Appbuilder-Authorization"] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.cardUrl, { headers });
  const text = await response.text();
  if (response.ok) {
    cachedAgentCards.set(config.mode, JSON.parse(text));
  }
  res.writeHead(response.status, {
    "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

async function handleDebugChat(req, res) {
  const payload = await readJsonBody(req);
  const message = String(payload.message || "").trim();
  const config = getAgentConfig(payload.mode);
  const rpcBody = {
    id: crypto.randomUUID(),
    jsonrpc: "2.0",
    method: "message/stream",
    params: {
      message: {
        kind: "message",
        parts: [{ kind: "text", text: message }],
        role: "user",
        messageId: crypto.randomUUID()
      }
    }
  };

  const upstream = await fetch(await getAgentUrl(config.mode), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(rpcBody)
  });

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
    "cache-control": "no-store"
  });

  if (!upstream.body) {
    res.end(await upstream.text().catch(() => ""));
    return;
  }

  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

async function handleCreateReport(req, res) {
  const payload = await readJsonBody(req);
  const title = String(payload.title || "山东大学求职助手报告").trim();
  const content = String(payload.content || "").trim();

  if (!content) {
    sendJson(res, 400, { error: "报告内容不能为空。" });
    return;
  }

  await mkdir(reportsDir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `sdu-career-report-${id}.html`;
  const html = renderReportHtml(title, content);
  await writeFile(join(reportsDir, filename), html, "utf8");

  sendJson(res, 200, {
    title,
    url: `/reports/${filename}`,
    filename
  });
}

async function handlePreviewMarkdown(url, res) {
  const source = url.searchParams.get("url");
  if (!source) {
    sendJson(res, 400, { error: "缺少可预览的 Markdown URL。" });
    return;
  }

  const markdown = await loadMarkdownSource(source);
  const title = getUrlFileName(source) || "Markdown 预览";
  const html = renderReportHtml(title, markdown);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

async function loadMarkdownSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const headers = shouldAttachAgentAuth(source) && apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await fetch(source, { headers });

    if (!response.ok) {
      throw new Error(`Markdown 获取失败：${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  const cleanPath = decodeURIComponent(source).replace(/^\/+/, "");
  const filePath = normalize(join(publicDir, cleanPath));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
    throw new Error("Markdown 路径不在可预览目录内。");
  }

  return readFile(filePath, "utf8");
}

function shouldAttachAgentAuth(source) {
  try {
    return new URL(source).hostname.endsWith("appbuilder.baidu.com");
  } catch {
    return false;
  }
}

function renderReportHtml(title, content) {
  const body = markdownLiteToHtml(content);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f7f8f4; color: #172126; font-family: "Microsoft YaHei", system-ui, sans-serif; line-height: 1.75; }
    main { max-width: 920px; margin: 40px auto; padding: 42px; background: #fff; border: 1px solid #dce2dd; border-radius: 8px; }
    h1 { margin: 0 0 24px; color: #01483f; font-size: 30px; }
    h2 { margin-top: 28px; color: #006d5b; font-size: 21px; }
    h3 { margin-top: 22px; color: #006d5b; font-size: 18px; }
    h4, h5, h6 { margin-top: 18px; color: #172126; font-size: 16px; }
    p { margin: 10px 0; }
    li { margin: 6px 0; }
    table { width: 100%; margin: 18px 0; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 9px 10px; border: 1px solid #dce2dd; text-align: left; vertical-align: top; }
    th { background: #eef5f2; color: #01483f; }
    pre { overflow-x: auto; padding: 14px; border-radius: 8px; background: #f1f4f2; }
    code { font-family: Consolas, "Liberation Mono", monospace; font-size: 0.95em; }
    .meta { color: #627071; font-size: 13px; margin-bottom: 28px; }
    @media print { body { background: #fff; } main { margin: 0; border: 0; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">由山东大学求职助手生成 · ${new Date().toLocaleString("zh-CN")}</div>
    ${body}
  </main>
</body>
</html>`;
}

function markdownLiteToHtml(markdown) {
  const lines = normalizeMarkdown(markdown).split(/\r?\n/);
  const html = [];
  let inList = false;
  let listType = "";
  let inCode = false;
  let codeLines = [];

  const closeList = () => {
    if (!inList) return;
    html.push(`</${listType}>`);
    inList = false;
    listType = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      closeList();
      continue;
    }

    const table = readMarkdownTable(lines, index);
    if (table) {
      closeList();
      html.push(renderMarkdownTable(table.rows));
      index = table.endIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList || listType !== "ul") {
        closeList();
        html.push("<ul>");
        inList = true;
        listType = "ul";
      }
      html.push(`<li>${formatInline(bullet[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (!inList || listType !== "ol") {
        closeList();
        html.push("<ol>");
        inList = true;
        listType = "ol";
      }
      html.push(`<li>${formatInline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${formatInline(trimmed)}</p>`);
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeList();
  return html.join("\n");
}

function normalizeMarkdown(markdown) {
  return String(markdown || "")
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["'`]+markdown\s*/i, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function readMarkdownTable(lines, startIndex) {
  const header = lines[startIndex]?.trim();
  const divider = lines[startIndex + 1]?.trim();
  if (!isTableRow(header) || !isTableDivider(divider)) return null;

  const rows = [parseTableRow(header)];
  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index]?.trim())) {
    rows.push(parseTableRow(lines[index].trim()));
    index += 1;
  }

  return { rows, endIndex: index - 1 };
}

function isTableRow(line) {
  return Boolean(line && line.includes("|") && line.split("|").length >= 3);
}

function isTableDivider(line) {
  if (!isTableRow(line)) return false;
  return parseTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderMarkdownTable(rows) {
  const [head, ...body] = rows;
  return `<table><thead><tr>${head.map((cell) => `<th>${formatInline(cell)}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${formatInline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function handleChat(req, res) {
  const payload = await readJsonBody(req);
  const config = getAgentConfig(payload.mode);

  if (!config.apiKey) {
    sendSse(res, {
      type: "error",
      message: "缺少 AGENT_API_KEY 环境变量，无法连接智能 Agent。"
    });
    res.end();
    return;
  }

  const message = String(payload.message || "").trim();
  const contextId = payload.contextId ? String(payload.contextId) : undefined;

  if (!message) {
    sendJson(res, 400, { error: "消息不能为空。" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });

  const rpcBody = {
    id: crypto.randomUUID(),
    jsonrpc: "2.0",
    method: "message/stream",
    params: {
      message: {
        kind: "message",
        parts: [{ kind: "text", text: message }],
        role: "user",
        messageId: crypto.randomUUID(),
        ...(contextId ? { contextId } : {})
      }
    }
  };

  const controller = new AbortController();
  const timeout = chatTimeoutMs > 0 ? setTimeout(() => controller.abort(), chatTimeoutMs) : null;

  let upstream;
  try {
    upstream = await fetch(await getAgentUrl(config.mode), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(rpcBody),
      signal: controller.signal
    });
  } catch (error) {
    clearOptionalTimeout(timeout);
    sendSse(res, {
      type: "error",
      message:
        error.name === "AbortError"
          ? "Agent 请求超时，已停止等待。"
          : `Agent 请求失败：${error.message}`
    });
    res.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    clearOptionalTimeout(timeout);
    const detail = await upstream.text().catch(() => "");
    sendSse(res, {
      type: "error",
      message: `Agent 请求失败：${upstream.status} ${upstream.statusText}`,
      detail: detail.slice(0, 500)
    });
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const streamState = {
    snapshots: new Map(),
    documents: new Set(),
    mainEmitted: false,
    fallbackText: "",
    failedTasks: new Map()
  };

  try {
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        const parsed = parseSseData(event);
        if (!parsed) continue;
        forwardAgentPacket(parsed, streamState, res);
      }
    }
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "\n\n本次上游任务执行时间较长，已自动停止等待。"
        : `\n\n上游连接中断：${error.message}`;
    sendSse(res, { type: "main_delta", text: message });
  } finally {
    clearOptionalTimeout(timeout);
  }

  if (buffer.trim()) {
    const parsed = parseSseData(buffer);
    if (parsed) forwardAgentPacket(parsed, streamState, res);
  }

  if (!streamState.mainEmitted) {
    const fallback = buildFallbackAnswer(streamState);
    if (fallback) {
      sendSse(res, { type: "main_delta", text: fallback });
    }
  }

  sendSse(res, { type: "done" });
  res.end();
}

function getAgentConfig(mode) {
  const normalized = mode === "fast" ? "fast" : "performance";
  if (normalized === "fast") {
    return {
      mode: "fast",
      label: "极速版",
      apiKey: fastAgentApiKey,
      baseUrl: fastAgentBaseUrl,
      cardUrl: fastAgentCardUrl
    };
  }

  return {
    mode: "performance",
    label: "高性能",
    apiKey,
    baseUrl: agentBaseUrl,
    cardUrl: agentCardUrl
  };
}

async function getAgentUrl(mode) {
  const config = getAgentConfig(mode);
  if (config.baseUrl) return config.baseUrl;

  let cachedAgentCard = cachedAgentCards.get(config.mode);
  if (!cachedAgentCard) {
    const response = await fetch(config.cardUrl, {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}`, "X-Appbuilder-Authorization": `Bearer ${config.apiKey}` }
        : {}
    });
    cachedAgentCard = await response.json();
    cachedAgentCards.set(config.mode, cachedAgentCard);
  }

  return cachedAgentCard.url;
}

function forwardAgentPacket(parsed, streamState, res) {
  const extracted = extractAgentEvent(parsed, streamState);
  for (const step of extracted.steps) {
    sendSse(res, { type: "step", ...step });
  }

  if (extracted.text) {
    if (extracted.channel === "main") {
      sendSse(res, { type: "main_delta", text: extracted.text });
    } else {
      sendSse(res, {
        type: "subagent_delta",
        id: extracted.id,
        title: extracted.title,
        status: extracted.status,
        text: extracted.text
      });
    }
  }

  for (const document of extracted.documents) {
    sendSse(res, { type: "document", document });
  }

  if (extracted.contextId || extracted.taskId) {
    sendSse(res, {
      type: "meta",
      contextId: extracted.contextId,
      taskId: extracted.taskId
    });
  }

  // Only emit done after the upstream stream is actually closed.
  // Some A2A status events can arrive before trailing artifacts in AppBuilder streams.
}

function clearOptionalTimeout(timeout) {
  if (timeout) clearTimeout(timeout);
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(publicDir, cleanPath));

  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(404, { "content-type": mimeTypes[".html"] });
    res.end(fallback);
  }
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("Request body too large");
    }
  }
  return body ? JSON.parse(body) : {};
}

function parseSseData(event) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;

  try {
    return JSON.parse(data);
  } catch {
    return { raw: data };
  }
}

function extractAgentEvent(packet, streamState) {
  const result = packet.result || packet;
  const artifact = result.artifact || result.artifacts?.at?.(-1) || result.aritfacts?.at?.(-1);
  const metadata = artifact?.metadata || result.metadata || {};
  const event = metadata.event || {};
  const artifactName = artifact?.name || event.name || metadata.name || "agent-event";
  const parts = artifact?.parts || result.parts || result.status?.message?.parts || [];
  const rawText = extractTextParts(parts);
  const channel = isMainArtifact(artifactName, event) ? "main" : "subagent";
  const id = event.id || artifact?.artifactId || artifactName;
  const title = buildAgentTitle(artifactName, event, metadata);
  const snapshotKey = `${channel}:${id}:${artifactName}`;
  const text = computeTextDelta(rawText, Boolean(result.append), snapshotKey, streamState);
  const status = getDisplayStatus(result, metadata, event);
  const errorMessage =
    status === "error" ? normalizeErrorMessage(event.error_message || event.error || result.error?.message) : "";
  const failedTaskName = extractFailedTaskName(`${errorMessage}\n${rawText}\n${text}`);
  const cleanText = errorMessage ? normalizeErrorText(text, errorMessage) : sanitizeInternalText(text, artifactName);

  if (cleanText) {
    if (channel === "main") {
      if (isUsefulMainText(cleanText)) {
        streamState.mainEmitted = true;
      }
    } else if (isFallbackCandidate(artifactName)) {
      streamState.fallbackText += cleanText;
    } else if (isUserFacingAnswer(cleanText)) {
      streamState.fallbackText += cleanText;
    }
  }

  return {
    text: channel === "main" && !isUsefulMainText(cleanText) ? "" : cleanText,
    id,
    title,
    status,
    channel,
    steps: buildSteps(artifactName, event, status, errorMessage, failedTaskName),
    documents: extractDocuments(packet, streamState),
    final: Boolean(result.kind === "status-update" && (result.final || result.status?.state === "completed")),
    contextId: result.contextId,
    taskId: result.taskId
  };
}

function extractTextParts(parts) {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.text || "";
      if (typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("");
}

function isUsefulMainText(text) {
  const value = String(text || "").trim();
  return Boolean(value && value !== '""' && value !== "''" && value !== "null");
}

function buildFallbackAnswer(streamState) {
  const fallback = streamState.fallbackText.trim();
  if (fallback && isUsefulMainText(fallback)) return fallback;

  if (streamState.failedTasks.size) {
    const lines = [...streamState.failedTasks.values()].map(
      (task) => `- ${task.title}：${task.reason.replace(/^失败原因：/, "")}`
    );
    return `本次任务的部分工具调用没有成功，但主流程仍可继续。工具信息：\n${lines.join("\n")}`;
  }

  return "";
}

function computeTextDelta(text, append, key, streamState) {
  if (!text) return "";
  if (append) return text;

  const previous = streamState.snapshots.get(key) || "";
  streamState.snapshots.set(key, text);

  if (text.startsWith(previous)) {
    return text.slice(previous.length);
  }

  return text === previous ? "" : text;
}

function isMainArtifact(name, event) {
  if (event.task_id || event.task_name) return false;
  return ["/chat/summary", "/final_result", "/answer", "/chat/final"].includes(name);
}

function isFallbackCandidate(name) {
  return ["/chat/chat_agent", "/chat/summary", "/final_result"].includes(name);
}

function buildAgentTitle(name, event, metadata) {
  const detailName = metadata.render?.component_detail?.name;
  const baseName = detailName || friendlyArtifactName(name);
  return event.task_name ? `${baseName} · ${event.task_name}` : baseName;
}

function friendlyArtifactName(name) {
  const names = {
    "/thought/plan": "任务规划 Agent",
    "/thought/action": "任务执行 Agent",
    "/chat/chat_agent": "子 Agent 回复",
    "/chat/summary": "主 Agent 汇总"
  };
  return names[name] || name.replace(/^\//, "").replaceAll("/", " / ");
}

function buildSteps(name, event, status, errorMessage, failedTaskName) {
  const isPlanEvent = name === "/thought/plan";
  const title =
    failedTaskName || event.task_name || (name === "/chat/summary" ? "主 Agent 汇总输出" : friendlyArtifactName(name));
  const isGenericPlanFailure = isPlanEvent && status === "error" && !failedTaskName && isGenericFailure(errorMessage);

  if (isGenericPlanFailure) return [];

  const id = normalizeStepId(title || event.task_id || event.id || name);

  if (!title || title === "agent-event") return [];

  return [
    {
      id,
      title,
      status,
      agent: friendlyArtifactName(name),
      errorMessage
    }
  ];
}

function normalizeStepId(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/^Task:/i, "")
    .replace(/执行失败$/, "")
    .trim();
}

function normalizeStatus(status) {
  const value = String(status || "running").toLowerCase();
  if (["done", "completed", "success", "succeeded"].includes(value)) return "done";
  if (["error", "failed", "rejected"].includes(value)) return "error";
  if (["preparing", "pending", "created", "submitted"].includes(value)) return "preparing";
  return "running";
}

function getDisplayStatus(result, metadata, event) {
  if (result.kind === "status-update") {
    return normalizeStatus(result.status?.state || (result.final ? "completed" : "working"));
  }

  if (metadata.is_event_done || result.lastChunk || event.status === "done") {
    return "done";
  }

  if (event.status === "preparing") {
    return "preparing";
  }

  if (event.status === "error") {
    return "running";
  }

  // AppBuilder artifact event.status can describe an internal component event.
  // It is not the A2A task status; only status-update.state is authoritative for failure.
  return "running";
}

function normalizeErrorMessage(message) {
  if (!message) return "";
  return String(message)
    .replace(/^requestID=,\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFailedTaskName(message) {
  const value = String(message || "");
  const match = value.match(/Task:\s*(.+?)\s*执行失败/);
  return match?.[1]?.trim() || "";
}

function normalizeErrorText(text, errorMessage) {
  const cleaned = String(text || "")
    .replace(/任务执行失败/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return `失败原因：${errorMessage}`;
  if (cleaned.includes(errorMessage)) return cleaned;
  return `${cleaned}\n失败原因：${errorMessage}`;
}

function sanitizeInternalText(text, artifactName) {
  const value = String(text || "");
  if (isInternalToolFailure(value)) return "";
  if (artifactName === "/thought/plan") return "";
  return value;
}

function isInternalToolFailure(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return (
    isGenericFailure(value) ||
    /^Agent 执行失败/.test(value) ||
    /Access denied due to overdue account/i.test(value) ||
    /mcp_server_.*执行失败/.test(value)
  );
}

function isUserFacingAnswer(text) {
  const value = String(text || "").trim();
  if (value.length < 80) return false;
  if (isInternalToolFailure(value)) return false;
  return /建议|岗位|投递|实习|简历|面试|策略|阶段|渠道/.test(value);
}

function isGenericFailure(message) {
  const value = String(message || "")
    .replace(/\s+/g, "")
    .replace(/失败原因：/g, "");
  return !value || value === "任务执行失败" || value === "执行失败";
}

function extractDocuments(packet, streamState) {
  const docs = [];
  const result = packet.result || packet;
  const artifact = result.artifact || result.artifacts?.at?.(-1) || result.aritfacts?.at?.(-1);
  const parts = artifact?.parts || result.parts || result.status?.message?.parts || [];
  const metadata = artifact?.metadata || result.metadata || {};

  collectPartDocuments(parts, docs);
  collectTypedMetadataDocuments(metadata, docs);

  return docs
    .map((doc) => ({
      title: String(doc.title || doc.name || doc.url || "参考文档").slice(0, 120),
      url: doc.url,
      snippet: doc.snippet ? String(doc.snippet).slice(0, 180) : ""
    }))
    .filter((doc) => doc.url && /^https?:\/\//i.test(doc.url))
    .filter((doc) => !isIconOrSdkAsset(doc.url))
    .filter((doc) => {
      const key = `${doc.title}|${doc.url}`;
      if (streamState.documents.has(key)) return false;
      streamState.documents.add(key);
      return true;
    });
}

function collectPartDocuments(parts, docs) {
  for (const part of parts || []) {
    if (part.kind === "file" && part.file?.uri) {
      docs.push({
        title: part.file.name || getUrlFileName(part.file.uri) || "生成文件",
        url: part.file.uri,
        snippet: part.file.mime || ""
      });
    }

    if (part.kind === "data") {
      collectTypedMetadataDocuments(part.data, docs);
      collectTypedMetadataDocuments(part.metadata, docs);
    }
  }
}

function collectTypedMetadataDocuments(metadata, docs) {
  if (!metadata || typeof metadata !== "object") return;
  const type = String(metadata.type || metadata.name || "").toLowerCase();
  const explicitDocType = ["files", "file", "urls", "url", "references", "reference"].includes(type);

  if (explicitDocType) {
    collectDocuments(metadata.text || metadata.data || metadata.raw_data || metadata, docs);
    return;
  }

  if (metadata.file?.uri) {
    docs.push({
      title: metadata.file.name || getUrlFileName(metadata.file.uri) || "生成文件",
      url: metadata.file.uri,
      snippet: metadata.file.mime || ""
    });
  }

  const text = metadata.text;
  if (text && typeof text === "object") {
    const possibleLists = [text.files, text.urls, text.references, text.items, text.list].filter(Boolean);
    for (const list of possibleLists) collectDocuments(list, docs);
  }
}

function collectDocuments(value, docs, siblings = {}) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) collectDocuments(item, docs);
    return;
  }

  if (typeof value === "string") {
    const matches = value.match(/https?:\/\/[^\s"'<>，。)）\]]+/g) || [];
    for (const url of matches) {
      docs.push({
        title: siblings.title || siblings.name || siblings.source || url,
        url,
        snippet: siblings.snippet || siblings.summary || siblings.content || ""
      });
    }
    return;
  }

  if (typeof value !== "object") return;

  const possibleUrl = value.url || value.href || value.link || value.uri || value.source_url || value.document_url;
  if (typeof possibleUrl === "string") {
    docs.push({
      title: value.title || value.name || value.filename || value.source || possibleUrl,
      url: possibleUrl,
      snippet: value.snippet || value.summary || value.content || value.description || ""
    });
  }

  const nextSiblings = {
    title: value.title || value.name || value.filename || siblings.title,
    name: value.name || siblings.name,
    source: value.source || siblings.source,
    snippet: value.snippet || value.summary || value.description || siblings.snippet,
    content: value.content || siblings.content
  };

  for (const child of Object.values(value)) {
    collectDocuments(child, docs, nextSiblings);
  }
}

function getUrlFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function isIconOrSdkAsset(url) {
  const value = String(url || "").toLowerCase();
  return (
    /\/agi-dev-platform-sdk\//.test(value) ||
    /reportwriting\.png$/.test(value) ||
    /\/(icon|icons|logo|avatar)\//.test(value) ||
    /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/.test(value)
  );
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
