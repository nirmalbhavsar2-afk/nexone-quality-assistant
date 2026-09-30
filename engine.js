/* =========================================================================
   engine.js (server) — Centralized AI Evaluation Engine, Node port.
   Same deterministic scoring/extraction logic as the standalone browser app,
   plus two firm-wide screening rules (job hopper, 1985/seniority gate) that
   only make sense enforced centrally for a shared team tool.
   An optional org-wide Anthropic key (env ANTHROPIC_API_KEY) enables live
   LLM-assisted evaluation; the key never leaves the server.
   ========================================================================= */

const {
  AUTOMATION_CONTEXTS, SKILL_SYNONYMS, DEFAULT_WEIGHTS,
  ratingBand, recommendationFor
} = require("./data/taxonomy");

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const DATE_RANGE_RE = new RegExp(
  `(?:(${MONTHS})[a-z]*\\.?\\s+)?(\\d{4})\\s*(?:-|–|—|to)\\s*(?:(${MONTHS})[a-z]*\\.?\\s+)?(\\d{4}|present|current)`,
  "gi"
);

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function currentYear() { return new Date().getFullYear(); }

function extractIntervals(text) {
  if (!text) return [];
  const intervals = [];
  let m;
  DATE_RANGE_RE.lastIndex = 0;
  while ((m = DATE_RANGE_RE.exec(text)) !== null) {
    const startYear = parseInt(m[2], 10);
    const endRaw = m[4].toLowerCase();
    const endYear = (endRaw === "present" || endRaw === "current") ? currentYear() : parseInt(endRaw, 10);
    if (isNaN(startYear) || isNaN(endYear) || endYear < startYear || startYear < 1970) continue;
    const ctxStart = Math.max(0, m.index - 220);
    const context = text.slice(ctxStart, m.index + m[0].length + 40);
    intervals.push({ start: startYear, end: endYear, context, matchText: m[0] });
  }
  return intervals;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else merged.push({ ...sorted[i] });
  }
  return merged;
}

function sumYears(intervals) { return intervals.reduce((sum, iv) => sum + Math.max(0, iv.end - iv.start), 0); }

function classifyContext(snippet) {
  const lower = snippet.toLowerCase();
  const scores = {};
  for (const [key, def] of Object.entries(AUTOMATION_CONTEXTS)) {
    let hits = 0;
    for (const kw of def.keywords) if (lower.includes(kw)) hits++;
    if (hits > 0) scores[key] = hits;
  }
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : null;
}

const RELATED_CONTEXTS = {
  industrial: ["industrial", "robotics", "plc", "motionControl"],
  robotics: ["robotics", "industrial"],
  plc: ["plc", "industrial"],
  motionControl: ["motionControl", "industrial"]
};
function relatedTagsFor(tag) { return RELATED_CONTEXTS[tag] || [tag]; }

function relevantYearsForContexts(text, acceptableTags) {
  const intervals = extractIntervals(text);
  const tagged = intervals.map(iv => ({ ...iv, tag: classifyContext(iv.context) }));
  const relevant = tagged.filter(iv => acceptableTags.includes(iv.tag) || iv.tag === null && /automation|robot|plc|manufactur|industrial/i.test(iv.context));
  return { years: sumYears(mergeIntervals(relevant)), tagged };
}

function skillVariants(skillName) {
  const key = skillName.toLowerCase();
  if (SKILL_SYNONYMS[key]) return SKILL_SYNONYMS[key];
  return [key];
}

function findSkillEvidence(text, skillName) {
  if (!text) return { found: false };
  const lower = text.toLowerCase();
  const variants = skillVariants(skillName);
  for (const v of variants) {
    const idx = lower.indexOf(v.toLowerCase());
    if (idx !== -1) {
      const ctxStart = Math.max(0, idx - 120);
      const context = text.slice(ctxStart, idx + v.length + 80);
      const yrMatch = context.match(/(\d+)\+?\s*years?/i);
      return { found: true, context: context.trim(), explicitYears: yrMatch ? parseInt(yrMatch[1], 10) : null };
    }
  }
  return { found: false };
}

