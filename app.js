const demoCode = `function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i].price;
  }
  return total;
}`;

const state = {
  user: JSON.parse(localStorage.getItem("acrUser") || "null"),
  reports: JSON.parse(localStorage.getItem("acrReports") || "[]"),
  activeView: "dashboard",
  inputMode: "paste",
  currentReport: null,
  backendOnline: false,
};

const app = document.getElementById("app");
const API_BASE = "http://127.0.0.1:8000";

function saveState() {
  localStorage.setItem("acrUser", JSON.stringify(state.user));
  localStorage.setItem("acrReports", JSON.stringify(state.reports));
}

function tokenFromEmail(email) {
  return btoa(`${email}:${Date.now()}`).replaceAll("=", "");
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.user?.token) {
    headers.Authorization = `Bearer ${state.user.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.detail || `Request failed with ${response.status}`);
  }

  state.backendOnline = true;
  return response.json();
}

async function syncReportsFromBackend() {
  if (!state.user?.token) return;

  try {
    const reports = await apiFetch("/reports");
    state.reports = reports;
    state.currentReport = reports[0] || state.currentReport;
    saveState();
  } catch {
    state.backendOnline = false;
  }
}

function detectLanguage(fileName, source, repoUrl) {
  const name = `${fileName || repoUrl || ""}`.toLowerCase();
  if (name.endsWith(".py") || source.includes("def ")) return "Python";
  if (name.endsWith(".cpp") || source.includes("#include")) return "C++";
  if (name.endsWith(".java") || source.includes("public class")) return "Java";
  if (name.endsWith(".ts")) return "TypeScript";
  if (name.endsWith(".js") || source.includes("function ")) return "JavaScript";
  return "Mixed";
}

function analyzeCode({ source, fileName, repoUrl }) {
  const language = detectLanguage(fileName, source, repoUrl);
  const lines = source.split("\n").length;
  const riskyLoop = source.includes("<=") && source.includes(".length");
  const hasEval = source.includes("eval(") || source.includes("innerHTML");
  const noTryCatch = !source.includes("try") && !source.includes("catch");
  const hardcodedSecret = /api[_-]?key|password|secret/i.test(source);
  const bugCount = [riskyLoop, noTryCatch].filter(Boolean).length + (lines > 160 ? 1 : 0);
  const securityCount = [hasEval, hardcodedSecret].filter(Boolean).length;
  const performanceCount = lines > 80 ? 2 : 1;
  const cleanCodePenalty = source.length > 1800 ? 12 : 5;
  const score = Math.max(58, 96 - bugCount * 9 - securityCount * 12 - performanceCount * 4 - cleanCodePenalty);

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: fileName || (repoUrl ? repoUrl.replace(/^https?:\/\//, "") : "Pasted source code"),
    language,
    createdAt: new Date().toLocaleString(),
    score,
    metrics: {
      Bugs: Math.max(0, 100 - bugCount * 28),
      Security: Math.max(0, 100 - securityCount * 34),
      Performance: Math.max(0, 100 - performanceCount * 15),
      CleanCode: Math.max(0, 100 - cleanCodePenalty),
    },
    bugs: riskyLoop
      ? ["Possible off-by-one loop: using <= with array length can read an undefined item.", "Add input validation before accessing nested values."]
      : ["No critical syntax-level bug pattern found in this sample.", "Add tests around empty input and boundary cases."],
    warnings: [
      noTryCatch ? "No error handling block detected around risky operations." : "Error handling is present.",
      lines > 120 ? "Large file detected. Split into smaller modules for better review quality." : "File size is comfortable for focused review.",
    ],
    security: [
      hasEval ? "Avoid eval or direct innerHTML because they can enable injection attacks." : "No direct eval or innerHTML usage detected.",
      hardcodedSecret ? "A possible hardcoded credential was detected. Move secrets to environment variables." : "No obvious hardcoded secret pattern found.",
    ],
    suggestions: [
      "Add unit tests for invalid, empty, and large input cases.",
      "Use descriptive function names and keep each function focused on one job.",
      "Return structured errors from the backend so the dashboard can show precise fixes.",
    ],
    optimizedCode: buildOptimizedCode(language),
  };
}

function buildOptimizedCode(language) {
  if (language === "Python") {
    return `def calculate_total(items):\n    if not isinstance(items, list):\n        raise ValueError("items must be a list")\n\n    return sum(item.get("price", 0) for item in items)`;
  }

  return `function calculateTotal(items = []) {\n  if (!Array.isArray(items)) {\n    throw new TypeError("items must be an array");\n  }\n\n  return items.reduce((total, item) => total + Number(item.price || 0), 0);\n}`;
}

function render() {
  if (!state.user) {
    renderAuth();
    return;
  }
  renderApp();
}

function renderAuth(mode = "login") {
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-art">
        <div class="brand"><span class="brand-mark">AI</span><span>Code Reviewer</span></div>
        <div class="auth-copy">
          <h1>Review code faster with AI-backed reports.</h1>
          <p>Upload files, paste source code, or connect a GitHub repository URL to generate bug, security, performance, and clean-code feedback.</p>
        </div>
        <div class="flow-strip">
          <div class="flow-chip"><span>01</span>Validate input</div>
          <div class="flow-chip"><span>02</span>Analyze with Gemini</div>
          <div class="flow-chip"><span>03</span>Save MongoDB history</div>
          <div class="flow-chip"><span>04</span>Export reports</div>
        </div>
      </div>
      <div class="auth-panel">
        <form class="auth-card" id="authForm">
          <p class="eyebrow">${mode === "login" ? "Welcome back" : "Create account"}</p>
          <h2>${mode === "login" ? "Login" : "Sign up"}</h2>
          <p class="muted">Email authentication creates a demo JWT token for this project prototype.</p>
          <label class="field">Email
            <input id="email" type="email" placeholder="student@example.com" required />
          </label>
          <label class="field">Password
            <input id="password" type="password" placeholder="Minimum 6 characters" minlength="6" required />
          </label>
          <button class="primary full" type="submit">${mode === "login" ? "Login" : "Create account"}</button>
          <p class="auth-switch">
            ${mode === "login" ? "New user?" : "Already registered?"}
            <button class="link-button" id="toggleAuth" type="button">${mode === "login" ? "Sign up" : "Login"}</button>
          </p>
        </form>
      </div>
    </section>
  `;

  document.getElementById("toggleAuth").addEventListener("click", () => renderAuth(mode === "login" ? "signup" : "login"));
  document.getElementById("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      const authPath = mode === "login" ? "/auth/login" : "/auth/signup";
      state.user = await apiFetch(authPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      await syncReportsFromBackend();
    } catch {
      state.user = { email, token: tokenFromEmail(email), demo: true };
      state.backendOnline = false;
    }

    saveState();
    render();
  });
}

