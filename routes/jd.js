const express = require("express");
const { requireAuth } = require("../auth");
const Engine = require("../engine");

const router = express.Router();
router.use(requireAuth);

router.post("/extract", async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });
  res.json(Engine.extractJDFromText(text));
});

module.exports = router;
