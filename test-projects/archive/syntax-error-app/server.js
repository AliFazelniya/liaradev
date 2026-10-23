const express = require("express");
const app = express();
const todos = [{ id: 1, title: "write tests", done: false }];

app.use(express.json());

app.get("/", (req, res) => res.json({ service: "todo-api", todos: todos.length }));

app.post("/todos", (req, res) => {
  const todo = { id: todos.length + 1, title: req.body?.title ?? "", done: false };
  todos.push(todo);
  res.status(201).json(todo);

app.get("/todos", (req, res) => res.json(todos));

app.listen(process.env.PORT || 3000, () => console.log("todo-api listening"));
