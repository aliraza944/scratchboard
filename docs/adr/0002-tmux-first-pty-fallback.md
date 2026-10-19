# Sessions run in tmux when it's installed, otherwise in Scratchboard's own pty terminal

Scratchboard has to work on Windows, where there is no tmux. Sessions therefore sit behind a small backend interface (start, list, kill, open). `auto`, the default, picks **tmux** whenever it's on the PATH, because it's the founder's preferred tool and its Sessions outlive Scratchboard. Otherwise it picks **pty**: Scratchboard runs `claude` in a pseudo-terminal it owns (node-pty, ConPTY on Windows) and shows it in an xterm.js terminal in the board's side panel. `--backend tmux|pty` overrides the choice.

## Consequences

- With pty, Sessions end when Scratchboard stops. That's acceptable because Relaunch resumes the conversation (`claude --resume <id>`), and Scratchboard runs as a background process per repo, so closing a terminal doesn't stop it.
- The board serves its browser libraries from node_modules, and the terminal WebSocket only accepts the board's own origin, because it is a shell on your machine.

## Considered Options

- **pty everywhere**: one behaviour on every OS, but it would replace the tmux workflow the founder uses daily.
- **WezTerm's multiplexer**: cross-platform native windows, but it only works for WezTerm users.
- **Windows Terminal or other "open a tab" launchers**: they can't report whether a Session is still running or kill it, so Session ended, Release and Relaunch break.
- **Headless `claude -p` with a chat UI**: it would mean rebuilding Claude Code's interface, and interactive grilling is weakest in headless mode.
