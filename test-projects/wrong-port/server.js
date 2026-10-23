// Listens on 8080 (APP_PORT), but the wizard cannot see that and deploys with port 3000 -> 502.
// The AI reads the log line below, notices the mismatch and proposes changing the app port to 8080.
const express = require("express");
const app = express();
app.get("/", (_req, res) => res.send("I listen on 8080"));
const port = process.env.APP_PORT || 8080;
app.listen(port, () => console.log(`Server started, listening on port ${port}`));