const ENTRY_RE_1 = /([A-Z][A-Za-z0-9&.,'\/ ]{2,60}?)(?:,| at )\s*([A-Z][A-Za-z0-9&.,'\/ \(\)]{2,60}?)\s*(?:\(.*?\))?\s*(?:—|-|–)\s*((?:[A-Za-z]{3,9}\.?\s+)?\d{4})\s*(?:-|–|—|to)\s*((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|Present|Current)/g;

function parseTimelineEntries(text) {
  if (!text) return [];
  const entries = [];
  let m;
  ENTRY_RE_1.lastIndex = 0;
  while ((m = ENTRY_RE_1.exec(text)) !== null) {
    entries.push({ title: m[1].trim(), company: m[2].trim(), start: m[3].trim(), end: m[4].trim() });
  }
  return entries;
}

function normCompany(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function compareLinkedInResume(liText, resumeText) {
  if (!liText || !resumeText) return { status: "Insufficient Data", discrepancies: [] };
  const liEntries = parseTimelineEntries(liText);
  const rEntries = parseTimelineEntries(resumeText);
  const discrepancies = [];
  for (const rE of rEntries) {
    const match = liEntries.find(l => normCompany(l.company).includes(normCompany(rE.company).slice(0, 6)) ||
      normCompany(rE.company).includes(normCompany(l.company).slice(0, 6)));
    if (!match) {
      discrepancies.push({ field: "Position", detail: `Resume lists "${rE.title}" at ${rE.company} (${rE.start} - ${rE.end}) — not found on LinkedIn.` });
    } else {
      if (match.title.toLowerCase() !== rE.title.toLowerCase()) {
        discrepancies.push({ field: "Title", detail: `Title mismatch at ${rE.company}: Resume says "${rE.title}", LinkedIn says "${match.title}".` });
      }
      if (match.start !== rE.start || match.end !== rE.end) {
        discrepancies.push({ field: "Dates", detail: `Employment dates differ at ${rE.company}: Resume "${rE.start} - ${rE.end}" vs LinkedIn "${match.start} - ${match.end}".` });
      }
    }
  }
  for (const lE of liEntries) {
    const match = rEntries.find(r => normCompany(r.company).includes(normCompany(lE.company).slice(0, 6)) ||
      normCompany(lE.company).includes(normCompany(r.company).slice(0, 6)));
    if (!match) discrepancies.push({ field: "Position", detail: `LinkedIn lists "${lE.title}" at ${lE.company} (${lE.start} - ${lE.end}) — missing from resume.` });
  }
  return { status: discrepancies.length === 0 ? "Mostly Consistent" : "Review Required", discrepancies };
}

function detectWorkAuth(text) {
  if (!text) return "Needs Verification";
  const lower = text.toLowerCase();
  if (/(requires? sponsorship|h-1b sponsorship|needs? visa sponsorship|opt\/stem)/.test(lower)) return "Requires Sponsorship";
  if (/(authorized to work|us citizen|green card|no sponsorship required|without sponsorship)/.test(lower)) return "Authorized (No Sponsorship)";
  return "Needs Verification";
}

function matchEducation(text, requiredEducation) {
  if (!text) return { status: "Not Found", detail: "No resume or profile text available to verify education." };
  const lower = text.toLowerCase();
  const hasBachelor = /(bachelor|b\.s\.|b\.tech|b\.eng|beng)/.test(lower);
  const hasMaster = /(master|m\.s\.|mba|m\.tech)/.test(lower);
  const hasAssociate = /(associate degree|diploma)/.test(lower);
  const requiresBachelor = requiredEducation.some(e => /bachelor/i.test(e));
  if (requiresBachelor) {
    if (hasBachelor || hasMaster) return { status: "Match", detail: "Candidate holds a Bachelor's degree (or higher) matching the requirement." };
    if (hasAssociate) return { status: "Partial", detail: "Candidate holds an Associate degree; Bachelor's degree was required." };
    return { status: "Not Found", detail: "No degree matching the Bachelor's requirement was found in available text." };
  }
  return { status: hasBachelor || hasMaster || hasAssociate ? "Match" : "Needs Verification", detail: "No strict education requirement configured." };
}

function matchCertifications(text, requiredCerts) {
  if (!requiredCerts || requiredCerts.length === 0) return { status: "N/A", detail: "No certification requirement configured." };
  if (!text) return { status: "Not Found", detail: "No text available to verify certifications." };
  const lower = text.toLowerCase();
  const found = requiredCerts.filter(c => lower.includes(c.toLowerCase().split(" ")[0]));
  if (found.length === requiredCerts.length) return { status: "Match", detail: `Matched: ${found.join(", ")}` };
  if (found.length > 0) return { status: "Partial", detail: `Matched: ${found.join(", ")}. Missing: ${requiredCerts.filter(c => !found.includes(c)).join(", ")}` };
  return { status: "Not Found", detail: `No evidence of required certification(s): ${requiredCerts.join(", ")}.` };
}

const GENERIC_SKILL_VOCAB = Object.keys(SKILL_SYNONYMS).concat([
  "python", "java", "javascript", "sql", "excel", "salesforce", "hubspot", "aws", "azure",
  "autocad", "solidworks", "six sigma", "iso 9001", "project management", "lean manufacturing"
]);

function extractJDFromText(text) {
  const titleMatch = text.match(/job title:\s*(.+)/i);
  const locationMatch = text.match(/location:\s*(.+)/i);
  const minExpMatch = text.match(/minimum\s+(\d+)\s*\+?\s*years?/i) || text.match(/(\d+)\s*\+\s*years?/i);
  const maxExpMatch = text.match(/up to\s+(\d+)\s*years?/i) || text.match(/(\d+)\s*-\s*(\d+)\s*years?/i);

  let workMode = "onsite";
  if (/remote/i.test(text) && /hybrid/i.test(text)) workMode = "hybrid";
  else if (/\bremote\b/i.test(text) && !/on-site|onsite/i.test(text)) workMode = "remote";
  else if (/hybrid/i.test(text)) workMode = "hybrid";

  const requiredSkills = [];
  const preferredSkills = [];
  const reqSectionMatch = text.match(/requirements?:([\s\S]*?)(preferred skills?:|preferred requirements?:|$)/i);
  const prefSectionMatch = text.match(/preferred skills?:([\s\S]*)/i) || text.match(/preferred requirements?:([\s\S]*)/i);
  const reqSection = reqSectionMatch ? reqSectionMatch[1] : text;
  const prefSection = prefSectionMatch ? prefSectionMatch[1] : "";

  for (const skill of GENERIC_SKILL_VOCAB) {
    const label = skill.replace(/\b\w/g, c => c.toUpperCase());
    if (reqSection.toLowerCase().includes(skill)) requiredSkills.push(label);
    else if (prefSection.toLowerCase().includes(skill)) preferredSkills.push(label);
  }

  const educationMatch = text.match(/bachelor[^.\n]*|master[^.\n]*|associate degree[^.\n]*/gi) || [];
  const certMatch = text.match(/six sigma[^.\n]*|pmp[^.\n]*|certified[^.\n]*|certification[^.\n]*/gi) || [];

  const mandatoryLines = reqSection.split("\n").map(l => l.trim()).filter(l => /^[-*•]/.test(l)).map(l => l.replace(/^[-*•]\s*/, ""));
  const preferredLines = prefSection.split("\n").map(l => l.trim()).filter(l => /^[-*•]/.test(l)).map(l => l.replace(/^[-*•]\s*/, ""));

  const mandatoryRequirements = mandatoryLines.map((l, i) => {
    const yrs = l.match(/minimum\s+(\d+)/i);
    let contextTag = null;
    if (/robot/i.test(l)) contextTag = "robotics";
    else if (/industrial/i.test(l)) contextTag = "industrial";
    else if (/plc/i.test(l)) contextTag = "plc";
    return {
      id: "auto_req_" + i, text: l,
      type: yrs ? "experience" : (/degree|bachelor|master/i.test(l) ? "education" : (/authoriz|sponsor|visa/i.test(l) ? "other" : "skill")),
      minYears: yrs ? parseInt(yrs[1], 10) : undefined, contextTag,
      skill: GENERIC_SKILL_VOCAB.find(s => l.toLowerCase().includes(s)) || null,
      disqualifying: /must|required|minimum/i.test(l)
    };
  });

  return {
    title: titleMatch ? titleMatch[1].trim() : "", location: locationMatch ? locationMatch[1].trim() : "", workMode,
    minExperience: minExpMatch ? parseInt(minExpMatch[1], 10) : null,
    maxExperience: maxExpMatch && maxExpMatch[2] ? parseInt(maxExpMatch[2], 10) : null,
    requiredSkills: [...new Set(requiredSkills)], preferredSkills: [...new Set(preferredSkills)], requiredTools: [],
    education: educationMatch.map(s => s.trim()).slice(0, 3), certifications: certMatch.map(s => s.trim()).slice(0, 3),
    industries: [], domain: [],
    locationRequirements: /without sponsorship|us work authorization/i.test(text) ? ["US work authorization required"] : [],
    mandatoryRequirements, preferredRequirements: preferredLines.map((l, i) => ({ id: "auto_pref_" + i, text: l }))
  };
}

/* ================= Firm-wide screening rules (server-enforced) ========= */

const SENIOR_TITLE_KEYWORDS = [
  "director", "vice president", "vp ", " vp", "president", "chief", "cxo", "ceo", "coo", "cfo", "cto", "cio",
  "head of", "general manager", " gm ", "owner", "partner", "executive director", "svp", "evp", "principal"
];

function isSeniorTitle(title) {
  const t = " " + (title || "").toLowerCase() + " ";
  return SENIOR_TITLE_KEYWORDS.some(k => t.includes(k));
}

// Rule 1: "If a person leaves every job in a couple of months or 1-2 years and changes
// 4-5 jobs in last 5-6 years, we consider a job hopper and do not provide to client."
function detectJobHopper(candidate, opts) {
  const windowYears = (opts && opts.windowYears) || 6;
  const minJobs = (opts && opts.minJobs) || 4;
  const maxStintYears = (opts && opts.maxStintYears) || 2;
  const rEntries = parseTimelineEntries(candidate.resumeText || "");
  const liEntries = parseTimelineEntries(candidate.linkedinText || "");
  const source = rEntries.length ? rEntries : liEntries;
  const nowY = currentYear();
  const windowStart = nowY - windowYears;
  const parsed = source.map(e => {
    const startY = parseInt((e.start.match(/\d{4}/) || [0])[0], 10);
    const endY = /present|current/i.test(e.end) ? nowY : parseInt((e.end.match(/\d{4}/) || [0])[0], 10);
    return { ...e, startY, endY, durationYears: Math.max(0, endY - startY) };
  }).filter(e => e.startY && e.endY);
  const recent = parsed.filter(e => e.endY >= windowStart);
  const shortStints = recent.filter(e => e.durationYears <= maxStintYears);
  const isHopper = recent.length >= minJobs && shortStints.length >= minJobs;
  return { isHopper, recentJobCount: recent.length, shortStintCount: shortStints.length, windowYears, minJobs, jobs: recent };
}

// Rule 2: "If someone working since 1985 we do not consider them until the job title
// in above to director." — very long careers (40+ yrs) are excluded unless currently
// Director-level or above.
function detectSeniorityGate(candidateText, currentTitle, thresholdYear) {
  const threshold = thresholdYear || 1985;
  const intervals = mergeIntervals(extractIntervals(candidateText));
  if (!intervals.length) return { applies: false };
  const earliestStart = Math.min(...intervals.map(i => i.start));
  if (earliestStart > threshold) return { applies: false, earliestStart };
  return { applies: true, earliestStart, isSenior: isSeniorTitle(currentTitle) };
}

/* ---------------- Core candidate evaluation --------------------------*/

function buildStrongest(matchedSkills, relevantYears, minReq, industryStatus) {
  const items = [];
  matchedSkills.filter(s => s.required).slice(0, 5).forEach(s => items.push(`Demonstrated experience with ${s.skill}${s.years ? ` (${s.years}+ years)` : ""}.`));
  if (relevantYears >= minReq) items.push(`Meets or exceeds the ${minReq}-year relevant experience requirement (${relevantYears.toFixed(1)} years).`);
  if (industryStatus === "Match") items.push("Direct experience in the required industry/domain.");
  return items.slice(0, 5);
}

function evaluateCandidate(candidate, jd, weights, screeningRules) {
  const rules = screeningRules || {};
  const combinedText = [candidate.resumeText, candidate.linkedinText].filter(Boolean).join("\n\n");
  const hasResume = !!(candidate.resumeText && candidate.resumeText.trim());
  const hasLinkedIn = !!(candidate.linkedinText && candidate.linkedinText.trim());

  const nameFromText = candidate.name || "Unknown Candidate";
  const liEntries = parseTimelineEntries(candidate.linkedinText || "");
  const rEntries = parseTimelineEntries(candidate.resumeText || "");
  const entryRecency = e => /present|current/i.test(e.end) ? 9999 : (parseInt((e.end.match(/\d{4}/) || [0])[0], 10) || 0);
  const allEntries = [...liEntries, ...rEntries].sort((a, b) => entryRecency(b) - entryRecency(a));
  const topEntry = allEntries[0];
  const headlineMatch = (candidate.linkedinText || "").match(/^[^\n\-]+-\s*(.+?)\s+at\s+(.+)$/m);
  const currentTitle = topEntry ? topEntry.title : (headlineMatch ? headlineMatch[1].trim() : "Not Found");
  const currentCompany = topEntry ? topEntry.company : (headlineMatch ? headlineMatch[2].trim() : "Not Found");
  const locationMatch = combinedText.match(/\n([A-Za-z][A-Za-z .]{1,30},\s*[A-Za-z][A-Za-z .]{1,25})\n/);
  const location = locationMatch ? locationMatch[1].trim() : "Needs Verification";

  const allIntervals = mergeIntervals(extractIntervals(combinedText));
  const totalExperienceYears = sumYears(allIntervals);

  // Context-based "automation domain" classification (industrial vs home vs IT vs marketing
  // automation, etc.) exists to catch FALSE MATCHES for automation-engineering roles — e.g. a
  // "Home Automation Specialist" whose experience shouldn't count toward an industrial-robotics
  // requirement. It should only be applied when the job description actually flagged a
  // context-specific requirement (contextTag set on a mandatory requirement, which the JD
  // extractor only does when the requirement text itself mentions "robot", "industrial", or
  // "plc"). For any other kind of role, none of AUTOMATION_CONTEXTS' keywords will ever appear
  // in a candidate's work history, which used to silently zero out relevant experience for
  // every candidate regardless of how well they actually matched. When no requirement specifies
  // a contextTag, relevant experience is simply the candidate's total work-history experience —
  // there's nothing automation-specific to disambiguate against.
  const acceptableTags = [];
  if (jd.mandatoryRequirements) jd.mandatoryRequirements.forEach(r => { if (r.contextTag) acceptableTags.push(...relatedTagsFor(r.contextTag)); });
  const hasContextRequirement = acceptableTags.length > 0;
  const { years: relevantExperienceYears, tagged } = hasContextRequirement
    ? relevantYearsForContexts(combinedText, acceptableTags)
    : { years: totalExperienceYears, tagged: [] };

  const dominantOffContext = (() => {
    const counts = {};
    tagged.forEach(t => { if (t.tag && !acceptableTags.includes(t.tag)) counts[t.tag] = (counts[t.tag] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries[0][0] : null;
  })();

  const requiredSkills = jd.requiredSkills || [];
  const preferredSkills = jd.preferredSkills || [];
  const matchedSkills = [];
  const missingSkills = [];
  [...requiredSkills.map(s => ({ name: s, required: true })), ...preferredSkills.map(s => ({ name: s, required: false }))]
    .forEach(({ name, required }) => {
      const ev = findSkillEvidence(combinedText, name);
      if (ev.found) matchedSkills.push({ skill: name, required, years: ev.explicitYears, evidence: ev.context });
      else missingSkills.push({ skill: name, required });
    });

  const reqMatchedCount = matchedSkills.filter(s => s.required).length;
  const reqTotal = requiredSkills.length || 1;
  const prefMatchedCount = matchedSkills.filter(s => !s.required).length;
  const prefTotal = preferredSkills.length || 1;
  let technicalSkillsScore = ((reqMatchedCount / reqTotal) * 0.8 + (prefMatchedCount / prefTotal) * 0.2) * 10;
  if (dominantOffContext) technicalSkillsScore *= 0.75;
  technicalSkillsScore = clamp(technicalSkillsScore, 0, 10);

  const minReq = jd.minExperience || 0;
  let relevantExperienceScore;
  if (minReq === 0) relevantExperienceScore = 7;
  else if (relevantExperienceYears >= minReq) relevantExperienceScore = clamp(8 + (relevantExperienceYears - minReq) * 0.3, 8, 10);
  else if (relevantExperienceYears <= 0) relevantExperienceScore = 1;
  else relevantExperienceScore = clamp((relevantExperienceYears / minReq) * 7, 1, 7);

  const industries = jd.industries || [];
  let industryScore = 5, industryStatus = "Needs Verification", industryDetail = "No specific industry requirement configured.";
  if (industries.length) {
    const lower = combinedText.toLowerCase();
    const hit = industries.find(i => lower.includes(i.toLowerCase().split(" ")[0]));
    if (hit) { industryScore = 9; industryStatus = "Match"; industryDetail = `Evidence of ${hit} experience found.`; }
    else if (dominantOffContext) {
      industryScore = 1.5; industryStatus = "Mismatch";
      industryDetail = `Candidate's automation experience is primarily in ${AUTOMATION_CONTEXTS[dominantOffContext].label}, not ${industries.join("/")}.`;
    } else {
      industryScore = 3.5; industryStatus = "Not Found"; industryDetail = `No explicit evidence of ${industries.join(" or ")} experience found.`;
    }
  }

  const requiredTools = jd.requiredTools || [];
  let toolsMatched = 0;
  requiredTools.forEach(t => { if (findSkillEvidence(combinedText, t).found) toolsMatched++; });
  const toolsScore = requiredTools.length ? clamp((toolsMatched / requiredTools.length) * 10, 0, 10) : 7;

  const jdRespWords = new Set((jd.rawText || "").toLowerCase().match(/\b[a-z]{5,}\b/g) || []);
  const candWords = new Set(combinedText.toLowerCase().match(/\b[a-z]{5,}\b/g) || []);
  let overlap = 0; jdRespWords.forEach(w => { if (candWords.has(w)) overlap++; });
  const responsibilitiesScore = clamp((overlap / Math.max(20, jdRespWords.size * 0.15)) * 10, 2, 10);

  const eduMatch = matchEducation(combinedText, jd.education || []);
  const certMatch = matchCertifications(combinedText, (jd.certifications || []).map(c => c.split(" ")[0] === "Six" ? "Six Sigma" : c));
  const eduScore = eduMatch.status === "Match" ? 10 : eduMatch.status === "Partial" ? 6 : eduMatch.status === "Needs Verification" ? 5 : 2;
  const certScore = certMatch.status === "Match" ? 10 : certMatch.status === "Partial" ? 6 : certMatch.status === "N/A" ? 7 : 3;
  const educationCertScore = (eduScore * 0.7 + certScore * 0.3);

  const workAuth = detectWorkAuth(combinedText);
  let locationOtherScore = 7;
  if (jd.locationRequirements && jd.locationRequirements.some(r => /authorization|sponsorship/i.test(r))) {
    locationOtherScore = workAuth === "Authorized (No Sponsorship)" ? 10 : workAuth === "Requires Sponsorship" ? 1 : 5;
  }

  const catScores = {
    technicalSkills: technicalSkillsScore, relevantExperience: relevantExperienceScore, industryDomain: industryScore,
    toolsTech: toolsScore, responsibilities: responsibilitiesScore, educationCert: educationCertScore, locationOther: locationOtherScore
  };

  const w = weights || DEFAULT_WEIGHTS;
  const wSum = Object.values(w).reduce((a, b) => a + b, 0) || 100;
  const overallScore = clamp(Object.entries(catScores).reduce((sum, [k, v]) => sum + v * (w[k] / wSum), 0), 0, 10);

  const hardRequirements = (jd.mandatoryRequirements || []).map(req => {
    let status = "needs_verification", detail = "";
    if (req.type === "experience") {
      const years = req.contextTag ? relevantYearsForContexts(combinedText, relatedTagsFor(req.contextTag)).years : relevantExperienceYears;
      if (!hasResume && !hasLinkedIn) { status = "needs_verification"; detail = "No candidate text available to verify."; }
      else if (years >= (req.minYears || 0)) { status = "pass"; detail = `Verified ${years.toFixed(1)} relevant years (required ${req.minYears}).`; }
      else { status = "fail"; detail = `Candidate has ${years.toFixed(1)} relevant year(s) in this context; required ${req.minYears}.`; }
    } else if (req.type === "skill") {
      const skillName = req.skill || req.text;
      const ev = findSkillEvidence(combinedText, skillName);
      status = ev.found ? "pass" : "fail";
      detail = ev.found ? `Evidence found: "${ev.context.slice(0, 90)}..."` : `No evidence of "${skillName}" found in available text.`;
    } else if (req.type === "education") {
      status = eduMatch.status === "Match" ? "pass" : eduMatch.status === "Not Found" ? "fail" : "needs_verification";
      detail = eduMatch.detail;
    } else if (req.type === "other") {
      if (/sponsor|visa|authoriz/i.test(req.text)) {
        status = workAuth === "Authorized (No Sponsorship)" ? "pass" : workAuth === "Requires Sponsorship" ? "fail" : "needs_verification";
        detail = `Work authorization signal: ${workAuth}.`;
      } else { status = "needs_verification"; detail = "Requires manual verification."; }
    }
    return { id: req.id, text: req.text, status, detail, disqualifying: !!req.disqualifying };
  });

  // ---- Firm-wide screening rules (Section: internal policy, server-enforced) ----
  let jobHopperResult = null, seniorityResult = null;
  if (rules.jobHopperEnabled !== false) {
    jobHopperResult = detectJobHopper(candidate, {
      windowYears: rules.jobHopperWindowYears || 6,
      minJobs: rules.jobHopperMinJobs || 4,
      maxStintYears: rules.jobHopperMaxStintYears || 2
    });
    if (jobHopperResult.isHopper) {
      hardRequirements.push({
        id: "policy_job_hopper", text: "Internal policy: job stability screening", status: "fail",
        detail: `${jobHopperResult.recentJobCount} jobs in the last ${jobHopperResult.windowYears} years, ${jobHopperResult.shortStintCount} lasting ${rules.jobHopperMaxStintYears || 2} years or less.`,
        disqualifying: rules.jobHopperAutoExclude !== false
      });
    }
  }
  if (rules.seniorityGateEnabled !== false) {
    seniorityResult = detectSeniorityGate(combinedText, currentTitle, rules.seniorityThresholdYear || 1985);
    if (seniorityResult.applies && !seniorityResult.isSenior) {
      hardRequirements.push({
        id: "policy_seniority_gate", text: `Internal policy: candidates with career history since ${rules.seniorityThresholdYear || 1985} require a Director-level+ title`,
        status: "fail",
        detail: `Earliest career evidence found in ${seniorityResult.earliestStart}; current title "${currentTitle}" is not Director-level or above.`,
        disqualifying: rules.seniorityGateAutoExclude !== false
      });
    }
  }

  const hardFailBlocking = hardRequirements.some(r => r.status === "fail" && r.disqualifying);
  const recommendation = recommendationFor(overallScore, hardFailBlocking);
  const matchPercent = Math.round(overallScore * 10);

  let confidence = "Medium";
  const dataPoints = (hasResume ? 1 : 0) + (hasLinkedIn ? 1 : 0);
  if (dataPoints === 2 && allIntervals.length >= 2) confidence = "High";
  if (dataPoints === 0) confidence = "Low";

  const consistency = compareLinkedInResume(candidate.linkedinText, candidate.resumeText);

  const redFlags = [];
  if (relevantExperienceYears < minReq) {
    redFlags.push({ type: "Insufficient Relevant Experience", severity: "high", text: `Only ${relevantExperienceYears.toFixed(1)} relevant year(s) found against a ${minReq}-year requirement.` });
  }
  if (dominantOffContext) {
    redFlags.push({ type: "Industry/Domain Mismatch", severity: "high", text: `Automation experience appears concentrated in ${AUTOMATION_CONTEXTS[dominantOffContext].label}, not the required domain. Needs Verification.` });
  }
  if (jobHopperResult && jobHopperResult.isHopper) {
    redFlags.push({ type: "Job Hopper (Policy)", severity: "high", text: `${jobHopperResult.recentJobCount} jobs in the last ${jobHopperResult.windowYears} years, ${jobHopperResult.shortStintCount} lasting ${rules.jobHopperMaxStintYears || 2} years or less — fails internal job-stability policy.` });
  } else if (allIntervals.length >= 3) {
    const avgTenure = totalExperienceYears / allIntervals.length;
    if (avgTenure < 1.2) redFlags.push({ type: "Job Hopping", severity: "medium", text: `Average tenure across ${allIntervals.length} roles is approximately ${avgTenure.toFixed(1)} years. Needs Verification.` });
  }
  if (seniorityResult && seniorityResult.applies && !seniorityResult.isSenior) {
    redFlags.push({ type: "Seniority Gate (Policy)", severity: "high", text: `Career history dates back to ${seniorityResult.earliestStart}; internal policy requires Director-level+ title for candidates this senior. Current title: "${currentTitle}".` });
  }
  if (missingSkills.some(s => s.required)) {
    redFlags.push({ type: "Missing Mandatory Skill", severity: "high", text: `Missing required skill(s): ${missingSkills.filter(s => s.required).map(s => s.skill).join(", ")}.` });
  }
  if (consistency.status === "Review Required") {
    redFlags.push({ type: "Resume/LinkedIn Inconsistency", severity: "medium", text: "Discrepancies found between resume and LinkedIn profile. Needs Verification." });
  }
  if (allIntervals.length && (currentYear() - Math.max(...allIntervals.map(i => i.end))) > 2) {
    redFlags.push({ type: "Experience Appears Outdated", severity: "medium", text: "Most recent relevant experience appears to have ended more than 2 years ago. Needs Verification." });
  }

  const verificationItems = [];
  matchedSkills.forEach(s => { if (!s.years) verificationItems.push(`Duration of "${s.skill}" experience not explicitly stated — Needs Verification.`); });
  if (!hasResume) verificationItems.push("No resume on file — evaluation based on LinkedIn/profile text only.");
  if (location === "Needs Verification") verificationItems.push("Candidate location could not be confidently determined.");

  const topMatches = matchedSkills.filter(s => s.required).slice(0, 3).map(s => s.skill);
  const missingReq = missingSkills.filter(s => s.required).map(s => s.skill);
  let explanation = `Candidate has ${relevantExperienceYears.toFixed(1)} years of relevant experience against the required ${minReq} years` +
    (totalExperienceYears !== relevantExperienceYears ? ` (${totalExperienceYears.toFixed(1)} years total career experience).` : ".") +
    (topMatches.length ? ` Strong evidence of ${topMatches.join(", ")}.` : " Limited direct evidence of the core required skills was found.") +
    (missingReq.length ? ` However, there is no clear evidence of ${missingReq.join(", ")}.` : "") +
    (dominantOffContext ? ` Note: a portion of the candidate's "automation" experience is in ${AUTOMATION_CONTEXTS[dominantOffContext].label}, which does not directly translate to the required domain.` : "") +
    (industryStatus === "Match" ? ` Candidate has direct experience in the required industry.` : industryStatus === "Mismatch" ? ` Candidate's industry background does not align with the role's requirements.` : "") +
    (jobHopperResult && jobHopperResult.isHopper ? ` This candidate does not meet the firm's job-stability policy.` : "") +
    (seniorityResult && seniorityResult.applies && !seniorityResult.isSenior ? ` This candidate's long career history requires a Director-level+ title per firm policy, which was not found.` : "");

  return {
    candidateInfo: {
      name: nameFromText, currentTitle, currentCompany, location,
      totalExperienceYears: Number(totalExperienceYears.toFixed(1)),
      relevantExperienceYears: Number(relevantExperienceYears.toFixed(1)),
      education: eduMatch.detail, certifications: certMatch.detail
    },
    skills: { matched: matchedSkills, missing: missingSkills },
    industryMatch: { status: industryStatus, detail: industryDetail },
    educationMatch: eduMatch, certificationMatch: certMatch, workAuthorization: workAuth,
    hardRequirements, hardFailBlocking, categoryScores: catScores,
    overallScore: Number(overallScore.toFixed(1)), matchPercent, recommendation, confidence, explanation,
    redFlags, verificationItems, consistency,
    strongestQualifications: buildStrongest(matchedSkills, relevantExperienceYears, minReq, industryStatus),
    policyChecks: { jobHopper: jobHopperResult, seniorityGate: seniorityResult },
    generatedAt: new Date().toISOString(), provider: "mock"
  };
}

/* ---------------- Optional live AI provider (org-wide Anthropic key) --- */

async function callAnthropic(apiKey, model, systemPrompt, userPrompt) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model || "claude-sonnet-4-5", max_tokens: 1800, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] })
  });
  if (!resp.ok) throw new Error(`AI provider error (${resp.status})`);
  const data = await resp.json();
  const text = (data.content || []).map(c => c.text || "").join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI provider returned no parseable JSON");
  return JSON.parse(jsonMatch[0]);
}

