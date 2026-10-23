// Loads a ~700 MB in-memory dataset at startup and keeps it (no leak). The smallest plan (0.5 GB) kills it again and again
// (OOM); a 1 GB plan runs it fine, so the right fix is a bigger plan, not a code change.
const express = require("express");
const chunks = [];
for (let i = 0; i < 700; i++) chunks.push(Buffer.alloc(1024 * 1024, i % 255)); // 700 x 1 MB
console.log(`dataset loaded: ${chunks.length} MB`);
const app = express();
app.get("/", (_req, res) => res.send(`dataset ready: ${chunks.length} MB`));
app.listen(process.env.PORT || 3000, () => console.log("memory-heavy listening"));
