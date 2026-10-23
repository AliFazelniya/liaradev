export const API_URL = "http://localhost:4000";
export const getTodos = () => fetch(`${API_URL}/api/todos`).then((r) => r.json());
export const addTodo = (title) => fetch(`${API_URL}/api/todos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }).then((r) => r.json());
