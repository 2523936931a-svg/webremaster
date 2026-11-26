const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;

http
  .createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const file = url === "/" ? "index.html" : url.replace(/^\//, "");
    const target = path.join(root, file);
    if (target.startsWith(root) && fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(target));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  })
  .listen(4190, "127.0.0.1", () => {
    console.log("1998 mock site: http://127.0.0.1:4190/");
  });
