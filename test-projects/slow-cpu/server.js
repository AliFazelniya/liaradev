// A "report generator" that does heavy synchronous work: it keeps the CPU pinned and makes every request slow.
const http = require("http");

function crunch(ms) {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) x += Math.sqrt(Math.random() * 1e6);
  return x;
}

// background recalculation that never stops
setInterval(() => crunch(90), 100);

http
  .createServer((req, res) => {
    const t = Date.now();
    crunch(400); // each request also burns CPU
    console.log(new Date().toISOString(), req.method, req.url, "took", Date.now() - t, "ms");
    res.end(JSON.stringify({ report: "ready", took: Date.now() - t }));
  })
  .listen(process.env.PORT || 3000, () => console.log("report-service listening"));
