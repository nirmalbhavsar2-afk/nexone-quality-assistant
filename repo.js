const db = require("./db");
const { uid } = require("./auth");
const { ratingBand, DEFAULT_WEIGHTS, DEFAULT_EXPORT_COLUMNS } = require("./data/taxonomy");

function rowToCandidate(row) {
  return {
    id: row.id, projectId: row.project_id, name: row.name, linkedinUrl: row.linkedin_url,
    resumeFileName: row.resume_filename, resumeText: row.resume_text, linkedinText: row.linkedin_text,
    status: row.status, error: row.error,
    ai: row.ai ? JSON.parse(row.ai) : null,
    qa: {
      score: row.qa_score, recommendation: row.qa_recommendation, comments: row.qa_comments,
      status: row.qa_status, history: JSON.parse(row.qa_history || "[]")
    },
    createdAt: row.created_at, updatedAt: row.updated_at,
    notes: db.prepare("SELECT * FROM notes WHERE candidate_id = ? ORDER BY created_at ASC").all(row.id)
      .map(n => ({ id: n.id, author: n.author, text: n.text, at: n.created_at }))
  };
}

function rowToProject(row, includeCandidates) {
  const proj = {
    id: row.id, name: row.name,
    jd: JSON.parse(row.jd), weights: JSON.parse(row.weights),
    exportColumns: JSON.parse(row.export_columns),
    screeningRules: JSON.parse(row.screening_rules || "{}"),
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
  if (includeCandidates) {
    proj.candidates = db.prepare("SELECT * FROM candidates WHERE project_id = ? ORDER BY created_at ASC").all(row.id).map(rowToCandidate);
  }
  return proj;
}

function getProject(id, includeCandidates) {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? rowToProject(row, includeCandidates) : null;
}

function listProjects() {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all().map(r => rowToProject(r, false));
}

function projectStats(projectId) {
  const candidates = db.prepare("SELECT * FROM candidates WHERE project_id = ?").all(projectId).map(rowToCandidate);
  const withAi = candidates.filter(c => c.ai);
  const bands = { excellent: 0, strong: 0, good: 0, possible: 0, weak: 0, poor: 0 };
  let scoreSum = 0, missingMandatory = 0, needsQA = 0;
  withAi.forEach(c => {
    const b = ratingBand(c.ai.overallScore);
    if (b.cls === "band-excellent") bands.excellent++;
    else if (b.cls === "band-strong") bands.strong++;
    else if (b.cls === "band-good") bands.good++;
    else if (b.cls === "band-possible") bands.possible++;
    else if (b.cls === "band-weak") bands.weak++;
    else bands.poor++;
    scoreSum += c.ai.overallScore;
    if (c.ai.hardFailBlocking) missingMandatory++;
    if (c.qa.status === "Not Reviewed" || c.qa.status === "Needs Verification") needsQA++;
  });
  return {
    total: candidates.length, reviewed: withAi.length,
    avgScore: withAi.length ? scoreSum / withAi.length : 0,
    strongMatches: bands.excellent + bands.strong, goodMatches: bands.good,
    possibleMatches: bands.possible, poorMatches: bands.weak + bands.poor,
    missingMandatory, needsQA
  };
}

function touchProject(id) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id);
}

module.exports = { rowToCandidate, rowToProject, getProject, listProjects, projectStats, touchProject };
