const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn("WARNING: JWT_SECRET not set in environment — using a random secret for this process only. " +
    "All logins will be invalidated on restart. Set JWT_SECRET in your .env for production.");
  return crypto.randomBytes(32).toString("hex");
})();

const ROLES = ["Admin", "Recruiter", "QA Agent", "Viewer"];

function uid(prefix) { return (prefix || "id") + "_" + crypto.randomBytes(8).toString("hex"); }

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function comparePassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    next();
  };
}

function ensureSeedAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL || "admin@nexellence.com";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const id = uid("user");
  db.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)")
    .run(id, "Nirmal Bhavsar", email, hashPassword(password), "Admin");
  console.log("=".repeat(70));
  console.log("Seeded first Admin account:");
  console.log("  Email:   ", email);
  console.log("  Password:", password);
  console.log("Set ADMIN_EMAIL / ADMIN_PASSWORD env vars before first run to customize this.");
  console.log("Change this password after first login (Settings > Users).");
  console.log("=".repeat(70));
}

module.exports = { ROLES, uid, hashPassword, comparePassword, signToken, requireAuth, requireRole, ensureSeedAdmin };