function renderApp() {
  const latest = state.currentReport || state.reports[0];
  app.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">AI</span><span>Code Reviewer</span></div>
        <nav class="nav">
          <button class="${state.activeView === "dashboard" ? "active" : ""}" data-view="dashboard">Dashboard</button>
          <button class="${state.activeView === "history" ? "active" : ""}" data-view="history">Reports</button>
          <button class="${state.activeView === "flow" ? "active" : ""}" data-view="flow">Flow</button>
        </nav>
        <div class="user-box">
          <strong>${state.user.email}</strong>
          <span class="muted">JWT: ${state.user.token.slice(0, 16)}...</span>
          <button class="ghost" id="logout">Logout</button>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div>
            <p class="eyebrow">FastAPI + Gemini API + ${state.backendOnline ? "Backend online" : "Demo fallback"}</p>
            <h1>${state.activeView === "dashboard" ? "Dashboard" : state.activeView === "history" ? "Previous Reports" : "Project Flow"}</h1>
          </div>
          <button class="secondary" id="sampleBtn">Load sample</button>
        </header>
        ${state.activeView === "dashboard" ? dashboardTemplate(latest) : state.activeView === "history" ? historyTemplate() : flowTemplate()}
      </div>
    </section>
  `;

  bindShellEvents();
  if (state.activeView === "dashboard") bindDashboardEvents();
}

function dashboardTemplate(latest) {
  const average = state.reports.length
    ? Math.round(state.reports.reduce((sum, report) => sum + report.score, 0) / state.reports.length)
    : 0;

  return `
    <section class="stats-grid">
      <div class="stat"><span>Total Reviews</span><strong>${state.reports.length}</strong></div>
      <div class="stat"><span>Average Score</span><strong>${average || "--"}</strong></div>
      <div class="stat"><span>Languages</span><strong>${new Set(state.reports.map((report) => report.language)).size || "--"}</strong></div>
      <div class="stat"><span>Exports Ready</span><strong>${latest ? "Yes" : "No"}</strong></div>
    </section>
    <section class="workspace">
      <div class="panel input-panel">
        <div class="panel-header">
          <div>
            <h2>Submit Code</h2>
            <p class="muted">Upload a file, paste source code, or enter a GitHub repository URL.</p>
          </div>
        </div>
        <div class="tabs">
          <button class="${state.inputMode === "upload" ? "active" : ""}" data-mode="upload">Upload</button>
          <button class="${state.inputMode === "paste" ? "active" : ""}" data-mode="paste">Paste</button>
          <button class="${state.inputMode === "repo" ? "active" : ""}" data-mode="repo">GitHub URL</button>
        </div>
        <form id="reviewForm">
          ${inputTemplate()}
          <div class="actions">
            <button class="primary" type="submit">Run AI Review</button>
            <button class="ghost" type="button" id="clearInput">Clear</button>
          </div>
          <div class="status-line" id="statusLine">Backend receives, validates, processes, and sends prompt to Gemini API.</div>
        </form>
      </div>
      <div class="panel">
        ${latest ? reportTemplate(latest) : `<div class="report-empty"><div><h2>No report yet</h2><p>Run a review to see bugs, warnings, security risks, charts, and export options.</p></div></div>`}
      </div>
    </section>
  `;
}

function inputTemplate() {
  if (state.inputMode === "upload") {
    return `
      <div class="drop-zone">
        <label class="field">Code file
          <input id="codeFile" type="file" accept=".py,.cpp,.c,.js,.ts,.java,.jsx,.tsx" />
        </label>
      </div>
    `;
  }

  if (state.inputMode === "repo") {
    return `
      <label class="field">GitHub repository URL
        <input id="repoUrl" type="url" placeholder="https://github.com/user/project" />
      </label>
      <label class="field">Optional entry file
        <textarea id="sourceCode" placeholder="Paste a key file if you want the demo analyzer to inspect code directly.">${demoCode}</textarea>
      </label>
    `;
  }

  return `
    <label class="field">Source code
      <textarea id="sourceCode" placeholder="Paste your source code here">${demoCode}</textarea>
    </label>
  `;
}

function reportTemplate(report) {
  return `
    <article class="report" id="reportArea">
      <div class="score-ring" style="--score: ${report.score}%"><span>${report.score}</span></div>
      <div class="panel-header">
        <div>
          <h2>${report.title}</h2>
          <p class="muted">${report.language} review generated ${report.createdAt}</p>
        </div>
        <span class="tag">Final Score ${report.score}/100</span>
      </div>
      <div class="report-section">
        <h3>Charts & Analytics</h3>
        <div class="chart">
          ${Object.entries(report.metrics).map(([name, value]) => `
            <div class="bar-row">
              <span>${name}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
              <strong>${value}</strong>
            </div>
          `).join("")}
        </div>
      </div>
      ${report.severity ? severityTemplate(report.severity, report.source) : ""}
      ${listSection("Bugs", report.bugs, "red")}
      ${listSection("Warnings", report.warnings, "amber")}
      ${listSection("Security Risks", report.security, "red")}
      ${listSection("Suggestions", report.suggestions, "green")}
      <div class="report-section">
        <h3>Optimized Code</h3>
        <pre class="optimized-code"><code>${escapeHtml(report.optimizedCode)}</code></pre>
      </div>
      <div class="actions">
        <button class="primary" id="downloadPdf" type="button">Download PDF</button>
        <button class="secondary" id="downloadDoc" type="button">Export DOC</button>
      </div>
    </article>
  `;
}

function severityTemplate(severity, source) {
  return `
    <div class="report-section">
      <h3>Severity Breakdown</h3>
      <div class="chart">
        ${Object.entries(severity).map(([name, value]) => `
          <div class="bar-row">
            <span>${name}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, value * 25)}%"></div></div>
            <strong>${value}</strong>
          </div>
        `).join("")}
      </div>
      <p class="muted">Source: ${source || "Frontend analyzer"}</p>
    </div>
  `;
}

function listSection(title, items, color) {
  return `
    <div class="report-section">
      <h3>${title}</h3>
      <ul class="issue-list">
        ${items.map((item) => `<li><span class="dot ${color}"></span><span>${item}</span></li>`).join("")}
      </ul>
    </div>
  `;
}

function historyTemplate() {
  if (!state.reports.length) {
    return `<div class="panel report-empty"><div><h2>No saved reports</h2><p>Review history will appear after your first analysis.</p></div></div>`;
  }

  return `
    <div class="history-list">
      ${state.reports.map((report) => `
        <div class="history-item">
          <div>
            <strong>${report.title}</strong>
            <span class="muted">${report.language} | ${report.createdAt}</span>
          </div>
          <button class="secondary" data-open-report="${report.id}">Open score ${report.score}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function flowTemplate() {
  const steps = [
    "User opens app and logs in with email authentication.",
    "JWT token is generated for protected dashboard actions.",
    "User uploads code, pastes source, or enters a GitHub repository URL.",
    "FastAPI backend validates input and stores temporary files.",
    "Processing engine detects language, cleans data, and splits large files.",
    "Gemini API receives a prompt to find bugs, vulnerabilities, performance issues, and clean-code improvements.",
    "Report generator formats AI response, charts, optimized code, and final score.",
    "MongoDB saves user info, uploaded files, review history, AI reports, and scores.",
    "Frontend dashboard shows suggestions, errors, security warnings, graphs, score, and timeline.",
    "User downloads PDF or DOC report."
  ];

  return `
    <section class="panel">
      <div class="timeline">
        ${steps.map((step, index) => `
          <div class="timeline-step">
            <span>${index + 1}</span>
            <div><strong>${step}</strong></div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function bindShellEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });

  document.getElementById("logout").addEventListener("click", () => {
    state.user = null;
    saveState();
    render();
  });

  document.getElementById("sampleBtn").addEventListener("click", () => {
    state.activeView = "dashboard";
    state.inputMode = "paste";
    render();
  });

  document.querySelectorAll("[data-open-report]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentReport = state.reports.find((report) => report.id === button.dataset.openReport);
      state.activeView = "dashboard";
      render();
    });
  });
}

function bindDashboardEvents() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.inputMode = button.dataset.mode;
      render();
    });
  });

  document.getElementById("clearInput")?.addEventListener("click", () => {
    document.querySelectorAll("#reviewForm textarea, #reviewForm input").forEach((input) => {
      input.value = "";
    });
  });

  document.getElementById("downloadPdf")?.addEventListener("click", () => window.print());
  document.getElementById("downloadDoc")?.addEventListener("click", downloadDoc);

  document.getElementById("reviewForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("statusLine");
    status.textContent = "FastAPI backend validating input...";

    const fileInput = document.getElementById("codeFile");
    const sourceInput = document.getElementById("sourceCode");
    const repoInput = document.getElementById("repoUrl");
    let source = sourceInput?.value.trim() || "";
    let fileName = "";
    const repoUrl = repoInput?.value.trim() || "";

    if (fileInput?.files?.[0]) {
      const file = fileInput.files[0];
      fileName = file.name;
      source = await file.text();
    }

    if (!source && !repoUrl) {
      status.textContent = "Please provide a code file, pasted code, or GitHub repository URL.";
      return;
    }

    status.textContent = "Processing code and sending structured prompt to Gemini API...";
    try {
      let report;
      if (fileInput?.files?.[0] && state.user?.token && !state.user.demo) {
        const form = new FormData();
        form.append("file", fileInput.files[0]);
        report = await apiFetch("/review/file", { method: "POST", body: form });
      } else if (state.user?.token && !state.user.demo) {
        report = await apiFetch("/review/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: source || demoCode, file_name: fileName, repo_url: repoUrl }),
        });
      } else {
        report = analyzeCode({ source: source || demoCode, fileName, repoUrl });
      }

      state.currentReport = report;
      state.reports = [report, ...state.reports].slice(0, 12);
      saveState();
      render();
    } catch (error) {
      status.textContent = `${error.message}. Running local analyzer instead...`;
      window.setTimeout(() => {
        const report = analyzeCode({ source: source || demoCode, fileName, repoUrl });
        state.currentReport = report;
        state.reports = [report, ...state.reports].slice(0, 12);
        saveState();
        render();
      }, 650);
    }
  });
}

function downloadDoc() {
  const report = state.currentReport || state.reports[0];
  if (!report) return;
  const content = `
AI Code Reviewer Report
${report.title}
Language: ${report.language}
Generated: ${report.createdAt}
Final Score: ${report.score}/100

Bugs:
${report.bugs.map((item) => `- ${item}`).join("\n")}

Warnings:
${report.warnings.map((item) => `- ${item}`).join("\n")}

Security Risks:
${report.security.map((item) => `- ${item}`).join("\n")}

Suggestions:
${report.suggestions.map((item) => `- ${item}`).join("\n")}

Optimized Code:
${report.optimizedCode}
`;
  const blob = new Blob([content], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-review.doc`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
