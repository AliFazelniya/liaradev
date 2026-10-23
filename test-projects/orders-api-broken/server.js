const http = require("http");

const port = process.env.PORT || 3000;

function loadConfig() {
  const required = ["DATABASE_URL"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  return { databaseUrl: process.env.DATABASE_URL };
}

console.log("orders-api starting...");
const config = loadConfig();
console.log("configuration loaded");

const orders = [
  { id: 1, item: "keyboard", qty: 2 },
  { id: 2, item: "monitor", qty: 1 },
];

http
  .createServer((req, res) => {
    console.log(new Date().toISOString(), req.method, req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") return res.end(JSON.stringify({ ok: true }));
    if (req.url === "/orders") return res.end(JSON.stringify(orders));
    res.end(JSON.stringify({ service: "orders-api", status: "running" }));
  })
  .listen(port, () => console.log(`orders-api listening on ${port}`));
