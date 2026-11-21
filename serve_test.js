const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const server = http.createServer((req, res) => {
  let filePath = path.join(root, req.url.split("?")[0]);
  if (filePath.endsWith("/")) filePath = path.join(filePath, "scratch_test.html");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };
  res.writeHead(200, {
    "Content-Type": mimeMap[ext] || "application/octet-stream",
    "Access-Control-Allow-Origin": "*"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(8089, "127.0.0.1", () => {
  console.log("Test server running at http://127.0.0.1:8089/scratch_test.html");
});
