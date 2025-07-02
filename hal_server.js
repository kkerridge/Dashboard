const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const WebSocket = require('ws');

// === CONFIG ===
const HTTPS_PORT = 3003; // For browsers (WSS)
const HTTP_PORT = 3002;  // For ESPs (WS)
const STATIC_DIR = '/var/www/html'; // Folder where index.html, helm.html, etc. live

const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/boatlifesystems.co.uk/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/boatlifesystems.co.uk/fullchain.pem'),
};

// ===== Serve Static Files over HTTPS (Browsers) =====
const httpsServer = https.createServer(sslOptions, (req, res) => {
  const filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`Error serving file ${filePath}:`, err);
      res.writeHead(404);
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wssBrowser = new WebSocket.Server({ server: httpsServer });

// ===== HTTP Server for ESPs (WebSocket only, no files) =====
const httpServer = http.createServer();
const wssESP = new WebSocket.Server({ server: httpServer });

// ===== Shared WebSocket Logic =====
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function handleWebSocket(ws, label) {
  console.log(`[${label}] Client connected`);
  clients.add(ws);

  ws.on('message', (msg) => {
    console.log(`[${label}] Raw message received: ${msg.toString()}`);
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'setName') {
        ws.username = data.username || 'Unknown';
        console.log(`[${label}] Client set name: ${ws.username}`);
        return;
      }

      if (data.type === 'chat') {
        const payload = {
          type: 'chat',
          username: ws.username || 'Unknown',
          time: new Date().toLocaleTimeString(),
          text: data.text,
        };
        broadcast(payload);
      }
    } catch (err) {
      console.error(`[${label}] Invalid WS message:`, err, `Raw message: ${msg.toString()}`);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[${label}] Client disconnected`);
  });

  ws.on('error', (err) => {
    console.error(`[${label}] WebSocket error:`, err);
  });
}

// Hook up WebSocket servers to shared handler
wssBrowser.on('connection', (ws) => handleWebSocket(ws, 'WSS'));
wssESP.on('connection', (ws) => handleWebSocket(ws, 'WS'));

// ===== Start Both Servers =====
httpsServer.listen(HTTPS_PORT, () => {
  console.log(`✅ HTTPS + WSS server running at https://boatlifesystems.co.uk:${HTTPS_PORT}`);
});
httpServer.listen(HTTP_PORT, () => {
  console.log(`✅ HTTP + WS server running at http://boatlifesystems.co.uk:${HTTP_PORT}`);
});
