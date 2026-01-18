const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
    if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Zombie Server Awake');
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WebSocket Server Running');
    }
});

const wss = new WebSocket.Server({ server });
let rooms = {};

// CONFIGURATION
const SPAWN_RATE = 2000; // Milliseconds between zombies

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            let data = JSON.parse(message);

            // 1. CREATE ROOM
            if (data.type === "create") {
                let code = Math.floor(1000 + Math.random() * 9000).toString();
                rooms[code] = { 
                    host: ws, 
                    client: null, 
                    gameActive: false,
                    timer: null,
                    wave: 1,
                    zombiesSent: 0
                };
                ws.room = code;
                ws.isHost = true;
                ws.send(JSON.stringify({ type: "created", code: code }));
                console.log("Room Created: " + code);
            }

            // 2. JOIN ROOM
            else if (data.type === "join") {
                let code = data.code;
                if (rooms[code] && !rooms[code].client) {
                    rooms[code].client = ws;
                    ws.room = code;
                    ws.isHost = false;
                    ws.send(JSON.stringify({ type: "joined", side: "client" }));
                    rooms[code].host.send(JSON.stringify({ type: "joined", side: "host" }));
                    console.log("Client Joined: " + code);
                } else {
                    ws.send(JSON.stringify({ type: "error", msg: "Invalid Code" }));
                }
            }

            // 3. START GAME (Triggered by Host)
            else if (data.type === "start_request") {
                if (ws.room && rooms[ws.room] && ws.isHost) {
                    let room = rooms[ws.room];
                    room.gameActive = true;
                    room.wave = 1;
                    room.zombiesSent = 0;
                    
                    // Tell both players to start
                    let startMsg = JSON.stringify({ 
                        type: "game", 
                        data: { subtype: "start", map: data.map, seed: Math.floor(Math.random() * 9999) } 
                    });
                    room.host.send(startMsg);
                    if (room.client) room.client.send(startMsg);

                    // START SERVER SIDE SPAWNER
                    clearInterval(room.timer);
                    room.timer = setInterval(() => {
                        if (!room.gameActive) return;
                        
                        // Simple Wave Logic
                        let maxZombies = 10 + (room.wave * 5);
                        if (room.zombiesSent < maxZombies) {
                            spawnZombie(room);
                            room.zombiesSent++;
                        }
                    }, SPAWN_RATE);
                }
            }

            // 4. GAME DATA RELAY (Position, Shooting, etc.)
            else if (data.type === "game") {
                if (ws.room && rooms[ws.room]) {
                    let room = rooms[ws.room];
                    
                    // Handle Pause Sync
                    if (data.data.subtype === "pause") {
                        room.gameActive = false; // Pause Spawner
                    } else if (data.data.subtype === "resume") {
                        room.gameActive = true; // Resume Spawner
                    }

                    // Relay message to the OTHER player
                    let target = ws.isHost ? room.client : room.host;
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(message); 
                    }
                }
            }

        } catch (e) { console.log(e); }
    });

    ws.on('close', () => {
        if (ws.room && rooms[ws.room]) {
            // Stop spawner
            clearInterval(rooms[ws.room].timer);
            
            let target = ws.isHost ? rooms[ws.room].client : rooms[ws.room].host;
            if (target) target.send(JSON.stringify({ type: "disconnect" }));
            delete rooms[ws.room];
        }
    });
});

function spawnZombie(room) {
    // Generate Random Position
    let axis = Math.random() > 0.5 ? 'x' : 'y';
    let x, y;
    
    // Hardcoded Map Size (1280x768)
    if (axis === 'x') {
        x = Math.random() * 1280;
        y = Math.random() > 0.5 ? -50 : 800;
    } else {
        x = Math.random() > 0.5 ? -50 : 1300;
        y = Math.random() * 768;
    }

    let payload = {
        type: "game",
        data: {
            subtype: "server_spawn",
            x: x,
            y: y,
            zId: Math.floor(Math.random() * 1000000),
            zType: Math.random() > 0.8 ? 1 : 0 // 20% chance for Skeleton
        }
    };

    let msg = JSON.stringify(payload);
    room.host.send(msg);
    if (room.client) room.client.send(msg);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
