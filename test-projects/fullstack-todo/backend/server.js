const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const Todo = mongoose.model("Todo", new mongoose.Schema({ title: String, done: { type: Boolean, default: false } }));
const app = express();
app.use(cors());
app.use(express.json());
app.get("/api/todos", async (_req, res) => res.json(await Todo.find().sort({ _id: -1 })));
app.post("/api/todos", async (req, res) => res.status(201).json(await Todo.create({ title: String(req.body.title || "").slice(0, 200) })));
app.get("/health", (_req, res) => res.json({ ok: mongoose.connection.readyState === 1 }));

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/todos"; // local default
mongoose.connect(uri).then(() => {
  app.listen(process.env.PORT || 4000, () => console.log("API ready"));
}).catch((e) => { console.error("Cannot connect to the database:", e.message); process.exit(1); });
