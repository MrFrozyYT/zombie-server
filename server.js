const http = require('http');
const https = require('https'); // Added for pinging external Render URL
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Zombie Server Awake');
});

const wss = new WebSocket.Server({ server });
let rooms = {};

// SETTINGS
const SPAWN_DELAY = 2000;

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            let parsed = JSON.parse(message);
            let type = parsed.type;
            let payload = parsed.data;

            // 1. CREATE ROOM
            if (type === "create") {
                let code = Math.floor(1000 + Math.random() * 9000).toString();
                rooms[code] = { 
                    host: ws, client: null, gameActive: false,
                    timer: null, wave: 1, zombiesToSend: 0, zombiesSent: 0, zombiesKilled: 0, map: 0 
                };
                ws.room = code;
                ws.isHost = true;
                ws.send(JSON.stringify({ type: "created", code: code }));
                console.log(`Room ${code} created.`);
            }

            // 2. JOIN ROOM
            else if (type === "join") {
                let code = parsed.code;
                if (rooms[code] && !rooms[code].client) {
                    rooms[code].client = ws;
                    ws.room = code;
                    ws.isHost = false;
                    ws.send(JSON.stringify({ type: "joined", side: "client" }));
                    rooms[code].host.send(JSON.stringify({ type: "joined", side: "host" }));
                    console.log(`Client joined ${code}`);
                }
            }

            // 3. START GAME
            else if (type === "start_request") {
                if (ws.room && rooms[ws.room] && ws.isHost) {
                    let room = rooms[ws.room];
                    room.map = payload.map; 
                    
                    let startMsg = JSON.stringify({ type: "game", data: { subtype: "start", map: room.map } });
                    room.host.send(startMsg);
                    if (room.client) room.client.send(startMsg);
                    
                    startWave(room, 1);
                }
            }

            // 4. RESTART GAME
            else if (type === "restart") {
                if (ws.room && rooms[ws.room] && ws.isHost) {
                    let room = rooms[ws.room];
                    
                    // Reset Server Side Stats
                    room.wave = 1;
                    room.zombiesToSend = 0;
                    room.zombiesSent = 0;
                    room.zombiesKilled = 0;

                    // Tell clients to respawn
                    let restartMsg = JSON.stringify({ type: "game", data: { subtype: "restart" } });
                    room.host.send(restartMsg);
                    if (room.client) room.client.send(restartMsg);

                    // Start Wave 1 immediately
                    startWave(room, 1);
                }
            }

            // 5. GAMEPLAY RELAY
            else if (type === "game") {
                if (ws.room && rooms[ws.room]) {
                    let room = rooms[ws.room];

                    if (payload.subtype === "zombie_killed") {
                        room.zombiesKilled++;
                        if (room.zombiesKilled >= room.zombiesToSend) {
                            setTimeout(() => { startWave(room, room.wave + 1); }, 3000);
                        }
                    }
                    
                    let target = ws.isHost ? room.client : room.host;
                    if (target && target.readyState === WebSocket.OPEN) target.send(message);
                }
            }

        } catch (e) { console.log(e); }
    });

    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            clearInterval(rooms[ws.room].timer);
            let target = ws.isHost ? rooms[ws.room].client : rooms[ws.room].host;
            if (target) target.send(JSON.stringify({ type: "disconnect" }));
            delete rooms[ws.room];
        }
    });
});

function startWave(room, waveNum) {
    room.wave = waveNum;
    room.zombiesToSend = 10 + (waveNum * 5);
    room.zombiesSent = 0;
    room.zombiesKilled = 0;
    
    let msg = JSON.stringify({ type: "game", data: { subtype: "new_wave", wave: room.wave } });
    room.host.send(msg);
    if (room.client) room.client.send(msg);

    clearInterval(room.timer);
    room.timer = setInterval(() => {
        if (room.zombiesSent < room.zombiesToSend) {
            spawnZombie(room);
            room.zombiesSent++;
        }
    }, SPAWN_DELAY);
}

function spawnZombie(room) {
    let axis = Math.random() > 0.5 ? 'x' : 'y';
    let x = (axis === 'x') ? Math.random() * 1280 : (Math.random() > 0.5 ? -50 : 1300);
    let y = (axis === 'x') ? (Math.random() > 0.5 ? -50 : 800) : Math.random() * 768;
    
    // --- UPDATED LOGIC HERE ---
    let zType = 0; // Default = Zombie (Field)
    if (room.map === 1) zType = 1;      // Map 1 = Skeleton (Desert)
    else if (room.map === 2) zType = 2; // Map 2 = Golem (Snow)

    let payload = JSON.stringify({
        type: "game",
        data: { subtype: "server_spawn", x: x, y: y, zId: Math.floor(Math.random() * 999999), zType: zType }
    });
    room.host.send(payload);
    if (room.client) room.client.send(payload);
}

// --- KEEP AWAKE LOGIC FOR RENDER ---
// Ping the server every 10 minutes (600,000 ms)
setInterval(() => {
    // Render sets RENDER_EXTERNAL_URL environment variable automatically
    const url = process.env.RENDER_EXTERNAL_URL;
    
    if (url) {
        console.log(`Pinging ${url} to stay awake...`);
        https.get(url, (res) => {
            // Just consume the response so the event loop is happy
            res.on('data', () => {});
        }).on('error', (err) => {
            console.error(`Ping failed: ${err.message}`);
        });
    } else {
        console.log("No RENDER_EXTERNAL_URL found, skipping ping (Localhost?)");
    }
}, 600000); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
