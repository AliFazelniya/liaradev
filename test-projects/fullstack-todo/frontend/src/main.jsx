import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { addTodo, getTodos } from "./api.js";

function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = () => getTodos().then(setTodos).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 480, margin: "40px auto" }}>
      <h1>Todos</h1>
      {error && <p style={{ color: "crimson" }}>API error: {error}</p>}
      <form onSubmit={async (e) => { e.preventDefault(); if (title) { await addTodo(title); setTitle(""); load(); } }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New todo" /> <button>Add</button>
      </form>
      <ul>{todos.map((t) => <li key={t._id}>{t.title}</li>)}</ul>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
