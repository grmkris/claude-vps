const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({
    status: 'ok',
    container: process.env.HOSTNAME || 'unknown',
    path: req.url,
    method: req.method,
    headers: req.headers
  }, null, 2));
});

server.listen(8080, '0.0.0.0', () => {
  console.log('HTTP server listening on port 8080');
});
