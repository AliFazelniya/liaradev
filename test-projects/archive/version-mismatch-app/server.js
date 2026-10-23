// Written for Express 4: the "*" wildcard route is invalid in Express 5 and crashes at startup.
const express = require("express");
const app = express();

app.get("/", (req, res) => res.json({ service: "files-api", ok: true }));
app.get("/files/*", (req, res) => res.json({ path: req.params[0] }));

app.listen(process.env.PORT || 3000, () => console.log("files-api listening"));
