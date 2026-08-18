require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const { ensureSeedAdmin } = require("./auth");
ensureSeedAdmin();

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/jd", require("./routes/jd"));
app.use("/api/files", require("./routes/files"));
app.use("/api/projects", require("./routes/projects"));

const Engine = require("./engine");
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString(), liveAiConfigured: Engine.hasLiveProvider() }));

app.use(express.static(path.join(__dirname, "public")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Centralized error handler (e.g. multer file-too-large, bad JSON body)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NexOne Quality Assistant server listening on port ${PORT}`);
});
