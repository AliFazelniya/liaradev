const express = require("express");
const app = express();
app.get("/", (_req, res) => res.send("<h1>Healthy app</h1><p>Everything works.</p>"));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log("healthy-app listening"));
