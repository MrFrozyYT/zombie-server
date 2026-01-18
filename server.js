const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Zombie Server Awake');
});

const wss = new WebSocket.Server({ server });
let rooms = {};

// SETTINGS
const SPAWN_DELAY = 2000; // Time between zombie spawns

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            let parsed = JSON.parse(message);
            let type = parsed.type;
            let payload = parsed.data; // The GamePayload object

            // 1. CREATE ROOM
            if (type === "create") {
                let code = Math.floor(1000 + Math.random() * 9000).toString();
                rooms[code] = { 
                    host: ws, 
                    client: null, 
                    gameActive: false,
                    timer: null,
                    wave: 1,
                    zombiesToSend: 0,  // How many we need to spawn this wave
                    zombiesSent: 0,    // How many we have spawned
                    zombiesKilled: 0,  // How many died
                    map: 0             // 0 = Field, 1 = Desert
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
                } else {
                    ws.send(JSON.stringify({ type: "error", msg: "Invalid" }));
                }
            }

            // 3. START GAME REQUEST
            else if (type === "start_request") {
                if (ws.room && rooms[ws.room] && ws.isHost) {
                    let room = rooms[ws.room];
                    room.map = payload.map; // SAVE THE MAP SELECTION
                    startWave(room, 1);
                }
            }

            // 4. GAMEPLAY RELAY
            else if (type === "game") {
                if (ws.room && rooms[ws.room]) {
                    let room = rooms[ws.room];

                    // ** ZOMBIE KILLED LOGIC **
                    if (payload.subtype === "zombie_killed") {
                        room.zombiesKilled++;
                        // CHECK WAVE COMPLETE
                        if (room.zombiesKilled >= room.zombiesToSend) {
                            // Wave Cleared! Wait 3 seconds then start next.
                            setTimeout(() => {
                                startWave(room, room.wave + 1);
                            }, 3000);
                        }
                    }
                    
                    // Relay packet to other player
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
            clearInterval(rooms[ws.room].timer);
            let target = ws.isHost ? rooms[ws.room].client : rooms[ws.room].host;
            if (target) target.send(JSON.stringify({ type: "disconnect" }));
            delete rooms[ws.room];
        }
    });
});

function startWave(room, waveNum) {
    room.wave = waveNum;
    room.zombiesToSend = 10 + (waveNum * 5); // Example: Wave 1 = 15, Wave 2 = 20
    room.zombiesSent = 0;
    room.zombiesKilled = 0;
    room.gameActive = true;

    // Notify Players
    let msg = JSON.stringify({ 
        type: "game", 
        data: { subtype: "new_wave", map: room.map, wave: room.wave } 
    });
    room.host.send(msg);
    if (room.client) room.client.send(msg);

    // Start Spawner
    clearInterval(room.timer);
    room.timer = setInterval(() => {
        if (room.zombiesSent < room.zombiesToSend) {
            spawnZombie(room);
            room.zombiesSent++;
        }
    }, SPAWN_DELAY);
}

function spawnZombie(room) {
    // Generate Position
    let axis = Math.random() > 0.5 ? 'x' : 'y';
    let x, y;
    if (axis === 'x') {
        x = Math.random() * 1280;
        y = Math.random() > 0.5 ? -50 : 800;
    } else {
        x = Math.random() > 0.5 ? -50 : 1300;
        y = Math.random() * 768;
    }

    // *** MAP LOGIC FIX ***
    let zType = 0; // Default Zombie
    if (room.map === 1) { // 1 = Desert
        zType = Math.random() > 0.7 ? 1 : 0; // 30% chance of Skeleton in Desert
    }
    // If room.map === 0 (Field), zType stays 0.

    let payload = JSON.stringify({
        type: "game",
        data: {
            subtype: "server_spawn",
            x: x, y: y,
            zId: Math.floor(Math.random() * 999999),
            zType: zType
        }
    });

    room.host.send(payload);
    if (room.client) room.client.send(payload);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
