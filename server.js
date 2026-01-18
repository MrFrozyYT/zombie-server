const http = require('http');
const https = require('https'); // Used to ping the external URL
const WebSocket = require('ws');

// 1. SETUP HTTP SERVER (Needed to accept the ping)
const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Zombie Server is Awake!');
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WebSocket Server Running.');
    }
});

// 2. SETUP WEBSOCKET SERVER (Attached to HTTP server)
const wss = new WebSocket.Server({ server });

let rooms = {};

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            let data = JSON.parse(message);

            // HOST CREATES ROOM
            if (data.type === "create") {
                let code = Math.floor(1000 + Math.random() * 9000).toString();
                rooms[code] = { host: ws, client: null };
                ws.room = code;
                ws.isHost = true;
                ws.send(JSON.stringify({ type: "created", code: code }));
                console.log("Room Created: " + code);
            }

            // FRIEND JOINS ROOM
            else if (data.type === "join") {
                let code = data.code;
                if (rooms[code] && !rooms[code].client) {
                    rooms[code].client = ws;
                    ws.room = code;
                    ws.isHost = false;
                    ws.send(JSON.stringify({ type: "joined", side: "client" }));
                    rooms[code].host.send(JSON.stringify({ type: "joined", side: "host" }));
                    console.log("Joined Room: " + code);
                } else {
                    ws.send(JSON.stringify({ type: "error", msg: "Invalid Code" }));
                }
            }

            // RELAY GAME DATA
            else if (data.type === "game") {
                if (ws.room && rooms[ws.room]) {
                    let target = ws.isHost ? rooms[ws.room].client : rooms[ws.room].host;
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(message); 
                    }
                }
            }
        } catch (e) {}
    });

    // CLEANUP
    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            let target = ws.isHost ? rooms[ws.room].client : rooms[ws.room].host;
            if (target) target.send(JSON.stringify({ type: "disconnect" }));
            delete rooms[ws.room];
        }
    });
});

// 3. START THE SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

// 4. KEEP ALIVE LOGIC (The Self-Ping)
// Render gives you an environment variable: RENDER_EXTERNAL_URL
// If that doesn't exist, put your manual URL in the string below.
const MY_URL = process.env.RENDER_EXTERNAL_URL || 'https://YOUR-APP-NAME.onrender.com';

function keepAlive() {
    // Only ping if we are on the live server (HTTPS)
    if (MY_URL.includes('onrender.com')) {
        https.get(MY_URL + '/ping', (res) => {
            console.log(`[KeepAlive] Ping sent. Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`[KeepAlive] Error: ${err.message}`);
        });
    } else {
        // Optional: Ping localhost if running locally (HTTP)
        http.get(`http://localhost:${PORT}/ping`, (res) => {
             // console.log('Local ping successful'); // Commented out to reduce noise
        }).on('error', (e) => {});
    }
}

// Ping every 14 minutes (14 * 60 * 1000)
// Render sleeps after 15 minutes of inactivity
setInterval(keepAlive, 14 * 60 * 1000);
