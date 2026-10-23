const express = require("express");
const { v4: uuid } = require("uuid");

const app = express();
const notes = [];
app.use(express.json());
app.get("/", (req, res) => res.json({ service: "notes-api", notes: notes.length }));
app.post("/notes", (req, res) => { const n = { id: uuid(), text: req.body?.text ?? "" }; notes.push(n); res.status(201).json(n); });
app.listen(process.env.PORT || 3000, () => console.log("notes-api listening"));
