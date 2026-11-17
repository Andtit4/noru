//! noru play rooms server: the multiplayer relay of noru-play games (`webSocketTransport`).
//!
//! Players of a room see each other's state and exchange messages; the server only relays them (it
//! does not know the rules of the games). std only, one thread per connection. Served by `noru dev`
//! at `/@noru/play`, and by `noru play-server` for production.
//!
//! Messages are JSON text frames:
//!   player -> server: {t:"join", room, name, avatar, state} (first message), {t:"state", state},
//!                     {t:"msg", data, to?}, {t:"leave"}
//!   server -> player: {t:"welcome", me, players}, {t:"join", player}, {t:"leave", id},
//!                     {t:"state", id, state}, {t:"msg", from, data}, {t:"error", message}

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Map, Value};

use crate::serve::{read_request, Request};

/// Where `noru dev` and `noru preview` serve the rooms.
pub(crate) const PATH: &str = "/@noru/play";
const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// Largest frame (or fragmented message) accepted from a player.
const MAX_FRAME: usize = 64 * 1024;
/// Largest message relayed: the 16 kB the SDK allows, plus the envelope.
const MAX_MESSAGE: usize = 17 * 1024;
const MAX_NAME: usize = 40;
const MAX_AVATAR: usize = 2048;
/// Messages per second a player may send (bursts up to twice as many).
const RATE: f64 = 60.0;
/// Silence after which the server pings a player, and after which it gives up on them.
const IDLE: Duration = Duration::from_secs(20);
const DEAD: Duration = Duration::from_secs(60);

#[derive(Clone, Debug)]
pub struct RoomsConfig {
    /// Players per room (default: 16).
    pub max_players: usize,
    /// Origins of the pages allowed to connect, e.g. "https://example.com" (empty: any).
    pub allowed_origins: Vec<String>,
}

impl Default for RoomsConfig {
    fn default() -> Self {
        Self { max_players: 16, allowed_origins: Vec::new() }
    }
}

enum Out {
    Text(String),
    Ping,
    Pong(Vec<u8>),
    Close(u16),
}

struct Member {
    id: String,
    name: String,
    avatar: Value,
    state: Value,
    out: Sender<Out>,
}

impl Member {
    fn public(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "avatar": self.avatar, "state": self.state })
    }
}

/// The rooms and their players.
pub struct Rooms {
    config: RoomsConfig,
    rooms: Mutex<HashMap<String, Vec<Member>>>,
    next_id: AtomicU64,
}

impl Rooms {
    pub fn new(config: RoomsConfig) -> Self {
        // Ids differ from one start of the server to the next.
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_micros() as u64 & 0xffff_ffff)
            .unwrap_or(1);
        Self { config, rooms: Mutex::new(HashMap::new()), next_id: AtomicU64::new(seed << 8) }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Vec<Member>>> {
        self.rooms.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Number of rooms, and of players in them.
    pub fn counts(&self) -> (usize, usize) {
        let rooms = self.lock();
        (rooms.len(), rooms.values().map(Vec::len).sum())
    }

    fn join(&self, msg: &Map<String, Value>, out: &Sender<Out>) -> Result<(String, String), &'static str> {
        let room = msg.get("room").and_then(Value::as_str).unwrap_or("");
        if !valid_room(room) {
            return Err("invalid room name");
        }
        let name: String = msg
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_NAME)
            .collect::<String>()
            .trim()
            .to_string();
        let avatar = match msg.get("avatar").and_then(Value::as_str) {
            Some(a) if a.len() <= MAX_AVATAR => Value::String(a.to_string()),
            _ => Value::Null,
        };
        let state = msg.get("state").cloned().unwrap_or(Value::Null);
        let id = format!("p{:x}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut rooms = self.lock();
        let members = rooms.entry(room.to_string()).or_default();
        if members.len() >= self.config.max_players {
            return Err("this room is full");
        }
        let member = Member { id: id.clone(), name, avatar, state, out: out.clone() };
        // Sent while the rooms are locked: the welcome comes before anything else of this room.
        let players: Vec<Value> = members.iter().map(Member::public).collect();
        let _ = out.send(Out::Text(json!({ "t": "welcome", "me": member.public(), "players": players }).to_string()));
        let joined = json!({ "t": "join", "player": member.public() }).to_string();
        for other in members.iter() {
            let _ = other.out.send(Out::Text(joined.clone()));
        }
        members.push(member);
        Ok((room.to_string(), id))
    }

