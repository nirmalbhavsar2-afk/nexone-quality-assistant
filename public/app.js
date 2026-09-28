/* =========================================================================
   app.js — API-backed client for NexOne Quality Assistant (Team Edition).
   Same UI/UX as the standalone single-file app, but all data lives on the
   server (shared across the team) instead of in browser memory.
   ========================================================================= */

/* ---------------------------- API helpers -------------------------------- */

async function api(path, opts) {
  opts = opts || {};
  const headers = opts.headers || {};
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const resp = await fetch("/api" + path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
  let data = null;
  try { data = await resp.json(); } catch (e) { /* no body */ }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `Request failed (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}
const apiGet = (path) => api(path);
const apiPost = (path, body) => api(path, { method: "POST", body });
const apiPut = (path, body) => api(path, { method: "PUT", body });
const apiDelete = (path) => api(path, { method: "DELETE" });

/* ---------------------------- Utilities -------------------------------- */

function uid(prefix) { return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 10); }
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt1(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1); }

/* ------------------------------ State ----------------------------------- */

const State = {
  user: null,
  loginError: "",
  projects: [],           // lightweight list w/ stats, for Dashboard/Projects
  currentProject: null,   // full detail incl. candidates, for Candidates/Detail/Reports/Settings
  view: "dashboard",
  candidateDetailId: null,
  candFilters: { search: "", scoreMin: 0, scoreMax: 10, band: "all", qaStatus: "all", missingMandatory: false, location: "" },
  candSort: { key: "overallScore", dir: "desc" },
  newReview: null,
  wizardStep: 1,
  users: [],
  liveAiConfigured: false,
  toasts: [],
  bulk: null,
  pollHandle: null
};
window.State = State;

function toast(msg, kind) {
  const id = uid("t");
  State.toasts.push({ id, msg, kind: kind || "" });
  render();
  setTimeout(() => { State.toasts = State.toasts.filter(t => t.id !== id); render(); }, 3200);
}

function isReadOnly() { return State.user && State.user.role === "Viewer"; }
function canQA() { return State.user && (State.user.role === "Admin" || State.user.role === "QA Agent"); }
function canEditSettings() { return State.user && State.user.role === "Admin"; }

/* ------------------------------ Auth ------------------------------------- */

async function checkSession() {
  try {
    State.user = await apiGet("/auth/me");
  } catch (e) {
    State.user = null;
  }
  try { const h = await fetch("/api/health").then(r => r.json()); State.liveAiConfigured = !!h.liveAiConfigured; } catch (e) {}
  if (State.user) {
    // Re-entering with an existing session (page refresh / new tab): load data
    // for whatever view we're on and start live polling, same as goto() does.
    await goto(State.view || "dashboard");
  } else {
    render();
  }
}

async function doLogin(email, password) {
  try {
    State.user = await apiPost("/auth/login", { email, password });
    State.loginError = "";
    goto("dashboard");
    await loadProjects();
  } catch (e) {
    State.loginError = e.message;
    render();
  }
}
async function doLogout() {
  await apiPost("/auth/logout", {});
  State.user = null;
  stopPolling();
  render();
}

/* ------------------------------ Data loading ------------------------------ */

async function loadProjects() {
  State.projects = await apiGet("/projects");
  render();
}
async function openProject(id) {
  State.currentProject = await apiGet(`/projects/${id}`);
  render();
}
async function refreshCurrentProject() {
  if (!State.currentProject) return;
  try { State.currentProject = await apiGet(`/projects/${State.currentProject.id}`); render(); } catch (e) {}
}

function startPolling() {
  stopPolling();
  State.pollHandle = setInterval(() => {
    if (State.view === "dashboard") loadProjects();
    else if (State.view === "candidates") refreshCurrentProject();
  }, 6000);
}
function stopPolling() { if (State.pollHandle) { clearInterval(State.pollHandle); State.pollHandle = null; } }

/* ------------------------------ Router ----------------------------------- */

async function goto(view, opts) {
  State.view = view;
  if (opts && opts.candidateId !== undefined) State.candidateDetailId = opts.candidateId;
  window.scrollTo(0, 0);
  render();
  if (view === "dashboard") await loadProjects();
  if (view === "projects") await loadProjects();
  if (view === "settings" && canEditSettings()) { try { State.users = await apiGet("/users"); } catch (e) {} render(); }
  startPolling();
}
window.goto = goto;

/* ============================== RENDER ==================================== */

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "&#9737;" },
  { id: "new-review", label: "New Review", icon: "&#43;" },
  { id: "candidates", label: "Candidates", icon: "&#128100;" },
  { id: "projects", label: "Projects", icon: "&#128193;" },
  { id: "reports", label: "Reports", icon: "&#128202;" },
  { id: "settings", label: "Settings", icon: "&#9881;" }
];

function render() {
  const root = document.getElementById("app");
  if (!State.user) { root.innerHTML = renderLogin(); return; }
  root.innerHTML = `
    <div class="sidebar">
      <div class="brand">
        <div class="brand-mark">NQ</div>
        <div class="brand-text"><b>NexOne Quality</b><span>Team Edition</span></div>
      </div>
      <div class="nav">
        ${NAV_ITEMS.map(n => `<div class="nav-item ${State.view === n.id ? "active" : ""}" onclick="goto('${n.id}')">
          <span class="nav-icon">${n.icon}</span>${n.label}
        </div>`).join("")}
      </div>
      <div class="sidebar-foot">
        <span class="live-dot"></span>Live &middot; shared with your team<br/>
        Signed in as<br/><b style="color:#fff">${escapeHtml(State.user.name)}</b>
        <div class="role-pill">${State.user.role}</div><br/>
        <span class="logout-link" onclick="doLogout()">Sign out</span>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <h1>${topbarTitle()}</h1>
        <div class="topbar-actions">${topbarActions()}</div>
      </div>
      <div class="content">${renderView()}</div>
    </div>
    <div class="toast-wrap">${State.toasts.map(t => `<div class="toast ${t.kind}">${escapeHtml(t.msg)}</div>`).join("")}</div>
    ${renderModal()}
  `;
}

function renderLogin() {
  return `<div class="login-wrap"><div class="login-card">
    <div class="login-brand"><div class="brand-mark">NQ</div><div><b>NexOne Quality</b><span>AI Candidate Review &mdash; Team Edition</span></div></div>
    ${State.loginError ? `<div class="login-error">${escapeHtml(State.loginError)}</div>` : ""}
    <div class="field"><label>Email</label><input class="input" id="loginEmail" type="email" placeholder="you@nexellence.com"/></div>
    <div class="field"><label>Password</label><input class="input" id="loginPassword" type="password" placeholder="••••••••"
      onkeydown="if(event.key==='Enter') submitLogin()"/></div>
    <button class="btn btn-primary btn-block" onclick="submitLogin()">Sign In</button>
    <p class="small muted mt-14">Ask your Admin for an account. The first Admin login is printed in the server console on first startup.</p>
  </div></div>`;
}
function submitLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  doLogin(email, password);
}

function topbarTitle() {
  switch (State.view) {
    case "dashboard": return "Dashboard";
    case "new-review": return "New Candidate Review";
    case "candidates": return State.currentProject ? escapeHtml(State.currentProject.name) : "Candidates";
    case "projects": return "Projects";
    case "reports": return "Reports";
    case "settings": return "Settings";
    case "candidate-detail": return "Candidate Review";
    case "edit-requirements": return State.editReq ? "Edit Requirements — " + escapeHtml(State.editReq.projectName) : "Edit Requirements";
    default: return "";
  }
}
function topbarActions() {
  if (State.view === "candidates" && State.currentProject) {
    return `<button class="btn btn-sm" onclick="refreshCurrentProject()">&#8635; Refresh</button>
      <button class="btn btn-sm btn-primary" onclick="exportCSV()">&#8681; Download CSV</button>`;
  }
  if (State.view === "candidate-detail") return `<button class="btn btn-sm" onclick="goto('candidates')">&larr; Back to Candidates</button>`;
  if (State.view === "edit-requirements") return `<button class="btn btn-sm" onclick="cancelEditRequirements()">&larr; Cancel</button>`;
  return `<button class="btn btn-sm btn-primary" onclick="goto('new-review')">+ New Review</button>`;
}
function renderView() {
  switch (State.view) {
    case "dashboard": return viewDashboard();
    case "new-review": return viewNewReview();
    case "candidates": return viewCandidates();
    case "candidate-detail": return viewCandidateDetail();
    case "projects": return viewProjects();
    case "reports": return viewReports();
    case "settings": return viewSettings();
    case "edit-requirements": return viewEditRequirements();
    default: return "";
  }
}

/* ============================== DASHBOARD ================================ */

function viewDashboard() {
  if (!State.projects.length) {
    return `<div class="empty-state card"><div class="big-icon">&#128193;</div>
      <h3>No reviews yet</h3><p>Create your first candidate quality review to get started.</p>
      <button class="btn btn-primary" onclick="goto('new-review')">+ New Review</button></div>`;
  }
  const totals = State.projects.reduce((a, p) => {
    const s = p.stats;
    return {
      total: a.total + s.total, reviewed: a.reviewed + s.reviewed, strong: a.strong + s.strongMatches,
      good: a.good + s.goodMatches, possible: a.possible + s.possibleMatches, poor: a.poor + s.poorMatches,
      missingMandatory: a.missingMandatory + s.missingMandatory, needsQA: a.needsQA + s.needsQA,
      scoreSum: a.scoreSum + s.avgScore * s.reviewed
    };
  }, { total: 0, reviewed: 0, strong: 0, good: 0, possible: 0, poor: 0, missingMandatory: 0, needsQA: 0, scoreSum: 0 });
  const avg = totals.reviewed ? totals.scoreSum / totals.reviewed : 0;

  return `
    <div class="grid grid-4">
      <div class="stat-tile"><div class="num">${totals.total}</div><div class="lbl">Total Candidates</div><div class="sub">${totals.reviewed} reviewed</div></div>
      <div class="stat-tile"><div class="num" style="color:var(--green-700)">${totals.strong}</div><div class="lbl">Strong Matches</div></div>
      <div class="stat-tile"><div class="num" style="color:var(--blue-600)">${totals.good}</div><div class="lbl">Good Matches</div></div>
      <div class="stat-tile"><div class="num">${fmt1(avg)}</div><div class="lbl">Average Score</div></div>
    </div>
    <div class="grid grid-2 mt-14">
      <div class="stat-tile"><div class="num" style="color:var(--amber-600)">${totals.possible}</div><div class="lbl">Possible Matches</div></div>
      <div class="stat-tile"><div class="num" style="color:var(--red-700)">${totals.poor}</div><div class="lbl">Poor Matches</div></div>
    </div>
    <div class="grid grid-2 mt-14">
      <div class="stat-tile"><div class="num" style="color:var(--red-700)">${totals.missingMandatory}</div><div class="lbl">Missing Mandatory Requirements</div></div>
      <div class="stat-tile"><div class="num" style="color:var(--orange-600)">${totals.needsQA}</div><div class="lbl">Candidates Requiring QA Review</div></div>
    </div>
    <div class="card mt-20">
      <div class="card-title">Recent Projects <span class="small muted" style="font-weight:400">Shared across your team &mdash; updates every few seconds</span></div>
      <table class="tbl">
        <thead><tr><th>Project</th><th>Created</th><th>Candidates</th><th>Avg Score</th><th>Strong Matches</th><th></th></tr></thead>
        <tbody>
        ${State.projects.map(p => `<tr class="clickable" onclick="openProjectAndGoto('${p.id}')">
            <td><b>${escapeHtml(p.name)}</b></td>
            <td class="muted">${new Date(p.createdAt).toLocaleDateString()}</td>
            <td>${p.stats.total}</td>
            <td>${p.stats.reviewed ? fmt1(p.stats.avgScore) : "&mdash;"}</td>
            <td>${p.stats.strongMatches}</td>
            <td><button class="btn btn-sm" onclick="event.stopPropagation();openProjectAndGoto('${p.id}')">Open &rarr;</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}
