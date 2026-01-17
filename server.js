const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

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
                        target.send(message); // Send raw data to other player
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
