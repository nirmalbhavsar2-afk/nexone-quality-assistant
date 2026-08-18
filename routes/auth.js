const express = require("express");
const db = require("../db");
const { comparePassword, signToken, requireAuth } = require("../auth");

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!user || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = signToken(user);
  res.cookie("token", token, {
    httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

module.exports = router;
