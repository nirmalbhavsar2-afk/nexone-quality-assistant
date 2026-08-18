const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../auth");
const { extractTextFromBuffer } = require("../extractText");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(requireAuth);

// Generic PDF/DOC/DOCX/TXT -> text extraction, used by the New Review wizard for
// both JD files and resume files before a project/candidate exists in the DB.
router.post("/extract-text", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'file')." });
  try {
    const text = await extractTextFromBuffer(req.file.buffer, req.file.originalname);
    res.json({ text, filename: req.file.originalname });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

module.exports = router;
