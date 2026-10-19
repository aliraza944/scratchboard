// pty backend, the fallback when tmux isn't installed (e.g. Windows): Scratchboard
// runs each Session in a pseudo-terminal it owns (ConPTY on Windows) and streams it
// to the board page, where the Session tab shows it in a browser terminal.
// Sessions end when Scratchboard stops; Relaunch resumes the conversation.
import pty from 'node-pty';
import { childEnv } from '../platform.js';

const SCROLLBACK = 512 * 1024; // characters of output replayed to a newly opened terminal

export function createPtyBackend() {
  const sessions = new Map(); // key -> { proc, alive, output, clients, cols, rows }

  const send = (s, msg) => { const json = JSON.stringify(msg); for (const c of s.clients) c.send(json); };

  function stop(key) {
    const s = sessions.get(key);
    if (!s) return;
    if (s.alive) { try { s.proc.kill(); } catch { /* already gone */ } }
    send(s, { type: 'gone' });
    sessions.delete(key);
  }

  return {
    name: 'pty',
    label: 'the built-in terminal',
    inBrowser: true,
    async list() {
      return new Map([...sessions].map(([key, s]) => [key, { alive: s.alive }]));
    },
    // Replaces any ended Session for the Ticket (a Relaunch) but keeps its viewers.
    async start({ key, cwd, command, args }) {
      const prev = sessions.get(key);
      if (prev?.alive) try { prev.proc.kill(); } catch { /* already gone */ }
      const cols = prev?.cols ?? 120;
      const rows = prev?.rows ?? 34;
      const proc = pty.spawn(command, args, { name: 'xterm-256color', cols, rows, cwd, env: childEnv() });
      const s = { proc, alive: true, output: '', clients: prev?.clients ?? new Set(), cols, rows };
      sessions.set(key, s);
      send(s, { type: 'reset' });
      proc.onData((data) => {
        s.output = (s.output + data).slice(-SCROLLBACK);
        send(s, { type: 'data', data });
      });
      proc.onExit(({ exitCode }) => {
        if (sessions.get(key) !== s) return;
        s.alive = false;
        send(s, { type: 'exit', code: exitCode });
      });
    },
    async kill(key) { stop(key); },
    async open(key) {
      if (!sessions.has(key)) throw new Error('No Session for this Ticket. Relaunch to resume it.');
      return { inBrowser: true };
    },
    // Hooks a browser terminal (a WebSocket) up to the Ticket's Session.
    attach(key, socket) {
      const s = sessions.get(key);
      if (!s) { socket.send(JSON.stringify({ type: 'gone' })); socket.close(); return; }
      s.clients.add(socket);
      socket.send(JSON.stringify({ type: 'data', data: s.output }));
      if (!s.alive) socket.send(JSON.stringify({ type: 'exit' }));
      socket.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const cur = sessions.get(key);
        if (!cur?.alive) return;
        if (msg.type === 'input' && typeof msg.data === 'string') cur.proc.write(msg.data);
        if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
          cur.cols = Math.min(msg.cols | 0, 500);
          cur.rows = Math.min(msg.rows | 0, 200);
          cur.proc.resize(cur.cols, cur.rows);
        }
      });
      socket.on('close', () => sessions.get(key)?.clients.delete(socket));
    },
    stopAll() { for (const key of [...sessions.keys()]) stop(key); },
  };
}
