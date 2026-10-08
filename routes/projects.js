const express = require("express");
const multer = require("multer");
const db = require("../db");
const { uid, requireAuth, requireRole } = require("../auth");
const { rowToProject, rowToCandidate, getProject, listProjects, projectStats, touchProject } = require("../repo");
const Engine = require("../engine");
const { enrichFromLinkedInUrl } = require("../pdl");
const { extractTextFromBuffer } = require("../extractText");
const { DEFAULT_WEIGHTS, DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMN_LABELS, SAMPLE_JD_TEXT, SAMPLE_JD_STRUCTURED, SAMPLE_CANDIDATES, ratingBand } = require("../data/taxonomy");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(requireAuth);

const analysisJobs = new Map(); // projectId -> { total, done, failed, running }

function canEdit(role) { return role !== "Viewer"; }
function canQA(role) { return role === "Admin" || role === "QA Agent"; }

/* ------------------------------ Projects ------------------------------- */

router.get("/", (req, res) => {
  const projects = listProjects().map(p => ({ ...p, stats: projectStats(p.id) }));
  res.json(projects);
});

router.post("/", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot create reviews." });
  const { name, jd, weights, exportColumns, screeningRules, candidates } = req.body || {};
  if (!name || !jd) return res.status(400).json({ error: "name and jd are required." });
  const id = uid("proj");
  db.prepare(`INSERT INTO projects (id, name, jd, weights, export_columns, screening_rules, created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(id, name, JSON.stringify(jd), JSON.stringify(weights || DEFAULT_WEIGHTS),
      JSON.stringify(exportColumns || DEFAULT_EXPORT_COLUMNS), JSON.stringify(screeningRules || {}), req.user.id);

  const insertCand = db.prepare(`INSERT INTO candidates (id, project_id, name, linkedin_url, resume_filename, resume_text, linkedin_text, status)
    VALUES (?,?,?,?,?,?,?, 'pending')`);
  (candidates || []).forEach(c => {
    insertCand.run(uid("cand"), id, c.name || "Unnamed Candidate", c.linkedinUrl || "", c.resumeFileName || "", c.resumeText || "", c.linkedinText || "");
  });

  res.status(201).json(getProject(id, true));
});

router.get("/:id", (req, res) => {
  const p = getProject(req.params.id, true);
  if (!p) return res.status(404).json({ error: "Project not found." });
  p.stats = projectStats(p.id);
  res.json(p);
});

router.put("/:id", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot edit." });
  const p = getProject(req.params.id, false);
  if (!p) return res.status(404).json({ error: "Project not found." });
  const { name, jd, weights, exportColumns, screeningRules } = req.body || {};
  db.prepare(`UPDATE projects SET name=?, jd=?, weights=?, export_columns=?, screening_rules=?, updated_at=datetime('now') WHERE id=?`)
    .run(name ?? p.name, JSON.stringify(jd ?? p.jd), JSON.stringify(weights ?? p.weights),
      JSON.stringify(exportColumns ?? p.exportColumns), JSON.stringify(screeningRules ?? p.screeningRules), p.id);
  res.json(getProject(p.id, true));
});

router.delete("/:id", requireRole("Admin"), (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/seed-demo", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot create reviews." });
  const id = uid("proj");
  const jd = { ...SAMPLE_JD_STRUCTURED, rawText: SAMPLE_JD_TEXT, approved: true };
  db.prepare(`INSERT INTO projects (id, name, jd, weights, export_columns, screening_rules, created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(id, "Industrial Automation Engineer - Robotics", JSON.stringify(jd), JSON.stringify(DEFAULT_WEIGHTS),
      JSON.stringify(DEFAULT_EXPORT_COLUMNS), JSON.stringify({}), req.user.id);
  const insertCand = db.prepare(`INSERT INTO candidates (id, project_id, name, linkedin_url, resume_filename, resume_text, linkedin_text, status)
    VALUES (?,?,?,?,?,?,?, 'pending')`);
  SAMPLE_CANDIDATES.forEach(c => {
    insertCand.run(uid("cand"), id, c.name, c.linkedinUrl, c.resumeFileName || "", c.resumeText || "", c.linkedinText || "");
  });
  res.status(201).json(getProject(id, true));
});

/* ------------------------------ Candidates ------------------------------ */

router.post("/:id/candidates", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot add candidates." });
  const p = getProject(req.params.id, false);
  if (!p) return res.status(404).json({ error: "Project not found." });
  const { candidates } = req.body || {};
  if (!Array.isArray(candidates) || !candidates.length) return res.status(400).json({ error: "candidates array is required." });
  const existing = db.prepare("SELECT linkedin_url FROM candidates WHERE project_id = ?").all(p.id)
    .map(r => (r.linkedin_url || "").toLowerCase().replace(/\/+$/, ""));
  const insertCand = db.prepare(`INSERT INTO candidates (id, project_id, name, linkedin_url, resume_filename, resume_text, linkedin_text, status)
    VALUES (?,?,?,?,?,?,?, 'pending')`);
  let added = 0, skipped = 0;
  const seen = new Set(existing);
  candidates.forEach(c => {
    const norm = (c.linkedinUrl || "").toLowerCase().replace(/\/+$/, "");
    if (norm && seen.has(norm)) { skipped++; return; }
    if (norm) seen.add(norm);
    insertCand.run(uid("cand"), p.id, c.name || "Unnamed Candidate", c.linkedinUrl || "", c.resumeFileName || "", c.resumeText || "", c.linkedinText || "");
    added++;
  });
  touchProject(p.id);
  res.status(201).json({ added, skipped, project: getProject(p.id, true) });
});