    fn set_state(&self, room: &str, id: &str, state: Value) {
        let mut rooms = self.lock();
        let Some(members) = rooms.get_mut(room) else { return };
        let text = json!({ "t": "state", "id": id, "state": state }).to_string();
        for member in members.iter_mut() {
            if member.id == id {
                member.state = state.clone();
            } else {
                let _ = member.out.send(Out::Text(text.clone()));
            }
        }
    }

    fn relay(&self, room: &str, from: &str, data: Value, to: Option<&str>) {
        let rooms = self.lock();
        let Some(members) = rooms.get(room) else { return };
        let text = json!({ "t": "msg", "from": from, "data": data }).to_string();
        for member in members {
            let wanted = match to {
                Some(to) => member.id == to,
                None => member.id != from,
            };
            if wanted && member.id != from {
                let _ = member.out.send(Out::Text(text.clone()));
            }
        }
    }

    fn leave(&self, room: &str, id: &str) {
        let mut rooms = self.lock();
        let Some(members) = rooms.get_mut(room) else { return };
        members.retain(|m| m.id != id);
        if members.is_empty() {
            rooms.remove(room);
            return;
        }
        let text = json!({ "t": "leave", "id": id }).to_string();
        for member in members.iter() {
            let _ = member.out.send(Out::Text(text.clone()));
        }
    }
}

fn valid_room(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}

/// The rooms of `noru dev` / `noru preview` (one set per process).
pub(crate) fn shared() -> &'static Arc<Rooms> {
    static ROOMS: OnceLock<Arc<Rooms>> = OnceLock::new();
    ROOMS.get_or_init(|| Arc::new(Rooms::new(RoomsConfig::default())))
}

