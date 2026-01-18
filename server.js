const http = require('http');
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
                    room.map = payload.map; // 0 = Field, 1 = Desert
                    
                    // Tell both players to switch to Playing State
                    let startMsg = JSON.stringify({ type: "game", data: { subtype: "start", map: room.map } });
                    room.host.send(startMsg);
                    if (room.client) room.client.send(startMsg);
                    
                    startWave(room, 1);
                }
            }

            // 4. GAMEPLAY RELAY
            else if (type === "game") {
                if (ws.room && rooms[ws.room]) {
                    let room = rooms[ws.room];

                    // SYNC KILLS
                    if (payload.subtype === "zombie_killed") {
                        room.zombiesKilled++;
                        if (room.zombiesKilled >= room.zombiesToSend) {
                            setTimeout(() => { startWave(room, room.wave + 1); }, 3000);
                        }
                    }
                    
                    // RELAY EVERYTHING TO OTHER PLAYER
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
    
    // *** FIX: STRICT MAP ENEMY TYPES ***
    // Map 0 (Field) = 0 (Zombie)
    // Map 1 (Desert) = 1 (Skeleton)
    let zType = (room.map === 1) ? 1 : 0;

    let payload = JSON.stringify({
        type: "game",
        data: { subtype: "server_spawn", x: x, y: y, zId: Math.floor(Math.random() * 999999), zType: zType }
    });
    room.host.send(payload);
    if (room.client) room.client.send(payload);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on ${PORT}`));
