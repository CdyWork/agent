const agentStatus = document.querySelector("#agentStatus");
const skillList = document.querySelector("#skillList");
const newsGrid = document.querySelector("#newsGrid");
const linkGroups = document.querySelector("#linkGroups");
const messages = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const agentModeToggle = document.querySelector("#agentModeToggle");

let conversationMeta = {};
let agentMode = localStorage.getItem("sduAgentMode") === "fast" ? "fast" : "performance";

const fallbackSkills = [
  {
    name: "岗位搜索Agent",
    description: "互联网招聘信息搜索、岗位JD解析、企业背景调查、薪资区间分析以及技能关键词提取。"
  },
  {
    name: "简历优化Agent",
    description: "简历内容优化、项目经历润色、STAR法则改写、简历生成以及ATS友好化处理。"
  },
  {
    name: "面试辅导Agent",
    description: "技术面试辅导、八股文解析、算法题思路分析、项目深挖追问以及模拟面试交互。"
  },
  {
    name: "职业规划Agent",
    description: "职业方向分析、学习路线规划、技能成长评估、行业趋势研究以及岗位能力差距分析。"
  },
  {
    name: "数据分析Agent",
    description: "招聘数据统计、薪资数据分析、可视化图表生成以及结构化数据整理。"
  },
  {
    name: "输出审核Agent",
    description: "多Agent输出结果的逻辑检查、格式修复、内容纠错、结构优化以及专业性审核。"
  },
  {
    name: "网页探索Agent",
    description: "支持网页浏览、信息查询、内容筛选和求职渠道信息检索。"
  },
  {
    name: "代码编写Agent",
    description: "支持生成并运行代码，完成数据处理、数据分析、可视化和格式转换。"
  }
];

const newsItems = [
  {
    date: "2026-05-13",
    title: "关于组织在读研究生赴苏州参加校园引智活动的通知",
    summary: "面向暑期就业实习与城市引才场景，可作为研究生了解区域产业机会的入口。",
    href: "https://www.job.sdu.edu.cn/info/1024/33856.htm"
  },
  {
    date: "2026-05-07",
    title: "关于选拔优秀学生赴天津市武清区开展社会实践的报名通知",
    summary: "适合关注政务见习、基层实践与公共服务职业路径的同学重点查看。",
    href: "https://www.job.sdu.edu.cn/info/1019/33853.htm"
  },
  {
    date: "2026-03-05",
    title: "津鲁五校2026届毕业生春季就业双选会山东大学专场邀请函",
    summary: "春招阶段的重要双选会信息，可配合求职助手进行岗位筛选和投递准备。",
    href: "https://www.job.sdu.edu.cn/info/1024/33767.htm"
  },
  {
    date: "2026-01-26",
    title: "山东大学2026年春季学期校园招聘邀请函",
    summary: "校园招聘安排与单位入校信息的核心公告，建议毕业生持续关注。",
    href: "https://www.job.sdu.edu.cn/info/1024/33747.htm"
  },
  {
    date: "2025-05-08",
    title: "解锁春招密码，决胜求职之路",
    summary: "就业指导类内容，适合用于完善简历、投递节奏与面试策略。",
    href: "https://www.job.sdu.edu.cn/info/1066/33380.htm"
  },
  {
    date: "2025-04-17",
    title: "毕业求职套路多，提高警惕防诈骗",
    summary: "求职安全提醒，投递、签约和缴费相关场景建议先核验官方渠道。",
    href: "https://www.job.sdu.edu.cn/info/1066/33383.htm"
  }
];

const officialLinks = [
  {
    title: "山东大学官方",
    links: [
      ["山东大学就业信息网", "https://www.job.sdu.edu.cn/"],
      ["山东大学主页", "https://www.sdu.edu.cn/"],
      ["学生登录就业平台", "https://jobcareer.sdu.edu.cn/eweb/jygl/index/sddxLogin.jsp?u=1"],
      ["山东大学简历制作", "https://cv.qiaobutang.com/account/login/sdu"]
    ]
  },
  {
    title: "就业主管部门",
    links: [
      ["国家大学生就业服务平台", "https://www.ncss.cn/"],
      ["教育部", "http://www.moe.gov.cn/"],
      ["中国公共招聘网", "http://job.mohrss.gov.cn/"],
      ["山东高校毕业生就业信息网", "http://www.sdgxbys.cn/"]
    ]
  },
  {
    title: "招聘与实习",
    links: [
      ["国聘", "https://www.iguopin.com/"],
      ["24365校园招聘", "https://job.ncss.cn/student/24365"],
      ["智联校园招聘", "https://xiaoyuan.zhaopin.com/"],
      ["应届生求职网", "http://www.yingjiesheng.com/"]
    ]
  }
];

