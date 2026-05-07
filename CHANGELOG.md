# Changelog

All notable changes to **3dprinter** are documented here. Format: [Keep a Changelog](https://keepachangelog.com/). Version source of truth: `VERSION` at repo root. SemVer; pre-1.0 treat MINOR like post-1.0 MAJOR.

## [Unreleased]

### Added
- Initial scaffold: `.gitignore`, `VERSION` (`0.1.0`), `README.md`, `CLAUDE.md`, `crosslog.md`, `CHANGELOG.md`, `docs/releaselog.md`, `docs/release-notes/` (empty).
- Worktree convention: `E:\Dev\worktrees\3dprinter\<branch>` with helper `scripts\new-worktree.ps1`.
- Registered in `~/.claude/project-ledger.json` under `systems.kantoor`.
- GitHub remote: `vinceverbon/3dprinter` (private).
- **Vue 3 frontend (`app/`)**: Vite + TypeScript + Tailwind CSS 4 + Pinia + Vue Router (hash mode) + Lucide icons + `vite-plugin-pwa` for installable PWA. Custom `helperPlugin` in `vite.config.ts` spawns the helper process alongside `npm run dev` and tears it down on Vite shutdown. App emits a heartbeat to `/api/heartbeat` every 15 s.
- **Filament CRUD**: list / add / edit / remove with manual swatch entry — color picker, 1–5 stop multicolor gradient, effects (matte / silk / sparkle / marble / metallic / glow / multicolor / translucent), 1–5 star rating, spool state, notes.
- **AI usage lookup**: "Lookup AI" button on filament form posts brand+name to `/api/lookup-filament`; renders P2S+AMS 2 Pro compatibility, drying spec, abrasive flag, print/bed temps, usage notes. (Helper-dependent — Chunk A.)
- **Empty-spool counter** with byType breakdown.
- **Settings page** with default brand and AI model selector.
- **Pinia stores + persistence layer**: `loadData` / `saveData` against helper `/data` + `/api/save-data`, with localStorage offline fallback.
- **Parallel-work spec** (`docs/parallel-work.md`): three claimable chunks (Helper / Catalog seed / Launcher) with file boundaries, API contracts, and acceptance criteria so multiple Claude Code sessions can work the project simultaneously.

### Changed

### Fixed

### Pending (Chunks owned by other chats)
- **Chunk A** — Helper service (`helper/index.mjs`): in-progress (Chat A).
- **Chunk B** — Catalog seed (`data/catalog/**`): unclaimed.
- **Chunk C** — `start.ps1` launcher: unclaimed.