router.put("/candidates/:candId", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot edit candidates." });
  const c = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.candId);
  if (!c) return res.status(404).json({ error: "Candidate not found." });
  const { name, linkedinUrl, linkedinText } = req.body || {};
  db.prepare("UPDATE candidates SET name=?, linkedin_url=?, linkedin_text=?, updated_at=datetime('now') WHERE id=?")
    .run(name ?? c.name, linkedinUrl ?? c.linkedin_url, linkedinText ?? c.linkedin_text, c.id);
  res.json(rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(c.id)));
});

router.delete("/candidates/:candId", (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot remove candidates." });
  db.prepare("DELETE FROM candidates WHERE id = ?").run(req.params.candId);
  res.json({ ok: true });
});

router.post("/candidates/:candId/resume", upload.single("resume"), async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot upload resumes." });
  const c = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.candId);
  if (!c) return res.status(404).json({ error: "Candidate not found." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'resume')." });
  try {
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    db.prepare("UPDATE candidates SET resume_filename=?, resume_text=?, status='pending', updated_at=datetime('now') WHERE id=?")
      .run(req.file.originalname, text, c.id);
    res.json(rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(c.id)));
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

router.put("/candidates/:candId/qa", (req, res) => {
  if (!canQA(req.user.role)) return res.status(403).json({ error: "Only QA Agents and Admins can submit QA reviews." });
  const c = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.candId);
  if (!c) return res.status(404).json({ error: "Candidate not found." });
  const { field, value } = req.body || {};
  const validFields = ["score", "recommendation", "comments", "status"];
  if (!validFields.includes(field)) return res.status(400).json({ error: "field must be one of: " + validFields.join(", ") });

  const history = JSON.parse(c.qa_history || "[]");
  const columnMap = { score: "qa_score", recommendation: "qa_recommendation", comments: "qa_comments", status: "qa_status" };
  const fromVal = c[columnMap[field]];
  if (String(fromVal ?? "") !== String(value ?? "")) {
    history.push({ field, from: fromVal === null || fromVal === undefined ? "(none)" : fromVal, to: value, by: `${req.user.name} (${req.user.role})`, at: new Date().toISOString() });
  }
  let newStatus = c.qa_status;
  if (field === "status") newStatus = value;
  else if (c.qa_status === "Not Reviewed") newStatus = "Reviewed";

  db.prepare(`UPDATE candidates SET ${columnMap[field]} = ?, qa_status = ?, qa_history = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(value, newStatus, JSON.stringify(history), c.id);
  res.json(rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(c.id)));
});

/* ------------------------ Cross-project Candidates Database -------------- */
// Feature: "Candidates" database view — every candidate across every project, with filters.
// Registered as a two-segment path (/candidates/all) so it never collides with the single-segment
// GET /:id project route or the existing /candidates/:candId routes above.
router.get("/candidates/all", (req, res) => {
  const { projectId, status, recommendation, band, qaStatus, search, missingMandatory, scoreMin, scoreMax } = req.query;
  const projects = listProjects();
  const projectNameById = {};
  projects.forEach(p => { projectNameById[p.id] = p.name; });

  const rows = projectId
    ? db.prepare("SELECT * FROM candidates WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
    : db.prepare("SELECT * FROM candidates ORDER BY created_at DESC").all();

  const min = scoreMin !== undefined ? Number(scoreMin) : 0;
  const max = scoreMax !== undefined ? Number(scoreMax) : 10;

  let list = rows.map(r => {
    const c = rowToCandidate(r);
    return {
      id: c.id, projectId: c.projectId, projectName: projectNameById[c.projectId] || "(deleted project)",
      name: c.name, linkedinUrl: c.linkedinUrl, status: c.status,
      ai: c.ai ? {
        overallScore: c.ai.overallScore, matchPercent: c.ai.matchPercent, recommendation: c.ai.recommendation,
        hardFailBlocking: c.ai.hardFailBlocking, confidence: c.ai.confidence, candidateInfo: c.ai.candidateInfo,
        explanation: c.ai.explanation
      } : null,
      qa: c.qa, createdAt: c.createdAt, updatedAt: c.updatedAt
    };
  });

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(q) ||
      (c.ai && (c.ai.candidateInfo.currentCompany || "").toLowerCase().includes(q)) ||
      (c.linkedinUrl || "").toLowerCase().includes(q));
  }
  if (status) list = list.filter(c => c.status === status);
  if (qaStatus) list = list.filter(c => c.qa.status === qaStatus);
  if (recommendation) list = list.filter(c => c.ai && c.ai.recommendation === recommendation);
  if (band) list = list.filter(c => c.ai && ratingBand(c.ai.overallScore).cls === band);
  if (missingMandatory === "true") list = list.filter(c => c.ai && c.ai.hardFailBlocking);
  if (scoreMin !== undefined || scoreMax !== undefined) list = list.filter(c => !c.ai || (c.ai.overallScore >= min && c.ai.overallScore <= max));

  res.json({ candidates: list, projects: projects.map(p => ({ id: p.id, name: p.name })) });
});

/* ------------------------ Admin: QA Reviewer Activity --------------------- */
// Feature: Admin-only reporting on QA reviewer activity (jobs reviewed, candidates checked, etc).
// qa_history entries store `by` as a formatted "Name (Role)" display string rather than a user id,
// so activity is grouped by that string and split back into name/role for display.
router.get("/reports/qa-activity", requireRole("Admin"), (req, res) => {
  const { projectId, from, to } = req.query;
  const projects = listProjects();

  const rows = projectId
    ? db.prepare("SELECT id, project_id, qa_history FROM candidates WHERE project_id = ?").all(projectId)
    : db.prepare("SELECT id, project_id, qa_history FROM candidates").all();

  const fromTs = from ? new Date(from).getTime() : null;
  const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null; // inclusive end-of-day

  const byPerson = new Map(); // key: "Name (Role)" -> running stats

  rows.forEach(r => {
    let history;
    try { history = JSON.parse(r.qa_history || "[]"); } catch (e) { history = []; }
    history.forEach(h => {
      const t = new Date(h.at).getTime();
      if (fromTs !== null && (isNaN(t) || t < fromTs)) return;
      if (toTs !== null && (isNaN(t) || t > toTs)) return;
      const key = h.by || "Unknown";
      if (!byPerson.has(key)) {
        byPerson.set(key, {
          by: key, actions: 0, projectIds: new Set(), candidateIds: new Set(),
          scoreSum: 0, scoreCount: 0, statusChanges: {}, recommendationChanges: {}, lastActivity: null
        });
      }
      const stat = byPerson.get(key);
      stat.actions++;
      stat.projectIds.add(r.project_id);
      stat.candidateIds.add(r.id);
      if (!stat.lastActivity || t > new Date(stat.lastActivity).getTime()) stat.lastActivity = h.at;
      if (h.field === "score") { const n = Number(h.to); if (!isNaN(n)) { stat.scoreSum += n; stat.scoreCount++; } }
      if (h.field === "status") stat.statusChanges[h.to] = (stat.statusChanges[h.to] || 0) + 1;
      if (h.field === "recommendation") stat.recommendationChanges[h.to] = (stat.recommendationChanges[h.to] || 0) + 1;
    });
  });

  const qaActivity = Array.from(byPerson.values()).map(s => {
    const m = s.by.match(/^(.*)\s\(([^)]+)\)$/);
    return {
      name: m ? m[1] : s.by, role: m ? m[2] : "", rawLabel: s.by,
      jobsReviewed: s.projectIds.size, candidatesChecked: s.candidateIds.size, totalActions: s.actions,
      avgQaScoreGiven: s.scoreCount ? Number((s.scoreSum / s.scoreCount).toFixed(1)) : null,
      statusBreakdown: s.statusChanges, recommendationBreakdown: s.recommendationChanges,
      lastActivity: s.lastActivity
    };
  }).sort((a, b) => b.candidatesChecked - a.candidatesChecked);

  res.json({ qaActivity, projects: projects.map(p => ({ id: p.id, name: p.name })) });
});

router.post("/candidates/:candId/notes", (req, res) => {
  if (req.user.role === "Viewer") return res.status(403).json({ error: "Viewers cannot add notes." });
  const c = db.prepare("SELECT * FROM candidates WHERE id = ?").get(req.params.candId);
  if (!c) return res.status(404).json({ error: "Candidate not found." });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "note text is required." });
  db.prepare("INSERT INTO notes (id, candidate_id, author, text) VALUES (?,?,?,?)")
    .run(uid("note"), c.id, req.user.name, text.trim());
  res.status(201).json(rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(c.id)));
});

/* ------------------------------ Analysis --------------------------------- */

router.post("/:id/analyze", async (req, res) => {
  if (!canEdit(req.user.role)) return res.status(403).json({ error: "Viewers cannot run analysis." });
  const p = getProject(req.params.id, false);
  if (!p) return res.status(404).json({ error: "Project not found." });
  const onlyFailed = req.query.onlyFailed === "true";
  // Feature: "Recalculate Score After Requirement Changes" — when requirements/weights/policies
  // are edited, ?all=true re-runs analysis on EVERY candidate in the project, including ones
  // already marked completed/needs_review, instead of the default "process new/unfinished only"
  // behavior below.
  const recalcAll = req.query.all === "true";
  const statusFilter = onlyFailed ? "failed" : null;
  const targets = recalcAll
    ? db.prepare("SELECT * FROM candidates WHERE project_id = ?").all(p.id)
    : statusFilter
      ? db.prepare("SELECT * FROM candidates WHERE project_id = ? AND status = ?").all(p.id, statusFilter)
      : db.prepare("SELECT * FROM candidates WHERE project_id = ? AND status != 'completed' AND status != 'needs_review'").all(p.id);

  if (!targets.length) return res.json({ started: false, message: "Nothing to process." });

  const job = { total: targets.length, done: 0, failed: 0, running: true };
  analysisJobs.set(p.id, job);
  res.json({ started: true, total: targets.length });

  // Fire-and-forget background processing.
  (async () => {
    for (const row of targets) {
      db.prepare("UPDATE candidates SET status='processing' WHERE id=?").run(row.id);
      try {
                let cand = rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(row.id));
        if (!cand.resumeText && !cand.linkedinText && cand.linkedinUrl) {
          try {
            const enrichedText = await enrichFromLinkedInUrl(cand.linkedinUrl);
            db.prepare("UPDATE candidates SET linkedin_text=?, updated_at=datetime('now') WHERE id=?").run(enrichedText, row.id);
            cand = rowToCandidate(db.prepare("SELECT * FROM candidates WHERE id = ?").get(row.id));
          } catch (pdlErr) {
            throw new Error(`LinkedIn enrichment failed: ${pdlErr.message}`);
          }
        }
        if (!cand.resumeText && !cand.linkedinText) throw new Error("No resume or profile text available");
        const jd = p.jd;
        const weights = p.weights;
        const screeningRules = p.screeningRules;
        const result = Engine.hasLiveProvider()
          ? await Engine.evaluateCandidateLive(cand, jd, weights, screeningRules)
          : Engine.evaluateCandidate(cand, jd, weights, screeningRules);
        const newStatus = (result.confidence === "Low" || result.hardFailBlocking) ? "needs_review" : "completed";
        db.prepare("UPDATE candidates SET status=?, ai=?, error=NULL, updated_at=datetime('now') WHERE id=?")
          .run(newStatus, JSON.stringify(result), row.id);
      } catch (e) {
        db.prepare("UPDATE candidates SET status='failed', error=?, updated_at=datetime('now') WHERE id=?").run(e.message, row.id);
        job.failed++;
      }
      job.done++;
      // small pacing delay so a burst of tiny candidates doesn't starve other requests
      await new Promise(r => setTimeout(r, 40));
    }
    job.running = false;
    touchProject(p.id);
  })();
});

router.get("/:id/analysis-status", (req, res) => {
  const job = analysisJobs.get(req.params.id);
  if (!job) return res.json({ running: false, total: 0, done: 0, failed: 0 });
  res.json(job);
});

/* ------------------------------ CSV Export -------------------------------- */

function csvEscape(v) {
  const s = (v === null || v === undefined) ? "" : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

router.get("/:id/export.csv", (req, res) => {
  const p = getProject(req.params.id, true);
  if (!p) return res.status(404).json({ error: "Project not found." });
  const cols = p.exportColumns && p.exportColumns.length ? p.exportColumns : DEFAULT_EXPORT_COLUMNS;
  const rows = p.candidates.filter(c => c.ai).map(c => {
    const ai = c.ai, info = ai.candidateInfo || {};
    return {
      name: c.name, linkedinUrl: c.linkedinUrl, currentTitle: info.currentTitle, currentCompany: info.currentCompany,
      location: info.location, totalExperience: info.totalExperienceYears, relevantExperience: info.relevantExperienceYears,
      requiredExperience: p.jd.minExperience, overallScore: ai.overallScore, matchPercent: ai.matchPercent,
      recommendation: ai.recommendation,
      requiredSkillsMatch: ai.skills.matched.filter(s => s.required).map(s => s.skill).join("; "),
      missingSkills: ai.skills.missing.map(s => s.skill).join("; "),
      industryMatch: ai.industryMatch.status, educationMatch: ai.educationMatch.status, certificationMatch: ai.certificationMatch.status,
      hardRequirementStatus: ai.hardFailBlocking ? "Failed" : "Pass",
      aiComments: ai.explanation, qaScore: c.qa.score, qaRecommendation: c.qa.recommendation,
      qaComments: c.qa.comments, qaStatus: c.qa.status, reviewDate: new Date().toISOString().slice(0, 10)
    };
  });
  const header = cols.map(c => EXPORT_COLUMN_LABELS[c] || c).join(",");
  const body = rows.map(r => cols.map(c => csvEscape(r[c])).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${p.name.replace(/[^a-z0-9]+/gi, "_")}_candidates.csv"`);
  res.send(header + "\n" + body);
});

module.exports = router;
