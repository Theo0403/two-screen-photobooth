
const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();

const useHttps = process.env.SSL_KEY && process.env.SSL_CERT && fs.existsSync(process.env.SSL_KEY) && fs.existsSync(process.env.SSL_CERT);
const server = useHttps
  ? https.createServer({key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT)}, app)
  : http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

io.on("connection", socket => {
  socket.on("create-room", cb => {
    let room;
    do room = code(); while (rooms.has(room));
    rooms.set(room, {host: socket.id, users: new Map()});
    socket.join(room);
    socket.data.room = room;
    socket.data.role = "host";
    cb({room});
  });

  socket.on("join-room", ({room, name}, cb) => {
    room = String(room || "").toUpperCase();
    const data = rooms.get(room);
    if (!data) return cb({ok:false, error:"Room not found."});
    const members = [];
    for (const [id, nm] of data.users) { if (id !== socket.id) members.push({id, name:nm}); }
    if (data.host !== socket.id) members.push({id:data.host, name:"Host", host:true});
    data.users.set(socket.id, name || "Guest");
    socket.join(room);
    socket.data.room = room;
    socket.data.role = "guest";
    socket.data.name = name || "Guest";
    socket.to(room).emit("participant-joined", {id:socket.id, name:socket.data.name});
    cb({ok:true, room, name:socket.data.name, members});
  });

  socket.on("broadcast-photo", payload => {
    const room = socket.data.room;
    if (room) {
      const name = (payload && payload.name) || socket.data.name || (socket.data.role === "host" ? "Host" : "Guest");
      io.to(room).emit("new-photo", Object.assign({}, payload, {name}));
    }
  });

  socket.on("clear-photo", () => {
    const room = socket.data.room;
    if (room) io.to(room).emit("photo-cleared");
  });

  socket.on("countdown", n => {
    const room = socket.data.room;
    if (room) io.to(room).emit("countdown", n);
  });

  socket.on("sync-shot", payload => {
    const room = socket.data.room;
    if (room) socket.to(room).emit("sync-shot", payload);
  });

  socket.on("guest-frame", payload => {
    const room = socket.data.room;
    if (room) socket.to(room).emit("guest-frame", payload);
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    const data = rooms.get(room);
    if (!data) return;
    if (data.host === socket.id) {
      io.to(room).emit("room-closed");
      rooms.delete(room);
    } else {
      data.users.delete(socket.id);
      socket.to(room).emit("participant-left", {id:socket.id});
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  const proto = useHttps ? "https" : "http";
  console.log("2-screen photobooth running on port " + port + " (" + proto + ")");
  const addrs = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) addrs.push(iface.address);
    }
  }
  console.log("Open on this PC:     " + proto + "://localhost:" + port);
  console.log("Share with devices:  " + proto + "://" + (addrs[0] || "?") + ":" + port);
  if (!useHttps && addrs[0])
    console.log("NOTE: Camera only works in a secure context. Use https:// (set SSL_KEY/SSL_CERT) or localhost for camera access.");
});