async function evaluateCandidateLive(candidate, jd, weights, screeningRules) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return evaluateCandidate(candidate, jd, weights, screeningRules);
  try {
    const sys = `You are an evidence-based recruiting quality-assurance AI. Never invent candidate experience. If information cannot be verified, respond with "Not Found" or "Needs Verification". Distinguish contextually similar but different domains (industrial vs home vs IT vs marketing automation). Return ONLY a single JSON object, no prose.`;
    const userPrompt = `JOB DESCRIPTION (structured):\n${JSON.stringify(jd)}\n\nSCORING WEIGHTS:\n${JSON.stringify(weights)}\n\nCANDIDATE:\nName: ${candidate.name}\nLinkedIn URL: ${candidate.linkedinUrl}\nLinkedIn text:\n${candidate.linkedinText || "(none)"}\n\nResume text:\n${candidate.resumeText || "(none)"}\n\nReturn JSON with keys: candidateInfo, skills{matched,missing}, industryMatch, educationMatch, certificationMatch, workAuthorization, hardRequirements, categoryScores{technicalSkills,relevantExperience,industryDomain,toolsTech,responsibilities,educationCert,locationOther}, overallScore, matchPercent, recommendation, confidence, explanation, redFlags, verificationItems, consistency, strongestQualifications.`;
    const result = await callAnthropic(apiKey, process.env.ANTHROPIC_MODEL, sys, userPrompt);
    result.provider = "anthropic:" + (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5");
    result.generatedAt = new Date().toISOString();
    if (result.hardRequirements) result.hardFailBlocking = result.hardRequirements.some(r => r.status === "fail" && r.disqualifying);
    return result;
  } catch (err) {
    console.warn("Live AI evaluation failed, falling back to mock engine:", err.message);
    const fallback = evaluateCandidate(candidate, jd, weights, screeningRules);
    fallback.providerError = String(err.message || err);
    return fallback;
  }
}

module.exports = {
  extractIntervals, mergeIntervals, sumYears, classifyContext, parseTimelineEntries,
  extractJDFromText, evaluateCandidate, evaluateCandidateLive,
  compareLinkedInResume, detectWorkAuth, detectJobHopper, detectSeniorityGate,
  hasLiveProvider: () => !!process.env.ANTHROPIC_API_KEY
};
