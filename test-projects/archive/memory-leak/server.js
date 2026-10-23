// A request log that is never trimmed: memory grows forever. A bigger plan only delays the crash; the code must change.
const express = require("express");
const requestLog = [];
setInterval(() => {
  for (let i = 0; i < 20000; i++) requestLog.push({ at: Date.now(), blob: "x".repeat(200) });
  console.log(`memory rss=${Math.round(process.memoryUsage().rss / 1048576)}MB entries=${requestLog.length}`);
}, 3000);
const app = express();
app.get("/", (_req, res) => res.send(`entries: ${requestLog.length}`));
app.listen(process.env.PORT || 3000, () => console.log("memory-leak listening"));