async function openProjectAndGoto(id) { await openProject(id); goto("candidates"); }

/* ============================== PROJECTS (HISTORY) ======================== */

function viewProjects() {
  if (!State.projects.length) {
    return `<div class="empty-state card"><div class="big-icon">&#128193;</div><h3>No projects yet</h3>
      <button class="btn btn-primary" onclick="goto('new-review')">+ New Review</button></div>`;
  }
  return `<div class="grid grid-2">
    ${State.projects.map(p => `<div class="card">
        <div class="flex-between">
          <div><div style="font-weight:800;font-size:15px;">${escapeHtml(p.name)}</div>
            <div class="muted small">Created: ${new Date(p.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div></div>
          <button class="btn btn-sm btn-primary" onclick="openProjectAndGoto('${p.id}')">Reopen</button>
        </div>
        <div class="flex gap-8 mt-8">
          ${!isReadOnly() ? `<button class="btn btn-sm" onclick="openRenameProject('${p.id}')">Rename</button>` : ""}
          ${!isReadOnly() ? `<button class="btn btn-sm" onclick="openEditRequirements('${p.id}')">Edit Requirements</button>` : ""}
          ${canEditSettings() ? `<button class="btn btn-sm" style="border-color:var(--red-700);color:var(--red-700)" onclick="confirmDeleteProject('${p.id}')">Delete</button>` : ""}
        </div>
        <div class="divider"></div>
        <div class="kv">
          <span class="muted">Candidates</span><b>${p.stats.total}</b>
          <span class="muted">Average Score</span><b>${p.stats.reviewed ? fmt1(p.stats.avgScore) : "&mdash;"}</b>
          <span class="muted">Strong Matches</span><b>${p.stats.strongMatches}</b>
          <span class="muted">Needs QA</span><b>${p.stats.needsQA}</b>
        </div>
      </div>`).join("")}
  </div>`;
}

/* ============================== PROJECT RENAME / DELETE =================== */

function openRenameProject(id) {
  const p = State.projects.find(x => x.id === id);
  if (!p) return;
  Modal.open({
    title: "Rename Project",
    body: `<div class="field"><label>Project Name</label><input class="input" id="renameProjectInput" value="${escapeHtml(p.name)}"/></div>`,
    footer: `<button class="btn" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="submitRenameProject('${id}')">Save</button>`
  });
}
async function submitRenameProject(id) {
  const input = document.getElementById("renameProjectInput");
  const name = input.value.trim();
  if (!name) { toast("Project name can't be empty.", "err"); return; }
  try {
    await apiPut(`/projects/${id}`, { name });
    if (State.currentProject && State.currentProject.id === id) State.currentProject.name = name;
    Modal.close();
    await loadProjects();
    toast("Project renamed.", "ok");
  } catch (e) { toast("Could not rename project: " + e.message, "err"); }
}

function confirmDeleteProject(id) {
  const p = State.projects.find(x => x.id === id);
  if (!p) return;
  Modal.open({
    title: "Delete Project",
    body: `<p>Are you sure you want to permanently delete <b>${escapeHtml(p.name)}</b>? This will remove all ${p.stats.total} candidate(s) and their reviews. This cannot be undone.</p>`,
    footer: `<button class="btn" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" style="background:var(--red-700);border-color:var(--red-700)" onclick="submitDeleteProject('${id}')">Delete Project</button>`
  });
}
async function submitDeleteProject(id) {
  try {
    await apiDelete(`/projects/${id}`);
    Modal.close();
    if (State.currentProject && State.currentProject.id === id) { State.currentProject = null; await goto("dashboard"); }
    else { await loadProjects(); }
    toast("Project deleted.", "ok");
  } catch (e) { toast("Could not delete project: " + e.message, "err"); }
}

/* ============================== NEW REVIEW WIZARD ========================= */

const SAMPLE_JD_TEXT_CLIENT = `Job Title: Industrial Automation Engineer - Robotics
Location: Charlotte, NC (On-site, 4 days/week; 1 day remote)
Department: Manufacturing Engineering

About the Role:
We are seeking an experienced Industrial Automation Engineer to design, program, and maintain robotic
work-cells and PLC-controlled production lines across our automotive components manufacturing facility.
The ideal candidate has hands-on production-floor experience with Siemens and Allen-Bradley PLCs,
FANUC or ABB robotics, and servo-based motion control systems in a high-volume manufacturing environment.

Requirements:
- Minimum 5 years of industrial automation experience (production/manufacturing floor, not IT or home automation)
- Minimum 3 years of hands-on industrial robotics programming experience (FANUC and/or ABB preferred)
- Demonstrated Siemens PLC and/or Allen-Bradley PLC programming experience
- Motion control / servo systems experience required
- Experience in automotive or industrial manufacturing industry strongly preferred
- Bachelor's degree in Electrical Engineering, Mechatronics, or related field (required)
- Six Sigma or related process improvement certification (preferred)
- Must be authorized to work in the United States without sponsorship

Preferred Skills:
- Allen-Bradley RSLogix/Studio 5000
- SCADA/HMI development
- Root cause / OEE improvement experience
`;

function startNewReviewWizard() {
  State.newReview = {
    name: "",
    jd: {
      rawText: "", title: "", location: "", workMode: "onsite", minExperience: 5, maxExperience: 12,
      requiredSkills: [], preferredSkills: [], requiredTools: [], education: [], certifications: [],
      industries: [], domain: [], locationRequirements: [], mandatoryRequirements: [], preferredRequirements: []
    },
    weights: { technicalSkills: 30, relevantExperience: 25, industryDomain: 15, toolsTech: 10, responsibilities: 10, educationCert: 5, locationOther: 5 },
    exportColumns: ["name", "linkedinUrl", "currentTitle", "currentCompany", "location", "totalExperience", "relevantExperience",
      "requiredExperience", "overallScore", "matchPercent", "recommendation", "requiredSkillsMatch", "missingSkills",
      "industryMatch", "educationMatch", "certificationMatch", "hardRequirementStatus", "aiComments", "qaScore",
      "qaRecommendation", "qaComments", "qaStatus", "reviewDate"],
    screeningRules: { jobHopperEnabled: true, jobHopperAutoExclude: true, seniorityGateEnabled: true, seniorityGateAutoExclude: true, seniorityThresholdYear: 1985 },
    candidates: []
  };
  State.wizardStep = 1;
}

function viewNewReview() {
  if (!State.newReview) startNewReviewWizard();
  const steps = ["Job Description", "Requirements", "Candidates", "Review & Launch"];
  return `<div class="content-narrow">
    <div class="step-indicator">${steps.map((s, i) => `<div class="step ${State.wizardStep === i + 1 ? "active" : (State.wizardStep > i + 1 ? "done" : "")}">${i + 1}. ${s}</div>`).join("")}</div>
    ${State.wizardStep === 1 ? wizardStep1() : State.wizardStep === 2 ? wizardStep2() : State.wizardStep === 3 ? wizardStep3() : wizardStep4()}
  </div>`;
}

function wizardStep1() {
  const jd = State.newReview.jd;
  return `<div class="card">
    <div class="card-title">Project & Job Description</div>
    <div class="field"><label>Review / Project Name</label>
      <input class="input" value="${escapeHtml(State.newReview.name)}" placeholder="e.g. Industrial Automation Engineer - Robotics"
        oninput="State.newReview.name=this.value" /></div>
    <div class="row">
      <div class="field"><label>Job Title</label><input class="input" value="${escapeHtml(jd.title)}" oninput="State.newReview.jd.title=this.value"/></div>
      <div class="field"><label>Location</label><input class="input" value="${escapeHtml(jd.location)}" oninput="State.newReview.jd.location=this.value"/></div>
    </div>
    <div class="row">
      <div class="field"><label>Work Mode</label><select class="input" onchange="State.newReview.jd.workMode=this.value">
        ${["onsite", "hybrid", "remote"].map(v => `<option value="${v}" ${jd.workMode === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}
      </select></div>
      <div class="field"><label>Min Years Experience</label><input type="number" class="input" value="${jd.minExperience}" oninput="State.newReview.jd.minExperience=Number(this.value)"/></div>
      <div class="field"><label>Max Years Experience</label><input type="number" class="input" value="${jd.maxExperience}" oninput="State.newReview.jd.maxExperience=Number(this.value)"/></div>
    </div>
    <div class="field"><label>Job Description <span class="muted" style="font-weight:400">(paste full text, or upload a .txt/.pdf/.docx JD file)</span></label>
      <textarea class="input" rows="10" placeholder="Paste the complete job description here..." oninput="State.newReview.jd.rawText=this.value">${escapeHtml(jd.rawText)}</textarea>
      <div class="hint"><label class="btn btn-sm" style="display:inline-flex;">Upload JD file<input type="file" accept=".txt,.pdf,.docx" style="display:none" onchange="handleJDFileUpload(event)"/></label>
        <button class="btn btn-sm" onclick="loadSampleJD()">Use Sample JD (Industrial Automation)</button></div>
    </div>
  </div>
  <div class="flex-between mt-20">
    <button class="btn" onclick="cancelWizard()">Cancel</button>
    <button class="btn btn-primary" onclick="wizardGoStep2()">Next: Extract Requirements &rarr;</button>
  </div>`;
}

function loadSampleJD() {
  const jd = State.newReview.jd;
  jd.rawText = SAMPLE_JD_TEXT_CLIENT;
  jd.title = "Industrial Automation Engineer - Robotics";
  jd.location = "Charlotte, NC";
  jd.minExperience = 5; jd.maxExperience = 12;
  if (!State.newReview.name) State.newReview.name = jd.title;
  render();
}

async function handleJDFileUpload(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  try {
    const fd = new FormData(); fd.append("file", file);
    const { text } = await apiPost("/files/extract-text", fd);
    State.newReview.jd.rawText = text;
    if (!State.newReview.name) State.newReview.name = file.name.replace(/\.[^.]+$/, "");
    toast("JD file parsed successfully.", "ok");
    render();
  } catch (e) { toast("Could not parse file: " + e.message, "err"); }
}

async function wizardGoStep2() {
  const jd = State.newReview.jd;
  if (!State.newReview.name.trim()) State.newReview.name = jd.title || "Untitled Review";
  if (!jd.rawText.trim()) { toast("Please paste or upload a job description first.", "err"); render(); return; }
  let extracted;
  try { extracted = await apiPost("/jd/extract", { text: jd.rawText }); }
  catch (e) { toast("Could not extract requirements: " + e.message, "err"); return; }
  Object.assign(jd, {
    requiredSkills: extracted.requiredSkills || [], preferredSkills: extracted.preferredSkills || [],
    requiredTools: extracted.requiredTools || [], education: extracted.education || [], certifications: extracted.certifications || [],
    industries: extracted.industries || [], domain: extracted.domain || [], locationRequirements: extracted.locationRequirements || [],
    mandatoryRequirements: (extracted.mandatoryRequirements || []).map(r => ({ ...r })),
    preferredRequirements: (extracted.preferredRequirements || []).map(r => ({ ...r }))
  });
  if (!jd.title) jd.title = extracted.title || jd.title;
  if (!jd.location) jd.location = extracted.location || jd.location;
  if (!jd.minExperience) jd.minExperience = extracted.minExperience || jd.minExperience;
  // Use the richer built-in requirement set when the exact sample JD text was used, for demo fidelity.
  if (jd.rawText.trim() === SAMPLE_JD_TEXT_CLIENT.trim()) {
    jd.requiredSkills = ["PLC", "Siemens", "Robotics", "Motion Control"];
    jd.preferredSkills = ["Allen-Bradley", "SCADA", "FANUC", "ABB Robotics", "HMI"];
    jd.industries = ["Automotive Manufacturing", "Industrial Manufacturing"];
    jd.education = ["Bachelor's degree in Electrical Engineering, Mechatronics, or related field"];
    jd.certifications = ["Six Sigma (preferred)"];
    jd.locationRequirements = ["US work authorization without sponsorship", "On-site, Charlotte NC"];
    jd.mandatoryRequirements = [
      { id: "req1", text: "Minimum 5 years of industrial automation experience", type: "experience", minYears: 5, contextTag: "industrial", disqualifying: true },
      { id: "req2", text: "Minimum 3 years of hands-on industrial robotics programming", type: "experience", minYears: 3, contextTag: "robotics", disqualifying: false },
      { id: "req3", text: "Siemens and/or Allen-Bradley PLC programming experience", type: "skill", skill: "PLC", disqualifying: true },
      { id: "req4", text: "Motion control / servo systems experience", type: "skill", skill: "Motion Control", disqualifying: false },
      { id: "req5", text: "Bachelor's degree in Electrical Engineering, Mechatronics, or related field", type: "education", disqualifying: false },
      { id: "req6", text: "US work authorization without sponsorship", type: "other", disqualifying: true }
    ];
    jd.preferredRequirements = [
      { id: "pref1", text: "Automotive or Tier 1 supplier manufacturing experience" },
      { id: "pref2", text: "Six Sigma / process improvement certification" },
      { id: "pref3", text: "SCADA/HMI development experience" }
    ];
  }
  State.wizardStep = 2;
  render();
}

function chipInputHtml(pathExpr, list, placeholder) {
  return `<div class="chip-input">
    ${list.map((v, i) => `<span class="chip">${escapeHtml(v)}<span class="x" onclick="removeChip('${pathExpr}',${i})">&times;</span></span>`).join("")}
    <input placeholder="${placeholder || "Type and press Enter"}" onkeydown="if(event.key==='Enter'){event.preventDefault(); addChip('${pathExpr}', this.value); this.value='';}"/>
  </div>`;
}
function resolvePath(expr) { return expr.split(".").reduce((o, k) => o[k], window); }
function addChip(expr, val) { val = (val || "").trim(); if (!val) return; resolvePath(expr).push(val); render(); }
function removeChip(expr, idx) { resolvePath(expr).splice(idx, 1); render(); }

function wizardStep2() {
  const jd = State.newReview.jd;
  return `<div class="card">
    <div class="card-title">AI-Extracted Requirements <span class="badge badge-blue">Review &amp; Edit</span></div>
    <div class="card-sub">The engine analyzed the job description below. Edit or approve before candidate evaluation begins.</div>
    <div class="grid grid-2">
      <div class="field"><label>Required Skills</label>${chipInputHtml("State.newReview.jd.requiredSkills", jd.requiredSkills, "Add required skill")}</div>
      <div class="field"><label>Preferred / Nice-to-Have Skills</label>${chipInputHtml("State.newReview.jd.preferredSkills", jd.preferredSkills, "Add preferred skill")}</div>
      <div class="field"><label>Required Software / Tools</label>${chipInputHtml("State.newReview.jd.requiredTools", jd.requiredTools, "Add tool")}</div>
      <div class="field"><label>Required Industries</label>${chipInputHtml("State.newReview.jd.industries", jd.industries, "Add industry")}</div>
      <div class="field"><label>Education Requirements</label>${chipInputHtml("State.newReview.jd.education", jd.education, "Add education requirement")}</div>
      <div class="field"><label>Certification Requirements</label>${chipInputHtml("State.newReview.jd.certifications", jd.certifications, "Add certification")}</div>
      <div class="field"><label>Domain Experience</label>${chipInputHtml("State.newReview.jd.domain", jd.domain, "Add domain")}</div>
      <div class="field"><label>Location / Work-Authorization Requirements</label>${chipInputHtml("State.newReview.jd.locationRequirements", jd.locationRequirements, "Add requirement")}</div>
    </div>
    <div class="divider"></div>
    <div class="card-title">Must-Have (Hard) Requirements</div>
    <table class="tbl"><thead><tr><th>Requirement</th><th>Type</th><th>Auto-Disqualify</th><th></th></tr></thead>
      <tbody>${jd.mandatoryRequirements.map((r, i) => `<tr>
        <td><input class="input" value="${escapeHtml(r.text)}" oninput="State.newReview.jd.mandatoryRequirements[${i}].text=this.value"/></td>
        <td><select class="input" onchange="State.newReview.jd.mandatoryRequirements[${i}].type=this.value">
          ${["experience", "skill", "education", "other"].map(t => `<option value="${t}" ${r.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></td>
        <td style="text-align:center"><input type="checkbox" ${r.disqualifying ? "checked" : ""} onchange="State.newReview.jd.mandatoryRequirements[${i}].disqualifying=this.checked"/></td>
        <td><button class="btn btn-sm btn-ghost" onclick="State.newReview.jd.mandatoryRequirements.splice(${i},1);render()">Remove</button></td>
      </tr>`).join("")}</tbody>
    </table>
    <button class="btn btn-sm mt-8" onclick="addMandatoryReq()">+ Add Must-Have Requirement</button>
    <div class="divider"></div>
    <div class="card-title">Firm Screening Policies</div>
    <div class="checkbox-row"><input type="checkbox" ${State.newReview.screeningRules.jobHopperEnabled ? "checked" : ""}
      onchange="State.newReview.screeningRules.jobHopperEnabled=this.checked"/>
      <span class="inline">Flag job hoppers (4-5+ jobs, each &le;2 years, within the last 5-6 years)</span></div>
    <div class="checkbox-row"><input type="checkbox" ${State.newReview.screeningRules.jobHopperAutoExclude ? "checked" : ""}
      onchange="State.newReview.screeningRules.jobHopperAutoExclude=this.checked"/>
      <span class="inline">Auto-exclude job hoppers (Do Not Recommend)</span></div>
    <div class="checkbox-row"><input type="checkbox" ${State.newReview.screeningRules.seniorityGateEnabled ? "checked" : ""}
      onchange="State.newReview.screeningRules.seniorityGateEnabled=this.checked"/>
      <span class="inline">Flag candidates working since 1985 unless Director-level+</span></div>
    <div class="checkbox-row"><input type="checkbox" ${State.newReview.screeningRules.seniorityGateAutoExclude ? "checked" : ""}
      onchange="State.newReview.screeningRules.seniorityGateAutoExclude=this.checked"/>
      <span class="inline">Auto-exclude if seniority gate fails</span></div>
  </div>
  <div class="flex-between mt-20">
    <button class="btn" onclick="State.wizardStep=1;render()">&larr; Back</button>
    <button class="btn btn-primary" onclick="State.wizardStep=3; render()">Approve &amp; Continue: Add Candidates &rarr;</button>
  </div>`;
}
function addMandatoryReq() { State.newReview.jd.mandatoryRequirements.push({ id: uid("req"), text: "", type: "skill", disqualifying: false }); render(); }

function wizardStep3() {
  const nr = State.newReview;
  return `<div class="card">
    <div class="card-title">LinkedIn Profiles</div>
    <div class="card-sub">Paste one LinkedIn URL per line. Duplicate and invalid URLs are flagged automatically.</div>
    <textarea class="input" rows="5" id="liBulkInput" placeholder="https://www.linkedin.com/in/candidate-one/&#10;https://www.linkedin.com/in/candidate-two/"></textarea>
    <button class="btn btn-sm mt-8" onclick="bulkAddLinkedIn()">+ Add URLs</button>
    <button class="btn btn-sm mt-8" onclick="loadSampleCandidates()">Load Sample Candidates</button>
  </div>
  <div class="card">
    <div class="card-title">Resume Upload <span class="muted small" style="font-weight:400">PDF / DOC / DOCX &middot; multiple files supported</span></div>
    <label class="dropzone" style="display:block;cursor:pointer;">
      <input type="file" multiple accept=".pdf,.doc,.docx,.txt" style="display:none" onchange="handleResumeUpload(event)"/>
      &#128194; Click to upload resumes (auto-matched to candidates by name where possible)
    </label>
  </div>
  <div class="card">
    <div class="card-title">Candidates (${nr.candidates.length})</div>
    ${nr.candidates.length === 0 ? `<div class="empty-state"><p>No candidates added yet.</p></div>` : `
    <table class="tbl"><thead><tr><th>Name</th><th>LinkedIn URL</th><th>Resume</th><th>LinkedIn Text</th><th></th></tr></thead>
      <tbody>${nr.candidates.map((c, i) => `<tr>
        <td><input class="input" value="${escapeHtml(c.name)}" oninput="State.newReview.candidates[${i}].name=this.value"/></td>
        <td><input class="input" value="${escapeHtml(c.linkedinUrl)}" oninput="State.newReview.candidates[${i}].linkedinUrl=this.value"/>
          ${c._invalid ? '<div class="badge badge-amber mt-8">Invalid URL</div>' : ""}</td>
        <td>${c.resumeFileName ? `<span class="badge badge-green">${escapeHtml(c.resumeFileName)}</span>` : `<span class="badge badge-gray">No resume</span>`}
          <div><button class="btn btn-sm mt-8" onclick="openManualMatch(${i})">Attach / Match</button></div></td>
        <td><button class="btn btn-sm" onclick="openLinkedInTextEditor(${i})">${c.linkedinText ? "Edit Text" : "+ Paste Profile Text"}</button></td>
        <td><button class="btn btn-sm btn-ghost" onclick="State.newReview.candidates.splice(${i},1);render()">Remove</button></td>
      </tr>`).join("")}</tbody>
    </table>`}
  </div>
  <div class="flex-between mt-20">
    <button class="btn" onclick="State.wizardStep=2;render()">&larr; Back</button>
    <button class="btn btn-primary" onclick="State.wizardStep=4;render()" ${nr.candidates.length === 0 ? "disabled" : ""}>Next: Review &amp; Launch &rarr;</button>
  </div>`;
}

function normalizeUrl(u) { return (u || "").trim().toLowerCase().replace(/\/+$/, "").replace(/\?.*$/, ""); }
function isValidLinkedInUrl(u) { return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[a-z0-9\-_%]+\/?$/i.test((u || "").trim()); }
function nameFromLinkedInUrl(u) {
  const m = (u || "").match(/linkedin\.com\/in\/([^\/?]+)/i);
  if (!m) return "Unnamed Candidate";
  return m[1].split("-").filter(t => !/^\d+$/.test(t)).slice(0, 3).map(t => t[0] ? t[0].toUpperCase() + t.slice(1) : t).join(" ");
}
function bulkAddLinkedIn() {
  const raw = document.getElementById("liBulkInput").value;
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const existingUrls = new Set(State.newReview.candidates.map(c => normalizeUrl(c.linkedinUrl)));
  let added = 0, dup = 0, invalid = 0;
  lines.forEach(line => {
    const norm = normalizeUrl(line);
    if (existingUrls.has(norm)) { dup++; return; }
    existingUrls.add(norm);
    State.newReview.candidates.push({
      name: nameFromLinkedInUrl(line), linkedinUrl: line, resumeFileName: "", resumeText: "", linkedinText: "",
      _invalid: !isValidLinkedInUrl(line)
    });
    if (!isValidLinkedInUrl(line)) invalid++;
    added++;
  });
  toast(`Added ${added} candidate(s).${dup ? " " + dup + " duplicate(s) skipped." : ""}${invalid ? " " + invalid + " URL(s) flagged invalid." : ""}`, "ok");
  render();
}

const SAMPLE_CANDIDATES_CLIENT = [
  { name: "Marcus Reyes", linkedinUrl: "https://www.linkedin.com/in/marcus-reyes-automation/",
    linkedinText: `Marcus Reyes - Senior Industrial Automation Engineer at AutoDrive Components\nCharlotte, North Carolina Area\nSenior Industrial Automation Engineer at AutoDrive Components (2020 - Present)\nAutomation Engineer at Tier1 Motion Systems (2016 - 2020)\nControls Technician at Continental Automotive (2014 - 2016)`,
    resumeFileName: "Marcus_Reyes_Resume.pdf",
    resumeText: `MARCUS REYES\nSenior Industrial Automation Engineer\nCharlotte, NC\n\nEXPERIENCE\nSenior Industrial Automation Engineer, AutoDrive Components (Automotive Tier 1) — Jan 2020 - Present\n- Programmed and commissioned FANUC robotic work-cells for automotive component assembly lines\n- Developed Siemens S7 / TIA Portal PLC logic for high-speed production equipment\n- Led servo motion control upgrades\n\nAutomation Engineer, Tier1 Motion Systems (Automotive Manufacturing) — Mar 2016 - Dec 2019\n- Supported industrial automation and robotics integration\n\nControls Technician, Continental Automotive — Jun 2014 - Feb 2016\n\nEDUCATION\nB.S. Electrical Engineering, North Carolina State University, 2014\nCERTIFICATIONS\nSix Sigma Green Belt\nAuthorized to work in the United States (US Citizen).` },
  { name: "Daniel O'Connell", linkedinUrl: "https://www.linkedin.com/in/daniel-oconnell-smarthome/",
    linkedinText: `Daniel O'Connell - Home Automation Specialist at SmartLiving Solutions\nAustin, Texas`,
    resumeFileName: "Daniel_OConnell_Resume.pdf",
    resumeText: `DANIEL O'CONNELL\nHome Automation Specialist\nAustin, TX\n\nEXPERIENCE\nHome Automation Specialist, SmartLiving Solutions — 2019 - Present\n- Installed and configured home automation systems (Control4, Crestron) for residential clients\nNo PLC, robotics, or industrial manufacturing experience listed.` }
];
function loadSampleCandidates() {
  const existingUrls = new Set(State.newReview.candidates.map(c => normalizeUrl(c.linkedinUrl)));
  SAMPLE_CANDIDATES_CLIENT.forEach(c => {
    if (existingUrls.has(normalizeUrl(c.linkedinUrl))) return;
    State.newReview.candidates.push({ ...c });
  });
  toast("Sample candidates loaded.", "ok");
  render();
}

async function handleResumeUpload(evt) {
  const files = Array.from(evt.target.files || []);
  for (const file of files) {
    let text = "";
    try {
      const fd = new FormData(); fd.append("file", file);
      const result = await apiPost("/files/extract-text", fd);
      text = result.text;
    } catch (e) { toast(`Could not parse ${file.name}: ${e.message}`, "err"); continue; }
    const match = matchResumeToCandidate(file.name, text);
    if (match) { match.resumeFileName = file.name; match.resumeText = text; toast(`Matched ${file.name} to ${match.name}.`, "ok"); }
    else {
      State.newReview.candidates.push({ name: file.name.replace(/\.[^.]+$/, "").replace(/[_\-]/g, " "), linkedinUrl: "", resumeFileName: file.name, resumeText: text, linkedinText: "" });
      toast(`${file.name} could not be confidently matched — added as new candidate for manual matching.`, "err");
    }
  }
  render();
}
function matchResumeToCandidate(filename, resumeText) {
  const norm = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const fnNorm = norm(filename);
  let best = null, bestScore = 0;
  State.newReview.candidates.forEach(c => {
    if (c.resumeText) return;
    const nameNorm = norm(c.name);
    if (!nameNorm) return;
    let score = 0;
    if (fnNorm.includes(nameNorm) || nameNorm.includes(fnNorm.slice(0, Math.min(8, fnNorm.length)))) score += 2;
    c.name.toLowerCase().split(/\s+/).filter(t => t.length > 2).forEach(t => { if (fnNorm.includes(t) || (resumeText || "").toLowerCase().includes(t)) score += 1; });
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return bestScore >= 2 ? best : null;
}
function openManualMatch(candIdx) {
  Modal.open({
    title: "Attach / Match Resume",
    body: `<div class="field"><label>Upload resume for ${escapeHtml(State.newReview.candidates[candIdx].name)}</label>
      <input type="file" accept=".pdf,.doc,.docx,.txt" onchange="handleSingleResumeAttach(event, ${candIdx})"/></div>
      <div class="divider"></div>
      <div class="field"><label>Or select an already-uploaded unmatched resume</label>
        <select class="input" onchange="reassignResume(this.value, ${candIdx})"><option value="">-- select --</option>
        ${State.newReview.candidates.map((c, i) => i !== candIdx && c.resumeText ? `<option value="${i}">${escapeHtml(c.resumeFileName)} (currently on ${escapeHtml(c.name)})</option>` : "").join("")}
        </select></div>`
  });
}
async function handleSingleResumeAttach(evt, candIdx) {
  const file = evt.target.files[0];
  if (!file) return;
  try {
    const fd = new FormData(); fd.append("file", file);
    const { text } = await apiPost("/files/extract-text", fd);
    State.newReview.candidates[candIdx].resumeFileName = file.name;
    State.newReview.candidates[candIdx].resumeText = text;
    Modal.close(); render(); toast("Resume attached.", "ok");
  } catch (e) { toast("Could not parse file: " + e.message, "err"); }
}
function reassignResume(srcIdx, candIdx) {
  if (srcIdx === "") return;
  const src = State.newReview.candidates[Number(srcIdx)];
  State.newReview.candidates[candIdx].resumeFileName = src.resumeFileName;
  State.newReview.candidates[candIdx].resumeText = src.resumeText;
  Modal.close(); render();
}
function openLinkedInTextEditor(i) {
  const c = State.newReview.candidates[i];
  Modal.open({
    title: `LinkedIn Profile Text — ${escapeHtml(c.name)}`,
    body: `<p class="muted small">Paste visible profile text manually, or use the companion Chrome extension to copy it from a profile you're viewing.</p>
      <textarea class="input" rows="10" id="liTextArea">${escapeHtml(c.linkedinText)}</textarea>`,
    footer: `<button class="btn btn-primary" onclick="State.newReview.candidates[${i}].linkedinText=document.getElementById('liTextArea').value; Modal.close(); render();">Save</button>`
  });
}

function wizardStep4() {
  const nr = State.newReview;
  const withResume = nr.candidates.filter(c => c.resumeText).length;
  const withLI = nr.candidates.filter(c => c.linkedinText).length;
  return `<div class="card">
    <div class="card-title">Review &amp; Launch</div>
    <div class="kv">
      <span class="muted">Project Name</span><b>${escapeHtml(nr.name)}</b>
      <span class="muted">Job Title</span><b>${escapeHtml(nr.jd.title)}</b>
      <span class="muted">Min / Max Experience</span><b>${nr.jd.minExperience} - ${nr.jd.maxExperience} years</b>
      <span class="muted">Required Skills</span><b>${nr.jd.requiredSkills.join(", ") || "&mdash;"}</b>
      <span class="muted">Must-Have Requirements</span><b>${nr.jd.mandatoryRequirements.length}</b>
      <span class="muted">Candidates</span><b>${nr.candidates.length}</b>
      <span class="muted">With Resume</span><b>${withResume}</b>
      <span class="muted">With LinkedIn Text</span><b>${withLI}</b>
    </div>
  </div>
  <div class="flex-between mt-20">
    <button class="btn" onclick="State.wizardStep=3;render()">&larr; Back</button>
    <button class="btn btn-primary" id="launchBtn" onclick="launchReview()">&#9889; Start AI Review (${nr.candidates.length} candidates)</button>
  </div>`;
}

function cancelWizard() { State.newReview = null; State.wizardStep = 1; goto("dashboard"); }

async function launchReview() {
  const btn = document.getElementById("launchBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Creating review..."; }
  try {
    const nr = State.newReview;
    const created = await apiPost("/projects", {
      name: nr.name, jd: nr.jd, weights: nr.weights, exportColumns: nr.exportColumns,
      screeningRules: nr.screeningRules, candidates: nr.candidates
    });
    State.newReview = null; State.wizardStep = 1;
    State.currentProject = created;
    goto("candidates");
    await runBulkAnalysis(created.id);
  } catch (e) {
    toast("Could not create review: " + e.message, "err");
    if (btn) { btn.disabled = false; btn.textContent = "Start AI Review"; }
  }
}

/* ============================== EDIT REQUIREMENTS (existing project) ====== */

async function openEditRequirements(projectId) {
  let full;
  try { full = await apiGet(`/projects/${projectId}`); }
  catch (e) { toast("Could not load project: " + e.message, "err"); return; }
  State.editReq = {
    projectId: full.id,
    projectName: full.name,
    jd: JSON.parse(JSON.stringify(full.jd))
  };
  goto("edit-requirements");
}

function viewEditRequirements() {
  const er = State.editReq;
  if (!er) return `<div class="empty-state card"><p>No project selected.</p></div>`;
  const jd = er.jd;
  return `<div class="content-narrow">
    <div class="card">
      <div class="card-title">Edit Requirements — ${escapeHtml(er.projectName)}</div>
      <div class="card-sub">Changes apply going forward. Re-run analysis on existing candidates (from the Candidates page) to apply updated requirements to them.</div>
      <div class="row">
        <div class="field"><label>Job Title</label><input class="input" value="${escapeHtml(jd.title)}" oninput="State.editReq.jd.title=this.value"/></div>
        <div class="field"><label>Location</label><input class="input" value="${escapeHtml(jd.location)}" oninput="State.editReq.jd.location=this.value"/></div>
      </div>
      <div class="row">
        <div class="field"><label>Min Years Experience</label><input type="number" class="input" value="${jd.minExperience}" oninput="State.editReq.jd.minExperience=Number(this.value)"/></div>
        <div class="field"><label>Max Years Experience</label><input type="number" class="input" value="${jd.maxExperience}" oninput="State.editReq.jd.maxExperience=Number(this.value)"/></div>
      </div>
      <div class="field"><label>Job Description Text</label>
        <textarea class="input" rows="8" oninput="State.editReq.jd.rawText=this.value">${escapeHtml(jd.rawText)}</textarea></div>
    </div>
    <div class="card">
      <div class="grid grid-2">
        <div class="field"><label>Required Skills</label>${chipInputHtml("State.editReq.jd.requiredSkills", jd.requiredSkills, "Add required skill")}</div>
        <div class="field"><label>Preferred / Nice-to-Have Skills</label>${chipInputHtml("State.editReq.jd.preferredSkills", jd.preferredSkills, "Add preferred skill")}</div>
        <div class="field"><label>Required Software / Tools</label>${chipInputHtml("State.editReq.jd.requiredTools", jd.requiredTools, "Add tool")}</div>
        <div class="field"><label>Required Industries</label>${chipInputHtml("State.editReq.jd.industries", jd.industries, "Add industry")}</div>
        <div class="field"><label>Education Requirements</label>${chipInputHtml("State.editReq.jd.education", jd.education, "Add education requirement")}</div>
        <div class="field"><label>Certification Requirements</label>${chipInputHtml("State.editReq.jd.certifications", jd.certifications, "Add certification")}</div>
        <div class="field"><label>Domain Experience</label>${chipInputHtml("State.editReq.jd.domain", jd.domain, "Add domain")}</div>
        <div class="field"><label>Location / Work-Authorization Requirements</label>${chipInputHtml("State.editReq.jd.locationRequirements", jd.locationRequirements, "Add requirement")}</div>
      </div>
      <div class="divider"></div>
      <div class="card-title">Must-Have (Hard) Requirements</div>
      <table class="tbl"><thead><tr><th>Requirement</th><th>Type</th><th>Auto-Disqualify</th><th></th></tr></thead>
        <tbody>${jd.mandatoryRequirements.map((r, i) => `<tr>
          <td><input class="input" value="${escapeHtml(r.text)}" oninput="State.editReq.jd.mandatoryRequirements[${i}].text=this.value"/></td>
          <td><select class="input" onchange="State.editReq.jd.mandatoryRequirements[${i}].type=this.value">
            ${["experience", "skill", "education", "other"].map(t => `<option value="${t}" ${r.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></td>
          <td style="text-align:center"><input type="checkbox" ${r.disqualifying ? "checked" : ""} onchange="State.editReq.jd.mandatoryRequirements[${i}].disqualifying=this.checked"/></td>
          <td><button class="btn btn-sm btn-ghost" onclick="State.editReq.jd.mandatoryRequirements.splice(${i},1);render()">Remove</button></td>
        </tr>`).join("")}</tbody>
      </table>
      <button class="btn btn-sm mt-8" onclick="State.editReq.jd.mandatoryRequirements.push({id: uid('req'), text: '', type: 'skill', disqualifying: false});render()">+ Add Must-Have Requirement</button>
    </div>
    <div class="flex-between mt-20">
      <button class="btn" onclick="cancelEditRequirements()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditRequirements()">Save Requirements</button>
    </div>
  </div>`;
}

function cancelEditRequirements() {
  const hadProject = !!State.currentProject;
  State.editReq = null;
  goto(hadProject ? "candidates" : "projects");
}

async function saveEditRequirements() {
  const er = State.editReq;
  if (!er) return;
  try {
    const updated = await apiPut(`/projects/${er.projectId}`, { jd: er.jd });
    const hadProject = State.currentProject && State.currentProject.id === er.projectId;
    if (hadProject) State.currentProject = updated;
    State.editReq = null;
    await loadProjects();
    toast("Requirements updated. Re-run analysis to apply to existing candidates.", "ok");
    goto(hadProject ? "candidates" : "projects");
  } catch (e) { toast("Could not save requirements: " + e.message, "err"); }
}

/* ============================== BULK ANALYSIS ============================= */

async function runBulkAnalysis(projectId, onlyFailed) {
  try {
    const resp = await apiPost(`/projects/${projectId}/analyze${onlyFailed ? "?onlyFailed=true" : ""}`, {});
    if (!resp.started) { toast(resp.message || "Nothing to process.", ""); return; }
  } catch (e) { toast("Could not start analysis: " + e.message, "err"); return; }

  State.bulk = { projectId, total: 0, done: 0, failed: 0, running: true };
  render();
  const poll = setInterval(async () => {
    try {
      const status = await apiGet(`/projects/${projectId}/analysis-status`);
      State.bulk = { projectId, ...status };
      if (State.currentProject && State.currentProject.id === projectId) {
        State.currentProject = await apiGet(`/projects/${projectId}`);
      }
      render();
      if (!status.running) {
        clearInterval(poll);
        toast(`Analysis complete: ${status.total - status.failed} succeeded, ${status.failed} failed.`, status.failed ? "err" : "ok");
      }
    } catch (e) { clearInterval(poll); }
  }, 1000);
}

/* ============================== CANDIDATES LEADERBOARD ==================== */

function viewCandidates() {
  const p = State.currentProject;
  if (!p) return `<div class="empty-state card"><p>No project selected.</p><button class="btn btn-primary" onclick="goto('projects')">View Projects</button></div>`;

  const bulkBanner = (State.bulk && State.bulk.projectId === p.id) ? `
    <div class="card">
      <div class="flex-between"><b>${State.bulk.running ? `Analyzing ${State.bulk.done} of ${State.bulk.total} candidates...` : `Analysis complete: ${State.bulk.total - State.bulk.failed} succeeded, ${State.bulk.failed} failed.`}</b>
      ${!State.bulk.running && State.bulk.failed ? `<button class="btn btn-sm" onclick="runBulkAnalysis('${p.id}', true)">Retry Failed Only</button>` : ""}</div>
      <div class="progress-bar mt-8"><div class="progress-fill" style="width:${State.bulk.total ? Math.round(State.bulk.done / State.bulk.total * 100) : 0}%"></div></div>
    </div>` : "";

  let list = p.candidates.filter(c => c.ai);
  const f = State.candFilters;
  if (f.search) { const q = f.search.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(q) || (c.ai.candidateInfo.currentCompany || "").toLowerCase().includes(q)); }
  list = list.filter(c => c.ai.overallScore >= f.scoreMin && c.ai.overallScore <= f.scoreMax);
  if (f.band !== "all") list = list.filter(c => ratingBandClient(c.ai.overallScore).cls === f.band);
  if (f.qaStatus !== "all") list = list.filter(c => c.qa.status === f.qaStatus);
  if (f.missingMandatory) list = list.filter(c => c.ai.hardFailBlocking);
  if (f.location) list = list.filter(c => (c.ai.candidateInfo.location || "").toLowerCase().includes(f.location.toLowerCase()));

  const sortKey = State.candSort.key, dir = State.candSort.dir === "asc" ? 1 : -1;
  list = list.slice().sort((a, b) => {
    const getV = (c) => {
      switch (sortKey) {
        case "overallScore": return c.ai.overallScore;
        case "relevantExperience": return c.ai.candidateInfo.relevantExperienceYears;
        case "name": return c.name.toLowerCase();
        case "recommendation": return c.ai.recommendation;
        case "qaStatus": return c.qa.status;
        default: return c.ai.overallScore;
      }
    };
    const va = getV(a), vb = getV(b);
    if (va < vb) return -1 * dir; if (va > vb) return 1 * dir; return 0;
  });

  const notYetProcessed = p.candidates.filter(c => c.status === "pending" || c.status === "failed").length;

  return `${bulkBanner}
  <div class="card">
    <div class="flex-between">
      <div class="card-title" style="margin:0">Candidate Leaderboard <span class="muted small" style="font-weight:400">${list.length} of ${p.candidates.length} shown</span></div>
      <div class="flex gap-8">
        ${!isReadOnly() ? `<button class="btn btn-sm" onclick="openAddCandidatesModal()">+ Add Candidates</button>` : ""}
        ${notYetProcessed > 0 ? `<button class="btn btn-sm btn-primary" onclick="runBulkAnalysis('${p.id}')">Analyze ${notYetProcessed} Pending</button>` : ""}
      </div>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-bottom:12px;">
      <input class="input" style="max-width:220px" placeholder="Search name/company" value="${escapeHtml(f.search)}" oninput="State.candFilters.search=this.value;render()"/>
      <select class="input" style="max-width:180px" onchange="State.candFilters.band=this.value;render()">
        <option value="all">All Match Bands</option>
        ${["band-excellent:Excellent", "band-strong:Strong", "band-good:Good", "band-possible:Possible", "band-weak:Weak", "band-poor:Poor"].map(o => { const [v, l] = o.split(":"); return `<option value="${v}" ${f.band === v ? "selected" : ""}>${l}</option>`; }).join("")}
      </select>
      <select class="input" style="max-width:180px" onchange="State.candFilters.qaStatus=this.value;render()">
        <option value="all">All QA Status</option>
        ${["Not Reviewed", "Reviewed", "Approved", "Rejected", "Needs Verification"].map(s => `<option value="${s}" ${f.qaStatus === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <input class="input" style="max-width:160px" placeholder="Location contains..." value="${escapeHtml(f.location)}" oninput="State.candFilters.location=this.value;render()"/>
      <label class="flex gap-8" style="white-space:nowrap"><input type="checkbox" ${f.missingMandatory ? "checked" : ""} onchange="State.candFilters.missingMandatory=this.checked;render()"/> Missing mandatory only</label>
    </div>
    <table class="tbl"><thead><tr>
        <th>Rank</th><th onclick="setSort('name')">Candidate${sortArrow('name')}</th>
        <th onclick="setSort('overallScore')">Score${sortArrow('overallScore')}</th>
        <th onclick="setSort('relevantExperience')">Relevant Exp${sortArrow('relevantExperience')}</th>
        <th>Skills Match</th><th>Hard Requirements</th>
        <th onclick="setSort('recommendation')">Recommendation${sortArrow('recommendation')}</th>
        <th onclick="setSort('qaStatus')">QA Status${sortArrow('qaStatus')}</th>
      </tr></thead><tbody>
      ${list.map((c, i) => {
        const band = ratingBandClient(c.ai.overallScore);
        const reqMatched = c.ai.skills.matched.filter(s => s.required).length;
        const reqTotal = reqMatched + c.ai.skills.missing.filter(s => s.required).length;
        return `<tr class="clickable" onclick="goto('candidate-detail',{candidateId:'${c.id}'})">
          <td>${i + 1}</td><td><b>${escapeHtml(c.name)}</b><div class="muted small">${escapeHtml(c.ai.candidateInfo.currentTitle)}</div></td>
          <td><span class="badge ${band.cls}">${fmt1(c.ai.overallScore)}/10</span></td>
          <td>${fmt1(c.ai.candidateInfo.relevantExperienceYears)} yrs</td>
          <td>${reqMatched}/${reqTotal} required</td>
          <td>${c.ai.hardFailBlocking ? '<span class="badge badge-red">Failed</span>' : '<span class="badge badge-green">Pass</span>'}</td>
          <td>${recBadge(c.ai.recommendation)}</td><td>${qaBadge(c.qa.status)}</td>
        </tr>`;
      }).join("")}
      ${list.length === 0 ? `<tr><td colspan="8" class="muted" style="text-align:center;padding:30px;">No candidates match the current filters, or none have been analyzed yet.</td></tr>` : ""}
      </tbody></table>
  </div>`;
}
function ratingBandClient(score) {
  if (score >= 9.0) return { label: "Excellent Match", cls: "band-excellent" };
  if (score >= 8.0) return { label: "Strong Match", cls: "band-strong" };
  if (score >= 7.0) return { label: "Good Match", cls: "band-good" };
  if (score >= 6.0) return { label: "Possible Match", cls: "band-possible" };
  if (score >= 5.0) return { label: "Weak Match", cls: "band-weak" };
  return { label: "Poor Match", cls: "band-poor" };
}
function sortArrow(key) { if (State.candSort.key !== key) return ""; return `<span class="sort-arrow">${State.candSort.dir === "asc" ? "&#9650;" : "&#9660;"}</span>`; }
function setSort(key) { if (State.candSort.key === key) State.candSort.dir = State.candSort.dir === "asc" ? "desc" : "asc"; else { State.candSort.key = key; State.candSort.dir = "desc"; } render(); }
function recBadge(rec) { const map = { "Strongly Recommend": "badge-green", "Recommend": "badge-blue", "Consider": "badge-amber", "Do Not Recommend": "badge-red" }; return `<span class="badge ${map[rec] || "badge-gray"}">${escapeHtml(rec)}</span>`; }
function qaBadge(s) { const map = { "Not Reviewed": "badge-gray", "Reviewed": "badge-blue", "Approved": "badge-green", "Rejected": "badge-red", "Needs Verification": "badge-amber" }; return `<span class="badge ${map[s] || "badge-gray"}">${escapeHtml(s)}</span>`; }

/* ============================== ADD CANDIDATES (existing project) ========= */

function openAddCandidatesModal() {
  State.addCand = { candidates: [] };
  renderAddCandidatesModal();
}
function renderAddCandidatesModal() {
  const draft = State.addCand;
  Modal.open({
    title: `Add Candidates — ${escapeHtml(State.currentProject.name)}`,
    wide: true,
    body: `
      <div class="field"><label>LinkedIn Profiles</label>
        <div class="muted small">Paste one LinkedIn URL per line. Candidates already in this project are skipped automatically.</div>
        <textarea class="input" rows="5" id="addCandBulkInput" placeholder="https://www.linkedin.com/in/candidate-one/&#10;https://www.linkedin.com/in/candidate-two/"></textarea>
        <button class="btn btn-sm mt-8" onclick="bulkAddToAddCandModal()">+ Add URLs</button>
      </div>
      <div class="field"><label>Resume Upload <span class="muted small" style="font-weight:400">optional &middot; PDF / DOC / DOCX</span></label>
        <label class="dropzone" style="display:block;cursor:pointer;">
          <input type="file" multiple accept=".pdf,.doc,.docx,.txt" style="display:none" onchange="handleAddCandResumeUpload(event)"/>
          &#128194; Click to upload resumes (auto-matched to candidates by name where possible)
        </label>
      </div>
      <div class="field"><label>Candidates to Add (${draft.candidates.length})</label>
        ${draft.candidates.length === 0 ? `<p class="muted small">None added yet.</p>` : `
        <table class="tbl"><thead><tr><th>Name</th><th>LinkedIn URL</th><th>Resume</th><th></th></tr></thead>
          <tbody>${draft.candidates.map((c, i) => `<tr>
            <td><input class="input" value="${escapeHtml(c.name)}" oninput="State.addCand.candidates[${i}].name=this.value"/></td>
            <td><input class="input" value="${escapeHtml(c.linkedinUrl)}" oninput="State.addCand.candidates[${i}].linkedinUrl=this.value"/>
              ${c._invalid ? '<div class="badge badge-amber mt-8">Invalid URL</div>' : ""}</td>
            <td>${c.resumeFileName ? `<span class="badge badge-green">${escapeHtml(c.resumeFileName)}</span>` : `<span class="badge badge-gray">No resume</span>`}</td>
            <td><button class="btn btn-sm btn-ghost" onclick="State.addCand.candidates.splice(${i},1);renderAddCandidatesModal()">Remove</button></td>
          </tr>`).join("")}</tbody></table>`}
      </div>`,
    footer: `<button class="btn" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddCandidates()" ${draft.candidates.length === 0 ? "disabled" : ""}>Add ${draft.candidates.length} Candidate(s)</button>`
  });
}
function bulkAddToAddCandModal() {
  const raw = document.getElementById("addCandBulkInput").value;
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const existingUrls = new Set([
    ...State.currentProject.candidates.map(c => normalizeUrl(c.linkedinUrl)),
    ...State.addCand.candidates.map(c => normalizeUrl(c.linkedinUrl))
  ]);
  let added = 0, dup = 0, invalid = 0;
  lines.forEach(line => {
    const norm = normalizeUrl(line);
    if (existingUrls.has(norm)) { dup++; return; }
    existingUrls.add(norm);
    State.addCand.candidates.push({
      name: nameFromLinkedInUrl(line), linkedinUrl: line, resumeFileName: "", resumeText: "", linkedinText: "",
      _invalid: !isValidLinkedInUrl(line)
    });
    if (!isValidLinkedInUrl(line)) invalid++;
    added++;
  });
  toast(`Added ${added} candidate(s) to the list.${dup ? " " + dup + " duplicate(s) skipped." : ""}${invalid ? " " + invalid + " URL(s) flagged invalid." : ""}`, "ok");
  renderAddCandidatesModal();
}
async function handleAddCandResumeUpload(evt) {
  const files = Array.from(evt.target.files || []);
  for (const file of files) {
    let text = "";
    try {
      const fd = new FormData(); fd.append("file", file);
      const result = await apiPost("/files/extract-text", fd);
      text = result.text;
    } catch (e) { toast(`Could not parse ${file.name}: ${e.message}`, "err"); continue; }
    const norm = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");
    const fnNorm = norm(file.name);
    let best = null, bestScore = 0;
    State.addCand.candidates.forEach(c => {
      if (c.resumeText) return;
      const nameNorm = norm(c.name);
      if (!nameNorm) return;
      let score = 0;
      if (fnNorm.includes(nameNorm) || nameNorm.includes(fnNorm.slice(0, Math.min(8, fnNorm.length)))) score += 2;
      c.name.toLowerCase().split(/\s+/).filter(t => t.length > 2).forEach(t => { if (fnNorm.includes(t) || (text || "").toLowerCase().includes(t)) score += 1; });
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (bestScore >= 2 && best) { best.resumeFileName = file.name; best.resumeText = text; toast(`Matched ${file.name} to ${best.name}.`, "ok"); }
    else {
      State.addCand.candidates.push({ name: file.name.replace(/\.[^.]+$/, "").replace(/[_\-]/g, " "), linkedinUrl: "", resumeFileName: file.name, resumeText: text, linkedinText: "" });
      toast(`${file.name} could not be confidently matched — added as new candidate for manual matching.`, "err");
    }
  }
  renderAddCandidatesModal();
}
async function submitAddCandidates() {
  const p = State.currentProject;
  const candidates = State.addCand.candidates.map(c => ({ name: c.name, linkedinUrl: c.linkedinUrl, resumeFileName: c.resumeFileName, resumeText: c.resumeText, linkedinText: c.linkedinText }));
  try {
    const resp = await apiPost(`/projects/${p.id}/candidates`, { candidates });
    Modal.close();
    State.addCand = null;
    await refreshCurrentProject();
    toast(`Added ${resp.added} candidate(s).${resp.skipped ? " " + resp.skipped + " duplicate(s) skipped." : ""}`, "ok");
  } catch (e) { toast("Could not add candidates: " + e.message, "err"); }
}

/* ============================== CANDIDATE DETAIL =========================== */

function viewCandidateDetail() {
  const p = State.currentProject;
  const c = p && p.candidates.find(x => x.id === State.candidateDetailId);
  if (!c || !c.ai) return `<div class="empty-state card"><p>Candidate not found or not yet analyzed.</p></div>`;
  const ai = c.ai, band = ratingBandClient(ai.overallScore);

  const skillRows = [...p.jd.requiredSkills.map(s => ({ skill: s, req: "Yes" })), ...p.jd.preferredSkills.map(s => ({ skill: s, req: "Preferred" }))]
    .map(({ skill, req }) => {
      const m = ai.skills.matched.find(x => x.skill === skill);
      const status = m ? "ok" : (req === "Yes" ? "bad" : "warn");
      const icon = m ? "&#9989;" : (req === "Yes" ? "&#10060;" : "&#9888;&#65039;");
      return `<tr><td>${escapeHtml(skill)}</td><td>${req}</td><td>${m ? (m.years ? m.years + " years" : "Evidence found") : "Not Found"}</td><td class="${status}">${icon}</td></tr>`;
    }).join("");

  return `<div class="card">
    <div class="flex-between">
      <div><div style="font-size:19px;font-weight:800">${escapeHtml(c.name)}</div>
        <div class="muted">${escapeHtml(ai.candidateInfo.currentTitle)} at ${escapeHtml(ai.candidateInfo.currentCompany)} &middot; ${escapeHtml(ai.candidateInfo.location)}</div>
        <div class="small mt-8"><a href="${escapeHtml(c.linkedinUrl)}" target="_blank" rel="noopener">${escapeHtml(c.linkedinUrl || "No LinkedIn URL")}</a>
          ${c.resumeFileName ? ` &middot; Resume: ${escapeHtml(c.resumeFileName)}` : ` &middot; <span class="muted">No resume on file</span>`}</div></div>
      <div class="score-hero"><div class="score-big">${fmt1(ai.overallScore)}<small>/10</small></div>
        <div><span class="badge ${band.cls}" style="font-size:13px;padding:5px 12px;">${band.label}</span><div class="small muted mt-8">Match: ${ai.matchPercent}% &middot; Confidence: ${ai.confidence}</div></div></div>
    </div>
    <div class="divider"></div>
    <div class="flex gap-12">${recBadge(ai.recommendation)}${ai.hardFailBlocking ? '<span class="badge badge-red">Hard Requirement Failed</span>' : '<span class="badge badge-green">All Hard Requirements Met</span>'}${qaBadge(c.qa.status)}</div>
  </div>

  <div class="card"><div class="card-title">Why this candidate scored ${fmt1(ai.overallScore)}</div><p>${escapeHtml(ai.explanation)}</p>
    ${ai.providerError ? `<div class="badge badge-amber">Live AI unavailable — showing mock-engine fallback</div>` : `<div class="muted small">Engine: ${escapeHtml(ai.provider || "mock")}</div>`}</div>

  <div class="grid grid-2">
    <div class="card"><div class="card-title">Experience</div>
      <div class="kv">
        <span class="muted">Total Experience</span><b>${fmt1(ai.candidateInfo.totalExperienceYears)} years</b>
        <span class="muted">Relevant Experience</span><b>${fmt1(ai.candidateInfo.relevantExperienceYears)} years</b>
        <span class="muted">Required Experience</span><b>${p.jd.minExperience} years</b>
        <span class="muted">Experience Match</span><b>${ai.candidateInfo.relevantExperienceYears >= p.jd.minExperience ? "&#9989; Yes" : "&#10060; No"}</b>
      </div></div>
    <div class="card"><div class="card-title">Category Scores</div>
      ${Object.entries(ai.categoryScores).map(([k, v]) => `
        <div class="flex-between small" style="margin-bottom:6px;"><span class="muted">${categoryLabel(k)}</span><b>${fmt1(v)}/10</b></div>
        <div class="progress-bar" style="margin-bottom:8px;"><div class="progress-fill" style="width:${v * 10}%"></div></div>`).join("")}
    </div>
  </div>

  <div class="card"><div class="card-title">Skills Match</div>
    <table class="tbl skill-table"><thead><tr><th>Skill</th><th>Required</th><th>Candidate</th><th>Match</th></tr></thead>
      <tbody>${skillRows || `<tr><td colspan="4" class="muted">No skills configured on this job description.</td></tr>`}</tbody></table></div>

  <div class="grid grid-2">
    <div class="card"><div class="card-title">Missing Requirements</div>
      ${ai.skills.missing.length === 0 ? `<p class="muted">None &mdash; all configured skills were found.</p>` :
        `<ul class="list-clean">${ai.skills.missing.map(s => `<li>${escapeHtml(s.skill)} ${s.required ? '<span class="badge badge-red">Required</span>' : '<span class="badge badge-amber">Preferred</span>'}</li>`).join("")}</ul>`}</div>
    <div class="card"><div class="card-title">Strongest Qualifications</div>
      <ul class="list-clean">${ai.strongestQualifications.map(s => `<li>&#9989; ${escapeHtml(s)}</li>`).join("") || `<li class="muted">None identified.</li>`}</ul></div>
  </div>

  <div class="grid grid-2">
    <div class="card"><div class="card-title">Concerns / Red Flags</div>
      ${ai.redFlags.length === 0 ? `<p class="muted">No concerns identified.</p>` :
        `<ul class="list-clean">${ai.redFlags.map(f => `<li><span class="badge ${f.severity === "high" ? "badge-red" : "badge-amber"}">${escapeHtml(f.type)}</span> ${escapeHtml(f.text)}</li>`).join("")}</ul>`}
      ${ai.verificationItems.length ? `<div class="divider"></div><b class="small">Needs Verification:</b><ul class="list-clean">${ai.verificationItems.map(v => `<li>${escapeHtml(v)}</li>`).join("")}</ul>` : ""}</div>
    <div class="card"><div class="card-title">Resume vs LinkedIn Consistency</div>
      <div class="badge ${ai.consistency.status === "Mostly Consistent" ? "badge-green" : ai.consistency.status === "Insufficient Data" ? "badge-gray" : "badge-amber"}">Status: ${escapeHtml(ai.consistency.status)}</div>
      ${ai.consistency.discrepancies && ai.consistency.discrepancies.length ? `<ul class="list-clean mt-8">${ai.consistency.discrepancies.map(d => `<li><b>${escapeHtml(d.field)}:</b> ${escapeHtml(d.detail)}</li>`).join("")}</ul>` : `<p class="muted mt-8">No discrepancies found.</p>`}</div>
  </div>

  <div class="card"><div class="card-title">Hard Requirements</div>
    <table class="tbl"><thead><tr><th>Requirement</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${ai.hardRequirements.map(r => `<tr><td>${escapeHtml(r.text)}${r.disqualifying ? ' <span class="badge badge-red">Disqualifying</span>' : ""}</td>
        <td>${r.status === "pass" ? '<span class="badge badge-green">Pass</span>' : r.status === "fail" ? '<span class="badge badge-red">&#10060; Failed</span>' : '<span class="badge badge-amber">Needs Verification</span>'}</td>
        <td class="small">${escapeHtml(r.detail)}</td></tr>`).join("")}</tbody></table></div>

  <div class="card"><div class="card-title">Human QA Review ${!canQA() ? '<span class="badge badge-gray">View Only</span>' : ""}</div>
    <div class="grid grid-2">
      <div><div class="field"><label>AI Score</label><div>${fmt1(ai.overallScore)} / 10</div></div>
        <div class="field"><label>AI Recommendation</label><div>${recBadge(ai.recommendation)}</div></div>
        <div class="field"><label>AI Comments</label><div class="small">${escapeHtml(ai.explanation)}</div></div></div>
      <div><div class="field"><label>QA Score</label>
          <input type="number" min="0" max="10" step="0.1" class="input" value="${c.qa.score !== null && c.qa.score !== undefined ? c.qa.score : ""}" ${!canQA() ? "disabled" : ""}
            onchange="updateQA('${c.id}','score',this.value)"/></div>
        <div class="field"><label>QA Recommendation</label>
          <select class="input" ${!canQA() ? "disabled" : ""} onchange="updateQA('${c.id}','recommendation',this.value)">
            <option value="">-- unset --</option>
            ${["Strongly Recommend", "Recommend", "Consider", "Do Not Recommend"].map(r => `<option value="${r}" ${c.qa.recommendation === r ? "selected" : ""}>${r}</option>`).join("")}
          </select></div>
        <div class="field"><label>QA Status</label>
          <select class="input" ${!canQA() ? "disabled" : ""} onchange="updateQA('${c.id}','status',this.value)">
            ${["Not Reviewed", "Reviewed", "Approved", "Rejected", "Needs Verification"].map(s => `<option value="${s}" ${c.qa.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select></div>
        <div class="field"><label>QA Comments</label>
          <textarea class="input" rows="3" ${!canQA() ? "disabled" : ""} onchange="updateQA('${c.id}','comments',this.value)">${escapeHtml(c.qa.comments)}</textarea></div>
      </div>
    </div>
    ${c.qa.history.length ? `<div class="divider"></div><b class="small">Audit Trail</b>${c.qa.history.map(h => `<div class="audit-line">${new Date(h.at).toLocaleString()} &mdash; <b>${escapeHtml(h.field)}</b> changed from "${escapeHtml(h.from)}" to "${escapeHtml(h.to)}" by ${escapeHtml(h.by)}</div>`).join("")}` : ""}
  </div>

  <div class="card"><div class="card-title">Recruiter Notes <span class="muted small" style="font-weight:400">Separate from AI comments</span></div>
    ${c.notes.map(n => `<div class="audit-line"><b>${escapeHtml(n.author)}</b> &mdash; ${new Date(n.at).toLocaleString()}<br/>${escapeHtml(n.text)}</div>`).join("") || `<p class="muted">No notes yet.</p>`}
    ${!isReadOnly() ? `<div class="mt-14"><textarea class="input" rows="2" id="noteInput" placeholder="Add a recruiter note..."></textarea>
      <button class="btn btn-sm mt-8" onclick="addNote('${c.id}')">+ Add Note</button></div>` : ""}
  </div>`;
}
function categoryLabel(k) {
  return {
    technicalSkills: "Technical Skills (30%)", relevantExperience: "Relevant Experience (25%)",
    industryDomain: "Industry / Domain (15%)", toolsTech: "Tools / Technology (10%)",
    responsibilities: "Responsibilities Match (10%)", educationCert: "Education / Certifications (5%)", locationOther: "Location / Other (5%)"
  }[k] || k;
}
async function updateQA(candId, field, value) {
  if (!canQA()) return;
  if (field === "score") value = value === "" ? null : Number(value);
  try {
    await apiPut(`/projects/candidates/${candId}/qa`, { field, value });
    await refreshCurrentProject();
    toast("QA updated.", "ok");
  } catch (e) { toast("Could not update QA: " + e.message, "err"); }
}
async function addNote(candId) {
  const val = document.getElementById("noteInput").value.trim();
  if (!val) return;
  try { await apiPost(`/projects/candidates/${candId}/notes`, { text: val }); await refreshCurrentProject(); }
  catch (e) { toast("Could not add note: " + e.message, "err"); }
}

/* ============================== REPORTS ==================================== */

function viewReports() {
  if (!State.projects.length) return `<div class="empty-state card"><p>No data yet. Run a review to see reports.</p></div>`;
  const p = State.currentProject;
  if (!p) return `<div class="empty-state card"><p>Open a project first (from Dashboard or Projects) to see its report.</p></div>`;
  const cands = p.candidates.filter(c => c.ai);
  const bandCounts = { "Excellent Match": 0, "Strong Match": 0, "Good Match": 0, "Possible Match": 0, "Weak Match": 0, "Poor Match": 0 };
  cands.forEach(c => bandCounts[ratingBandClient(c.ai.overallScore).label]++);
  const maxBand = Math.max(1, ...Object.values(bandCounts));
  const skillMissCounts = {};
  cands.forEach(c => c.ai.skills.missing.forEach(s => { if (s.required) skillMissCounts[s.skill] = (skillMissCounts[s.skill] || 0) + 1; }));
  const topMissing = Object.entries(skillMissCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxMiss = Math.max(1, ...topMissing.map(x => x[1]));

  return `<div class="field"><label>Project</label>
    <select class="input" style="max-width:360px" onchange="openProjectAndStay(this.value)">
      ${State.projects.map(pr => `<option value="${pr.id}" ${pr.id === p.id ? "selected" : ""}>${escapeHtml(pr.name)}</option>`).join("")}
    </select></div>
  <div class="grid grid-2">
    <div class="card"><div class="card-title">Score Distribution</div>
      ${Object.entries(bandCounts).map(([label, n]) => `
        <div class="flex-between small"><span>${label}</span><b>${n}</b></div>
        <div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:${n / maxBand * 100}%"></div></div>`).join("")}</div>
    <div class="card"><div class="card-title">Top Missing Required Skills</div>
      ${topMissing.length === 0 ? `<p class="muted">No missing required skills across candidates.</p>` :
        topMissing.map(([skill, n]) => `<div class="flex-between small"><span>${escapeHtml(skill)}</span><b>${n}</b></div>
        <div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:${n / maxMiss * 100}%;background:var(--red-600)"></div></div>`).join("")}</div>
  </div>
  <div class="card"><div class="card-title">Recommendation Breakdown</div>
    <div class="grid grid-4">${["Strongly Recommend", "Recommend", "Consider", "Do Not Recommend"].map(r => {
      const n = cands.filter(c => c.ai.recommendation === r).length;
      return `<div class="stat-tile"><div class="num">${n}</div><div class="lbl">${r}</div></div>`;
    }).join("")}</div></div>`;
}
async function openProjectAndStay(id) { await openProject(id); }

/* ============================== SETTINGS ==================================== */

let settingsTab = "project";
function viewSettings() {
  const tabs = [["project", "Scoring & Policy"], ["export", "Export Columns"], ["ai", "AI Settings"]];
  if (canEditSettings()) tabs.push(["users", "Users"]);
  return `<div class="tabs no-print">${tabs.map(([id, label]) => `<div class="tab ${settingsTab === id ? "active" : ""}" onclick="settingsTab='${id}';render()">${label}</div>`).join("")}</div>
    ${settingsTab === "project" ? settingsProjectTab() : settingsTab === "export" ? settingsExportTab() : settingsTab === "ai" ? settingsAiTab() : settingsUsersTab()}`;
}

function settingsProjectTab() {
  const p = State.currentProject;
  if (!p) return `<div class="card"><p class="muted">Open a project (Dashboard or Projects) to edit its scoring weights and screening policy.</p></div>`;
  const w = p.weights, wSum = Object.values(w).reduce((a, b) => a + b, 0);
  const sr = p.screeningRules || {};
  return `<div class="card"><div class="card-title">Editing: ${escapeHtml(p.name)}
      <select class="input" style="max-width:280px;width:auto" onchange="openProjectAndStay(this.value)">
        ${State.projects.map(pr => `<option value="${pr.id}" ${pr.id === p.id ? "selected" : ""}>${escapeHtml(pr.name)}</option>`).join("")}
      </select></div></div>
    <div class="card"><div class="card-title">Scoring Weights (must total 100%) ${!canEditSettings() ? '<span class="badge badge-gray">Admin only</span>' : `<span class="badge ${wSum === 100 ? "badge-green" : "badge-red"}">Total: ${wSum}%</span>`}</div>
      ${Object.keys(w).map(k => `<div class="field"><label>${categoryLabel(k)}</label>
        <input type="number" class="input" style="max-width:120px" value="${w[k]}" ${!canEditSettings() ? "disabled" : ""}
          oninput="pendingWeights=pendingWeights||{...p.weights};pendingWeights['${k}']=Number(this.value)" onchange="saveWeightField('${k}', this.value)"/></div>`).join("")}
    </div>
    <div class="card"><div class="card-title">Firm Screening Policies ${!canEditSettings() ? '<span class="badge badge-gray">Admin only</span>' : ""}</div>
      <div class="checkbox-row"><input type="checkbox" ${sr.jobHopperEnabled !== false ? "checked" : ""} ${!canEditSettings() ? "disabled" : ""}
        onchange="saveScreeningField('jobHopperEnabled', this.checked)"/><span class="inline">Flag job hoppers (4-5+ jobs, &le;2 yrs each, within last 5-6 years)</span></div>
      <div class="checkbox-row"><input type="checkbox" ${sr.jobHopperAutoExclude !== false ? "checked" : ""} ${!canEditSettings() ? "disabled" : ""}
        onchange="saveScreeningField('jobHopperAutoExclude', this.checked)"/><span class="inline">Auto-exclude job hoppers</span></div>
      <div class="checkbox-row"><input type="checkbox" ${sr.seniorityGateEnabled !== false ? "checked" : ""} ${!canEditSettings() ? "disabled" : ""}
        onchange="saveScreeningField('seniorityGateEnabled', this.checked)"/><span class="inline">Flag candidates working since ${sr.seniorityThresholdYear || 1985} unless Director-level+</span></div>
      <div class="checkbox-row"><input type="checkbox" ${sr.seniorityGateAutoExclude !== false ? "checked" : ""} ${!canEditSettings() ? "disabled" : ""}
        onchange="saveScreeningField('seniorityGateAutoExclude', this.checked)"/><span class="inline">Auto-exclude if seniority gate fails</span></div>
    </div>`;
}
async function saveWeightField(key, val) {
  const p = State.currentProject;
  const weights = { ...p.weights, [key]: Number(val) };
  try { State.currentProject = await apiPut(`/projects/${p.id}`, { weights }); toast("Weights saved. Re-run analysis to apply to existing candidates.", "ok"); render(); }
  catch (e) { toast("Could not save: " + e.message, "err"); }
}
async function saveScreeningField(key, val) {
  const p = State.currentProject;
  const screeningRules = { ...p.screeningRules, [key]: val };
  try { State.currentProject = await apiPut(`/projects/${p.id}`, { screeningRules }); toast("Policy saved. Re-run analysis to apply to existing candidates.", "ok"); render(); }
  catch (e) { toast("Could not save: " + e.message, "err"); }
}

function settingsExportTab() {
  const p = State.currentProject;
  if (!p) return `<div class="card"><p class="muted">Open a project to configure its export columns.</p></div>`;
  return `<div class="card"><div class="card-title">Export Settings — CSV Columns for "${escapeHtml(p.name)}"</div>
    <div class="grid grid-3">${DEFAULT_EXPORT_COLUMNS_CLIENT.map(col => `<label class="checkbox-row"><input type="checkbox" ${p.exportColumns.includes(col) ? "checked" : ""}
      onchange="toggleExportCol('${col}', this.checked)"/><span class="inline">${EXPORT_COLUMN_LABELS_CLIENT[col]}</span></label>`).join("")}</div></div>`;
}
const DEFAULT_EXPORT_COLUMNS_CLIENT = ["name", "linkedinUrl", "currentTitle", "currentCompany", "location", "totalExperience", "relevantExperience",
  "requiredExperience", "overallScore", "matchPercent", "recommendation", "requiredSkillsMatch", "missingSkills",
  "industryMatch", "educationMatch", "certificationMatch", "hardRequirementStatus", "aiComments", "qaScore", "qaRecommendation", "qaComments", "qaStatus", "reviewDate"];
const EXPORT_COLUMN_LABELS_CLIENT = {
  name: "Candidate Name", linkedinUrl: "LinkedIn URL", currentTitle: "Current Title", currentCompany: "Current Company", location: "Location",
  totalExperience: "Total Experience", relevantExperience: "Relevant Experience", requiredExperience: "Required Experience",
  overallScore: "Overall Rating", matchPercent: "Match %", recommendation: "Recommendation", requiredSkillsMatch: "Required Skills Match",
  missingSkills: "Missing Skills", industryMatch: "Industry Match", educationMatch: "Education Match", certificationMatch: "Certification Match",
  hardRequirementStatus: "Hard Requirement Status", aiComments: "AI Comments", qaScore: "QA Rating", qaRecommendation: "QA Recommendation",
  qaComments: "QA Comments", qaStatus: "QA Status", reviewDate: "Review Date"
};
async function toggleExportCol(col, checked) {
  const p = State.currentProject;
  let cols = [...p.exportColumns];
  if (checked && !cols.includes(col)) cols.push(col);
  if (!checked) cols = cols.filter(c => c !== col);
  try { State.currentProject = await apiPut(`/projects/${p.id}`, { exportColumns: cols }); render(); } catch (e) { toast("Could not save: " + e.message, "err"); }
}

function settingsAiTab() {
  return `<div class="card"><div class="card-title">AI Provider</div>
    ${State.liveAiConfigured
      ? `<div class="badge badge-green">Live AI configured</div><p class="muted mt-8">This server has an organization-wide Anthropic API key configured (server-side only — never sent to browsers). All candidate evaluations use live LLM-assisted analysis, falling back to the built-in rules engine automatically if the API call fails.</p>`
      : `<div class="badge badge-gray">Built-in rules engine (default)</div><p class="muted mt-8">No AI provider key is configured on this server, so evaluations use the deterministic, explainable rules engine. An Admin can enable live LLM-assisted evaluation by setting <code>ANTHROPIC_API_KEY</code> in the server's environment and restarting — see DEPLOY.md.</p>`}
  </div>`;
}

function settingsUsersTab() {
  return `<div class="card"><div class="flex-between"><div class="card-title" style="margin:0">Team Accounts</div>
      <button class="btn btn-sm btn-primary" onclick="openAddUser()">+ Add User</button></div>
    <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr></thead>
      <tbody>${State.users.map(u => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td>
        <td><select class="input" style="max-width:150px" onchange="changeUserRole('${u.id}', this.value)">
          ${["Admin", "Recruiter", "QA Agent", "Viewer"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select></td>
        <td class="muted small">${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${u.id !== State.user.id ? `<button class="btn btn-sm btn-ghost" onclick="removeUser('${u.id}')">Remove</button>` : `<span class="muted small">(you)</span>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
}
function openAddUser() {
  Modal.open({
    title: "Add Team Member", body: `
    <div class="field"><label>Name</label><input class="input" id="newUserName"/></div>
    <div class="field"><label>Email</label><input class="input" id="newUserEmail" type="email"/></div>
    <div class="field"><label>Temporary Password</label><input class="input" id="newUserPassword" type="text" placeholder="min 8 characters"/></div>
    <div class="field"><label>Role</label><select class="input" id="newUserRole">
      ${["Recruiter", "QA Agent", "Admin", "Viewer"].map(r => `<option value="${r}">${r}</option>`).join("")}
    </select></div>`,
    footer: `<button class="btn btn-primary" onclick="submitAddUser()">Create Account</button>`
  });
}
async function submitAddUser() {
  const name = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role = document.getElementById("newUserRole").value;
  try {
    await apiPost("/users", { name, email, password, role });
    State.users = await apiGet("/users");
    Modal.close(); render(); toast("Team member added.", "ok");
  } catch (e) { toast("Could not add user: " + e.message, "err"); }
}
async function changeUserRole(id, role) {
  try { await apiPut(`/users/${id}`, { role }); State.users = await apiGet("/users"); toast("Role updated.", "ok"); render(); }
  catch (e) { toast("Could not update role: " + e.message, "err"); }
}
async function removeUser(id) {
  try { await apiDelete(`/users/${id}`); State.users = await apiGet("/users"); render(); }
  catch (e) { toast("Could not remove user: " + e.message, "err"); }
}

/* ============================== CSV EXPORT ================================= */

function exportCSV() {
  const p = State.currentProject;
  if (!p) return;
  window.open(`/api/projects/${p.id}/export.csv`, "_blank");
}

/* ============================== MODAL ======================================= */

const Modal = { current: null, open(opts) { this.current = opts; render(); }, close() { this.current = null; render(); } };
function renderModal() {
  if (!Modal.current) return "";
  const m = Modal.current;
  return `<div class="modal-backdrop" onclick="if(event.target===this) Modal.close()">
    <div class="modal ${m.wide ? "modal-lg" : ""}">
      <div class="flex-between"><h3 style="margin:0">${escapeHtml(m.title)}</h3><button class="icon-btn" onclick="Modal.close()">&times;</button></div>
      <div class="mt-14">${m.body}</div>
      ${m.footer ? `<div class="mt-14" style="text-align:right">${m.footer}</div>` : ""}
    </div>
  </div>`;
}

/* ============================== INIT ========================================= */

window.addEventListener("DOMContentLoaded", checkSession);