fn write_plain(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

/// Answers a request for the rooms: a WebSocket upgrade becomes a player; a plain GET gets the
/// numbers of rooms and players (a health check).
pub(crate) fn handle(mut stream: TcpStream, req: &Request, rooms: &Arc<Rooms>) -> io::Result<()> {
    let upgrade = req.header("upgrade").is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let key = req.header("sec-websocket-key").map(str::trim).filter(|k| !k.is_empty());
    let (true, Some(key)) = (upgrade, key) else {
        let (count, players) = rooms.counts();
        let body = format!("{{\"server\":\"noru play rooms\",\"rooms\":{count},\"players\":{players}}}");
        return write_plain(&mut stream, "200 OK", "application/json", &body);
    };
    if !rooms.config.allowed_origins.is_empty() {
        let origin = req.header("origin").unwrap_or("");
        if !rooms.config.allowed_origins.iter().any(|allowed| allowed == origin) {
            return write_plain(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", "origin not allowed");
        }
    }
    let accept = base64::engine::general_purpose::STANDARD.encode(sha1(format!("{key}{GUID}").as_bytes()));
    stream.write_all(
        format!(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        .as_bytes(),
    )?;
    let _ = stream.set_nodelay(true);
    connection(stream, rooms)
}

/// A token bucket: RATE messages per second, bursts of twice as many.
struct Bucket {
    tokens: f64,
    at: Instant,
    warned: Option<Instant>,
}

impl Bucket {
    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.at).as_secs_f64() * RATE).min(RATE * 2.0);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

fn send_error(out: &Sender<Out>, message: &str) {
    let _ = out.send(Out::Text(json!({ "t": "error", "message": message }).to_string()));
}

fn connection(stream: TcpStream, rooms: &Arc<Rooms>) -> io::Result<()> {
    let (out, inbox) = mpsc::channel::<Out>();
    let writer_stream = stream.try_clone()?;
    let _ = writer_stream.set_write_timeout(Some(Duration::from_secs(10)));
    let writer = std::thread::spawn(move || write_loop(writer_stream, inbox));
    let _ = stream.set_read_timeout(Some(IDLE));
    let mut reader = FrameReader { stream: stream.try_clone()?, last_seen: Instant::now() };
    let mut player: Option<(String, String)> = None; // (room, id)
    let mut bucket = Bucket { tokens: RATE * 2.0, at: Instant::now(), warned: None };
    let result = (|| -> io::Result<()> {
        loop {
            let Some(text) = reader.next_message(&out)? else { return Ok(()) };
            if !bucket.take() {
                if bucket.warned.is_none_or(|at| at.elapsed() > Duration::from_secs(1)) {
                    bucket.warned = Some(Instant::now());
                    send_error(&out, "too many messages: some were dropped");
                }
                continue;
            }
            if text.len() > MAX_MESSAGE {
                send_error(&out, "message too large");
                continue;
            }
            let Ok(Value::Object(msg)) = serde_json::from_str::<Value>(&text) else { continue };
            let kind = msg.get("t").and_then(Value::as_str).unwrap_or("");
            match (&player, kind) {
                (None, "join") => match rooms.join(&msg, &out) {
                    Ok(joined) => player = Some(joined),
                    Err(message) => {
                        send_error(&out, message);
                        return Ok(());
                    }
                },
                (None, _) => send_error(&out, "join a room first"),
                (Some((room, id)), "state") => {
                    rooms.set_state(room, id, msg.get("state").cloned().unwrap_or(Value::Null))
                }
                (Some((room, id)), "msg") => rooms.relay(
                    room,
                    id,
                    msg.get("data").cloned().unwrap_or(Value::Null),
                    msg.get("to").and_then(Value::as_str),
                ),
                (Some(_), "leave") => return Ok(()),
                _ => {}
            }
        }
    })();
    if let Some((room, id)) = &player {
        rooms.leave(room, id);
    }
    let _ = out.send(Out::Close(1000));
    drop(out);
    let _ = writer.join();
    let _ = stream.shutdown(Shutdown::Both);
    match result {
        // A player who disappears (closed tab, lost network) is not an error.
        Err(e)
            if matches!(
                e.kind(),
                io::ErrorKind::UnexpectedEof | io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted
            ) =>
        {
            Ok(())
        }
        other => other,
    }
}

fn write_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> io::Result<()> {
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);
    if payload.len() < 126 {
        frame.push(payload.len() as u8);
    } else if payload.len() <= 0xffff {
        frame.push(126);
        frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    }
    frame.extend_from_slice(payload);
    stream.write_all(&frame)
}

fn write_loop(mut stream: TcpStream, inbox: Receiver<Out>) {
    for out in inbox {
        let result = match out {
            Out::Text(text) => write_frame(&mut stream, 0x1, text.as_bytes()),
            Out::Ping => write_frame(&mut stream, 0x9, b""),
            Out::Pong(payload) => write_frame(&mut stream, 0xA, &payload),
            Out::Close(code) => {
                let _ = write_frame(&mut stream, 0x8, &code.to_be_bytes());
                return;
            }
        };
        if result.is_err() {
            // A player that stopped reading: drop the connection (its reader ends too).
            let _ = stream.shutdown(Shutdown::Both);
            return;
        }
    }
}

struct FrameReader {
    stream: TcpStream,
    last_seen: Instant,
}

fn protocol_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "websocket protocol error")
}

