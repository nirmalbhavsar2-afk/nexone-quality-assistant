/* pdl.js — People Data Labs Person Enrichment lookups.
   Converts a LinkedIn URL into the same loosely-formatted profile text
   the app expects from a pasted LinkedIn profile, so engine.js's existing
   date/skill/timeline parsing works unchanged. */

const PDL_ENRICH_URL = "https://api.peopledatalabs.com/v5/person/enrich";

function formatDate(d) {
  if (!d) return null;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(d);
  if (!m) return null;
  const year = m[1];
  if (!m[2]) return year;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mi = parseInt(m[2], 10) - 1;
  return (mi >= 0 && mi < 12) ? `${months[mi]} ${year}` : year;
}

function formatProfileText(data) {
  const lines = [];
  const name = data.full_name || [data.first_name, data.last_name].filter(Boolean).join(" ") || "Unknown Candidate";
  const title = data.job_title || (data.experience?.[0]?.title?.name) || "";
  const company = data.job_company_name || (data.experience?.[0]?.company?.name) || "";
  lines.push(title && company ? `${name} - ${title} at ${company}` : name);
  lines.push("");

  const locParts = [data.location_locality, data.location_region].filter(Boolean);
  if (locParts.length) { lines.push(locParts.join(", ")); lines.push(""); }

  if (data.summary) { lines.push(data.summary); lines.push(""); }

  (data.experience || []).forEach(e => {
    const t = e.title?.name, c = e.company?.name, start = formatDate(e.start_date);
    const end = e.end_date ? formatDate(e.end_date) : "Present";
    if (t && c && start) {
      lines.push(`${t} at ${c} — ${start} - ${end}`);
      if (e.summary) lines.push(e.summary);
      lines.push("");
    }
  });

  (data.education || []).forEach(ed => {
    const school = ed.school?.name;
    const degrees = (ed.degrees || []).join(", ");
    const endYear = ed.end_date ? formatDate(ed.end_date) : "";
    if (school) lines.push(`Education: ${degrees ? degrees + ", " : ""}${school}${endYear ? " (" + endYear + ")" : ""}`);
  });
  lines.push("");

  if (Array.isArray(data.skills) && data.skills.length) lines.push(`Skills: ${data.skills.join(", ")}`);

  return lines.join("\n").trim();
}

async function enrichFromLinkedInUrl(linkedinUrl) {
  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) throw new Error("PDL_API_KEY is not configured on the server");
  const url = `${PDL_ENRICH_URL}?api_key=${encodeURIComponent(apiKey)}&profile=${encodeURIComponent(linkedinUrl)}`;
  const resp = await fetch(url);
  if (resp.status === 404) throw new Error("No LinkedIn match found via People Data Labs");
  if (!resp.ok) throw new Error(`People Data Labs error (${resp.status})`);
  const body = await resp.json();
  if (!body?.data) throw new Error("People Data Labs returned no profile data");
  return formatProfileText(body.data);
}

module.exports = { enrichFromLinkedInUrl };
