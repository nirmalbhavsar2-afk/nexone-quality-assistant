const express = require("express");
const db = require("../db");
const { uid, hashPassword, requireAuth, requireRole, ROLES } = require("../auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", requireRole("Admin"), (req, res) => {
  const users = db.prepare("SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC").all();
  res.json(users);
});

router.post("/", requireRole("Admin"), (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email, and password are required." });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "role must be one of: " + ROLES.join(", ") });
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (existing) return res.status(409).json({ error: "A user with that email already exists." });
  const id = uid("user");
  db.prepare("INSERT INTO users (id, name, email, password_hash, role) VALUES (?,?,?,?,?)")
    .run(id, name, String(email).toLowerCase().trim(), hashPassword(password), role);
  res.status(201).json({ id, name, email, role });
});

router.put("/:id", requireRole("Admin"), (req, res) => {
  const { name, role, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: "role must be one of: " + ROLES.join(", ") });
  db.prepare("UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?")
    .run(name || user.name, role || user.role, password ? hashPassword(password) : user.password_hash, user.id);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("Admin"), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account." });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