impl FrameReader {
    /// Fills `buf`. With `idle_ok`, a timeout before the first byte returns `Ok(false)`; a timeout in
    /// the middle of a frame keeps waiting (up to DEAD), so frames are never cut.
    fn fill(&mut self, buf: &mut [u8], idle_ok: bool) -> io::Result<bool> {
        let mut read = 0;
        let started = Instant::now();
        while read < buf.len() {
            match self.stream.read(&mut buf[read..]) {
                Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
                Ok(n) => {
                    read += n;
                    self.last_seen = Instant::now();
                }
                Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {
                    if read == 0 && idle_ok {
                        return Ok(false);
                    }
                    if started.elapsed() > DEAD {
                        return Err(e);
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        Ok(true)
    }

    /// The next text message of the player (pings are answered here). `None`: the player closed.
    fn next_message(&mut self, out: &Sender<Out>) -> io::Result<Option<String>> {
        let mut message: Vec<u8> = Vec::new();
        let mut fragmented = false;
        loop {
            let mut head = [0u8; 2];
            if !self.fill(&mut head, true)? {
                if self.last_seen.elapsed() > DEAD {
                    return Ok(None);
                }
                let _ = out.send(Out::Ping);
                continue;
            }
            let fin = head[0] & 0x80 != 0;
            let opcode = head[0] & 0x0f;
            if head[0] & 0x70 != 0 {
                return Err(protocol_error());
            }
            let masked = head[1] & 0x80 != 0;
            let mut len = u64::from(head[1] & 0x7f);
            if len == 126 {
                let mut b = [0u8; 2];
                self.fill(&mut b, false)?;
                len = u64::from(u16::from_be_bytes(b));
            } else if len == 127 {
                let mut b = [0u8; 8];
                self.fill(&mut b, false)?;
                len = u64::from_be_bytes(b);
            }
            // Browsers always mask their frames; control frames are short.
            if !masked || (opcode >= 0x8 && len > 125) {
                let _ = out.send(Out::Close(1002));
                return Ok(None);
            }
            if len > MAX_FRAME as u64 || message.len() as u64 + len > MAX_FRAME as u64 {
                let _ = out.send(Out::Close(1009));
                return Ok(None);
            }
            let mut mask = [0u8; 4];
            self.fill(&mut mask, false)?;
            let mut payload = vec![0u8; len as usize];
            self.fill(&mut payload, false)?;
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[i % 4];
            }
            match opcode {
                0x8 => return Ok(None),
                0x9 => {
                    let _ = out.send(Out::Pong(payload));
                }
                0xA => {}
                0x1 | 0x2 if !fragmented => {
                    if fin {
                        return Ok(String::from_utf8(payload).ok());
                    }
                    message = payload;
                    fragmented = true;
                }
                0x0 if fragmented => {
                    message.extend_from_slice(&payload);
                    if fin {
                        return Ok(String::from_utf8(std::mem::take(&mut message)).ok());
                    }
                }
                _ => {
                    let _ = out.send(Out::Close(1002));
                    return Ok(None);
                }
            }
        }
    }
}

/// SHA-1, for the WebSocket handshake only.
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut out = [0u8; 20];
    for (i, value) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

/// `noru play-server`: the rooms server alone, for production (any path is the rooms endpoint).
pub struct PlayServer {
    addr: SocketAddr,
    rooms: Arc<Rooms>,
    shutdown: Arc<AtomicBool>,
    accept_thread: Mutex<Option<JoinHandle<()>>>,
}

impl PlayServer {
    /// Starts serving on `host:port` (`port = 0` picks a free port).
    pub fn start(host: &str, port: u16, config: RoomsConfig) -> io::Result<Self> {
        let listener = TcpListener::bind((host, port))?;
        let addr = listener.local_addr()?;
        let rooms = Arc::new(Rooms::new(config));
        let shutdown = Arc::new(AtomicBool::new(false));
        let (accept_rooms, accept_shutdown) = (Arc::clone(&rooms), Arc::clone(&shutdown));
        let accept_thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if accept_shutdown.load(Ordering::Relaxed) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let rooms = Arc::clone(&accept_rooms);
                std::thread::spawn(move || {
                    if let Ok(req) = read_request(&stream) {
                        let _ = handle(stream, &req, &rooms);
                    }
                });
            }
        });
        Ok(Self { addr, rooms, shutdown, accept_thread: Mutex::new(Some(accept_thread)) })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.addr
    }

    /// Number of rooms, and of players in them.
    pub fn counts(&self) -> (usize, usize) {
        self.rooms.counts()
    }

    pub fn close(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let mut wake = self.addr;
        if wake.ip().is_unspecified() {
            wake.set_ip(std::net::Ipv4Addr::LOCALHOST.into());
        }
        let _ = TcpStream::connect(wake);
        if let Some(handle) = self.accept_thread.lock().ok().and_then(|mut h| h.take()) {
            let _ = handle.join();
        }
    }

    /// Blocks until the server is closed.
    pub fn wait(&self) {
        let handle = self.accept_thread.lock().ok().and_then(|mut h| h.take());
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};

