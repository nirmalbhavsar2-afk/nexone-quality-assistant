const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractTextFromBuffer(buffer, filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "txt") return buffer.toString("utf8");
  if (ext === "pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === "doc") {
    throw new Error("Legacy .doc format isn't supported for text extraction — please convert to PDF/DOCX or paste the resume text manually.");
  }
  throw new Error("Unsupported file type: " + ext);
}

module.exports = { extractTextFromBuffer };