renderNews();
renderLinks();
updateAgentModeToggle();
loadAgentCard();

agentModeToggle?.addEventListener("click", () => {
  agentMode = agentMode === "fast" ? "performance" : "fast";
  localStorage.setItem("sduAgentMode", agentMode);
  conversationMeta = {};
  updateAgentModeToggle();
  loadAgentCard();
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt;
    messageInput.focus();
  });
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  messageInput.value = "";
  await sendChat(text);
});

async function loadAgentCard() {
  try {
    const response = await fetch(`/api/agent-card?mode=${encodeURIComponent(agentMode)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const card = await response.json();
    agentStatus.textContent = `${agentModeLabel()} · ${card.capabilities?.streaming ? "已连接 · 流式" : "已连接"}`;
    agentStatus.classList.remove("error");
    renderSkills(fallbackSkills);
  } catch {
    agentStatus.textContent = `${agentModeLabel()} · 元数据未连接`;
    agentStatus.classList.add("error");
    renderSkills(fallbackSkills);
  }
}

async function sendChat(text) {
  sendButton.disabled = true;
  messageInput.disabled = true;
  const responseView = appendAssistantResponse();
  let streamDone = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, mode: agentMode })
    });

    if (!response.ok || !response.body) {
      const error = await response.text();
      throw new Error(error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        const payload = parseClientEvent(event);
        if (!payload) continue;

        if (payload.type === "main_delta" || payload.type === "delta") {
          responseView.main.textContent += payload.text;
          responseView.mainEmpty.hidden = true;
          messages.scrollTop = messages.scrollHeight;
        }

        if (payload.type === "subagent_delta") {
          updateSubAgent(responseView, payload);
          messages.scrollTop = messages.scrollHeight;
        }

        if (payload.type === "step") {
          updateStep(responseView, payload);
        }

        if (payload.type === "document") {
          addDocument(responseView, payload.document);
        }

        if (payload.type === "meta") {
          conversationMeta = {};
        }

        if (payload.type === "error") {
          responseView.main.textContent = payload.message;
          responseView.mainEmpty.hidden = true;
          if (payload.detail) responseView.main.textContent += `\n${payload.detail}`;
        }

        if (payload.type === "done") {
          streamDone = true;
        }
      }
    }

    if (!responseView.main.textContent.trim()) {
      responseView.mainEmpty.hidden = true;
      responseView.main.textContent = "已收到请求，但暂时没有解析到主 Agent 的最终文本回复。可以展开子 Agent 过程查看执行细节。";
    } else if (!streamDone) {
      responseView.main.textContent += "\n\n[连接已中断，回答可能未完整。]";
    }

    await createLocalReport(responseView);
  } catch (error) {
    responseView.mainEmpty.hidden = true;
    responseView.main.textContent = `连接失败：${error.message}`;
  } finally {
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

function updateAgentModeToggle() {
  if (!agentModeToggle) return;
  const label = agentModeLabel();
  agentModeToggle.classList.toggle("is-fast", agentMode === "fast");
  agentModeToggle.setAttribute("aria-pressed", String(agentMode === "fast"));
  agentModeToggle.querySelector("span").textContent = label;
  agentModeToggle.querySelector("small").textContent = agentMode === "fast" ? "快速响应" : "智能调度";
  agentModeToggle.title = `当前：${label}，点击切换${agentMode === "fast" ? "高性能" : "极速版"}`;
}

function agentModeLabel() {
  return agentMode === "fast" ? "极速版" : "高性能";
}

function appendMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "你" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  article.append(avatar, bubble);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function appendAssistantResponse() {
  const article = document.createElement("article");
  article.className = "message assistant";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble response-bubble";

  const steps = document.createElement("section");
  steps.className = "flow-panel";
  steps.innerHTML = `
    <div class="response-title">任务流程</div>
    <ol class="flow-list"></ol>
  `;

  const details = document.createElement("details");
  details.className = "subagent-panel";
  details.innerHTML = `
    <summary>
      <span>子 Agent 执行内容</span>
      <small>默认折叠，点击查看</small>
    </summary>
    <div class="subagent-list"></div>
  `;

  const final = document.createElement("section");
  final.className = "main-answer";
  final.innerHTML = `
    <div class="response-title">主 Agent 最终输出</div>
    <p class="empty-state">等待主 Agent 汇总...</p>
    <div class="answer-text"></div>
  `;

  const documents = document.createElement("section");
  documents.className = "document-panel";
  documents.innerHTML = `
    <div class="response-title">报告与引用</div>
    <p class="empty-state">暂无可打开的报告文件</p>
    <div class="document-list"></div>
  `;

  bubble.append(steps, details, final, documents);
  article.append(avatar, bubble);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;

  return {
    bubble,
    stepList: steps.querySelector(".flow-list"),
    subagentList: details.querySelector(".subagent-list"),
    main: final.querySelector(".answer-text"),
    mainEmpty: final.querySelector(".empty-state"),
    documentList: documents.querySelector(".document-list"),
    documentEmpty: documents.querySelector(".empty-state"),
    steps: new Map(),
    subagents: new Map(),
    documents: new Set()
  };
}

async function createLocalReport(view) {
  const content = view.main.textContent.trim();
  if (!content || content.startsWith("连接失败：")) return;

  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "山东大学求职助手报告",
        content
      })
    });

    if (!response.ok) return;
    const report = await response.json();
    addDocument(view, {
      title: "本地HTML报告",
      url: report.url,
      snippet: report.filename,
      kind: "report"
    }, true);
  } catch {
    // Report generation is a convenience feature; chat output remains available.
  }
}

function updateStep(view, payload) {
  if (isGenericPlanFailure(payload)) return;

  const id = stepKey(payload);
  if (!id) return;

  let item = view.steps.get(id);
  if (!item) {
    item = document.createElement("li");
    item.className = "flow-step";
    item.innerHTML = `
      <span class="step-dot"></span>
      <div>
        <strong></strong>
        <small></small>
        <div class="step-progress" aria-hidden="true"><span></span></div>
      </div>
    `;
    view.steps.set(id, item);
    view.stepList.append(item);
  }

  if (payload.status === "error") {
    view.stepList.append(item);
  }

  item.dataset.status = payload.status || "running";
  updateStepProgress(item, payload.status);
  item.querySelector("strong").textContent = payload.title || "任务步骤";
  const detail = payload.errorMessage
    ? `${statusLabel(payload.status)} · ${payload.agent || "Agent"} · ${payload.errorMessage}`
    : `${statusLabel(payload.status)} · ${payload.agent || "Agent"}`;
  item.querySelector("small").textContent = detail;
}

function stepKey(payload) {
  return String(payload.title || payload.id || "")
    .replace(/\s+/g, "")
    .replace(/^Task:/i, "")
    .replace(/执行失败$/, "")
    .trim();
}

function isGenericPlanFailure(payload) {
  return payload.status === "error" && payload.title === "任务规划 Agent" && !payload.errorMessage;
}

function updateSubAgent(view, payload) {
  const id = payload.id || payload.title || "subagent";
  let panel = view.subagents.get(id);

  if (!panel) {
    panel = document.createElement("article");
    panel.className = "subagent-card";
    panel.innerHTML = `
      <div class="subagent-head">
        <strong></strong>
        <span></span>
      </div>
      <pre></pre>
    `;
    view.subagents.set(id, panel);
    view.subagentList.append(panel);
  }

  panel.querySelector("strong").textContent = payload.title || "子 Agent";
  panel.querySelector("span").textContent = statusLabel(payload.status);
  panel.querySelector("pre").textContent += payload.text || "";
}

function addDocument(view, doc, prepend = false) {
  if (!doc?.url || isIconOrSdkAsset(doc.url) || view.documents.has(doc.url)) return;

  view.documents.add(doc.url);
  view.documentEmpty.hidden = true;

  const link = document.createElement("a");
  link.href = previewUrlForDocument(doc);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "document-link";
  link.innerHTML = `
    <strong>${escapeHtml(doc.title || "参考文档")}</strong>
    ${doc.snippet ? `<small>${escapeHtml(doc.snippet)}</small>` : ""}
    <em>${documentActionLabel(doc)}</em>
  `;
  if (prepend) {
    view.documentList.prepend(link);
  } else {
    view.documentList.append(link);
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a.document-link");
  if (!link || !isIconOrSdkAsset(link.href)) return;

  event.preventDefault();
  alert("这个链接是 Agent 图标资源，不是生成的报告文档。请重新生成报告或查看主输出中的正文内容。");
});

function documentActionLabel(doc) {
  const value = String(doc?.url || doc || "").toLowerCase();
  if (value.startsWith("/reports/")) return "打开报告";
  if (isMarkdownDocument(doc)) return "预览Markdown";
  if (/\.(html?|md|pdf|docx?|xlsx?|csv|json)(\?|$)/.test(value)) return "打开文档";
  return "打开链接";
}

function previewUrlForDocument(doc) {
  const url = typeof doc === "string" ? doc : doc?.url;
  if (isMarkdownDocument(doc)) {
    return `/api/preview-markdown?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function isMarkdownDocument(doc) {
  const parts =
    typeof doc === "string"
      ? [doc]
      : [doc?.url, doc?.title, doc?.filename, doc?.name, doc?.kind];
  return parts.some((part) => /\.md(?:$|[?#\s])|markdown/i.test(String(part || "")));
}

function isIconOrSdkAsset(url) {
  const value = String(url || "").toLowerCase();
  return (
    value.includes("/agi-dev-platform-sdk/") ||
    value.endsWith("/reportwriting.png") ||
    /\/(icon|icons|logo|avatar)\//.test(value) ||
    /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/.test(value)
  );
}

function statusLabel(status) {
  const labels = {
    preparing: "准备中",
    running: "执行中",
    done: "已完成",
    error: "失败"
  };
  return labels[status] || "执行中";
}

function updateStepProgress(item, status) {
  const current = Number(item.dataset.progress || 0);
  clearStepProgressTimer(item);

  if (status === "done") {
    animateStepProgress(item, Math.max(current, 100), 100, 18);
    return;
  }

  if (status === "error") {
    animateStepProgress(item, Math.max(current, 100), 100, 12);
    return;
  }

  if (status === "preparing") {
    animateStepProgress(item, Math.max(current, 16), 16, 1.5);
    return;
  }

  const cap = 88;
  let value = Math.max(current, 22);
  setStepProgress(item, value);

  const timer = window.setInterval(() => {
    if (value >= cap) {
      clearStepProgressTimer(item);
      return;
    }

    const remaining = cap - value;
    const increment = Math.max(0.4, Math.min(2.2, remaining * 0.08));
    value = Math.min(cap, value + increment);
    setStepProgress(item, value);
  }, 450);

  item.dataset.progressTimer = String(timer);
}

function animateStepProgress(item, start, target, step) {
  let value = Math.min(start, target);
  setStepProgress(item, value);

  const timer = window.setInterval(() => {
    value = Math.min(target, value + step);
    setStepProgress(item, value);

    if (value >= target) {
      clearStepProgressTimer(item);
    }
  }, 45);

  item.dataset.progressTimer = String(timer);
}

function setStepProgress(item, value) {
  const bounded = Math.max(0, Math.min(100, value));
  item.dataset.progress = String(bounded);
  item.style.setProperty("--step-progress", `${bounded}%`);
}

function clearStepProgressTimer(item) {
  const timer = Number(item.dataset.progressTimer || 0);
  if (timer) {
    window.clearInterval(timer);
    delete item.dataset.progressTimer;
  }
}

function parseClientEvent(event) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function renderSkills(skills) {
  skillList.replaceChildren(
    ...skills.map((skill) => {
      const card = document.createElement("article");
      card.className = "skill-card";
      card.innerHTML = `<h3>${escapeHtml(skill.name)}</h3><p>${escapeHtml(skill.description || "")}</p>`;
      return card;
    })
  );
}

function renderNews() {
  newsGrid.replaceChildren(
    ...newsItems.map((item) => {
      const card = document.createElement("article");
      card.className = "news-card";
      card.innerHTML = `
        <div>
          <time datetime="${item.date}">${item.date}</time>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <a href="${item.href}" target="_blank" rel="noreferrer">查看详情</a>
      `;
      return card;
    })
  );
}

function renderLinks() {
  linkGroups.replaceChildren(
    ...officialLinks.map((group) => {
      const section = document.createElement("section");
      section.className = "link-group";
      section.innerHTML = `
        <h3>${escapeHtml(group.title)}</h3>
        ${group.links
          .map(
            ([label, href]) =>
              `<a href="${href}" target="_blank" rel="noreferrer"><span>${escapeHtml(label)}</span><span>打开</span></a>`
          )
          .join("")}
      `;
      return section;
    })
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