    #[test]
    fn handshake_accept_key() {
        // The example of RFC 6455.
        let accept = base64::engine::general_purpose::STANDARD
            .encode(sha1(format!("dGhlIHNhbXBsZSBub25jZQ=={GUID}").as_bytes()));
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
        assert!(valid_room("cloud-acres:fr_1.2"));
        assert!(!valid_room("") && !valid_room("a b") && !valid_room(&"x".repeat(65)));
    }

    /// A minimal WebSocket client for the tests.
    struct Client {
        stream: TcpStream,
    }

    impl Client {
        fn connect(addr: SocketAddr) -> Client {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .write_all(b"GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("HTTP/1.1 101"), "{line}");
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            Client { stream }
        }

        fn send(&mut self, value: Value) {
            let payload = value.to_string().into_bytes();
            let mask = [1u8, 2, 3, 4];
            let mut frame = vec![0x81];
            if payload.len() < 126 {
                frame.push(0x80 | payload.len() as u8);
            } else {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
            }
            frame.extend_from_slice(&mask);
            frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
            self.stream.write_all(&frame).unwrap();
        }

        fn receive(&mut self) -> Value {
            loop {
                let mut head = [0u8; 2];
                self.stream.read_exact(&mut head).unwrap();
                let mut len = usize::from(head[1] & 0x7f);
                if len == 126 {
                    let mut b = [0u8; 2];
                    self.stream.read_exact(&mut b).unwrap();
                    len = usize::from(u16::from_be_bytes(b));
                }
                let mut payload = vec![0u8; len];
                self.stream.read_exact(&mut payload).unwrap();
                if head[0] & 0x0f == 0x1 {
                    return serde_json::from_slice(&payload).unwrap();
                }
            }
        }
    }

    #[test]
    fn players_meet_in_a_room() {
        let server = PlayServer::start("127.0.0.1", 0, RoomsConfig { max_players: 2, ..Default::default() }).unwrap();
        let mut ama = Client::connect(server.local_addr());
        ama.send(json!({ "t": "join", "room": "farm", "name": "Ama", "state": { "x": 1 } }));
        let welcome = ama.receive();
        assert_eq!(welcome["t"], "welcome");
        assert_eq!(welcome["players"].as_array().unwrap().len(), 0);
        let ama_id = welcome["me"]["id"].as_str().unwrap().to_string();

        let mut kofi = Client::connect(server.local_addr());
        kofi.send(json!({ "t": "join", "room": "farm", "name": "Kofi\u{7}", "avatar": "/k.png" }));
        let welcome = kofi.receive();
        assert_eq!(welcome["players"][0]["name"], "Ama");
        assert_eq!(welcome["players"][0]["state"]["x"], 1);
        assert_eq!(welcome["me"]["name"], "Kofi", "control characters removed");
        let kofi_id = welcome["me"]["id"].as_str().unwrap().to_string();
        let joined = ama.receive();
        assert_eq!((joined["t"].as_str(), joined["player"]["id"].as_str()), (Some("join"), Some(kofi_id.as_str())));

        kofi.send(json!({ "t": "state", "state": { "x": 5 } }));
        let state = ama.receive();
        assert_eq!((state["t"].as_str(), state["state"]["x"].as_i64()), (Some("state"), Some(5)));
        ama.send(json!({ "t": "msg", "data": { "gift": "egg" } }));
        let msg = kofi.receive();
        assert_eq!((msg["from"].as_str(), msg["data"]["gift"].as_str()), (Some(ama_id.as_str()), Some("egg")));
        ama.send(json!({ "t": "msg", "data": "hi", "to": kofi_id }));
        assert_eq!(kofi.receive()["data"], "hi");

        // The room holds two players.
        let mut third = Client::connect(server.local_addr());
        third.send(json!({ "t": "join", "room": "farm" }));
        assert_eq!(third.receive()["message"], "this room is full");
        assert_eq!(server.counts(), (1, 2));

        drop(kofi);
        let left = ama.receive();
        assert_eq!((left["t"].as_str(), left["id"].as_str()), (Some("leave"), Some(kofi_id.as_str())));
        server.close();
    }
}
