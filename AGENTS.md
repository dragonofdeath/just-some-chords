# Just Some Chords — agent notes

Mobile-first songwriting app (Tonaly-inspired): circle-of-fifths chord wheel,
shared song parts, rhythm patterns, bass/drums, looping, public share links.
Wix Managed Headless (Astro 5 + one React island), hosted on Wix.

## ⚠️ Keep the user documentation in sync

**`src/content/help.md` is the user-facing help page (`/help`). Any change to
user-visible behavior MUST update it in the same commit** — new features,
changed interactions, renamed controls, removed capabilities. It documents
nuances (shared-part edit semantics, mute vs pattern-off, iOS silent switch,
autosave rules), so check whether your change invalidates any of them.

## Architecture map

- **The member area is an SPA**: `src/components/App.tsx` (wouter router)
  is mounted by dataless Astro shells `src/pages/songs/[...rest].astro` and
  `playlists/[...rest].astro`. All list↔editor navigation is client-side —
  the host's SSR baseline is ~1.4s/page and uncacheable, so NEVER reintroduce
  server data-fetching pages for in-app navigation. Public share pages
  (`/s/`, `/p/`), landing and `/help` stay SSR.
- `src/lib/appCache.ts` — session in-memory cache (member via `/api/me`,
  songs, playlists) + login redirect helper; invalidate on mutations
- `src/components/icons.tsx` — the shared SVG icon set (24×24 grid, stroke,
  currentColor). All UI icons come from here — no inline SVGs or unicode
  glyphs as icons in components
- `src/components/SongList.tsx` / `PlaylistList.tsx` — list routes
- `src/components/SongEditor.tsx` — the editor island (state, selection,
  playback scheduling, autosave, undo/redo, sheets orchestration)
- `src/components/PartView.tsx` — arrangement list (parts/lines/measures,
  hold-to-move)
- `src/components/sheets/*` — bottom sheets (sound, tempo, split, patterns,
  measure settings, part/line, share)
- `src/lib/songModel.ts` — SongDocV2 types, migration (v1→v2), immutable
  mutation helpers. The whole doc lives in the schemaless `sections` field of
  the `songs` CMS collection — no schema changes needed for new fields, but
  every new field needs sanitizing in `migrateSong`
- `src/lib/timeline.ts` — pure timeline builder (the playback engine input)
- `src/components/Metronome.tsx` + `sheets/DrumKitSheet.tsx` +
  `src/lib/metronome.ts` — the metronome tool (`/metronome`, SPA route, no
  login gate, settings in localStorage): classic face, drum-machine engine
  (click subdivisions / drums.ts presets / custom kick-snare-hat grid), gap
  trainer (N bars of sound, M bars silent)
- `src/lib/wakeLock.ts` — screen wake lock used by song playback and the
  metronome. MUST be enabled synchronously inside the user's tap (iOS rejects
  requests outside a fresh gesture); falls back to a muted looping video when
  the Wake Lock API is missing/denied/released (broken in iOS home-screen
  apps until iOS 18.4 — WebKit bug 254545)
- `src/lib/patterns.ts` / `drums.ts` / `theory.ts` / `audio.ts` /
  `sampler.ts` — rhythm generators, drum synth, music theory, Web Audio,
  sample banks (`public/samples`, CC-BY tonejs-instruments)
- `src/components/PlaylistEditor.tsx` — playlist manager island (rename,
  add/reorder/remove songs, share, delete)
- `src/pages/api/*` — song + playlist CRUD (member session rides
  automatically) and the elevated public share read
- `src/lib/ai.ts` + `src/components/sheets/AiSheet.tsx` — one-shot AI song
  assistant (whitelist in `ai.ts` gates the button). The BROWSER calls the
  ideju-sukurys ai-gateway directly (`bo.wix.com/_api/ideju-ai-gateway`,
  hardcoded on purpose — public repo, Wix-network-only service, and that
  network reachability IS the access gate): `/generate-by-object` (Sonnet 5)
  and `/transcribe` (Whisper); the gateway reflects CORS for any origin.
  Do NOT route this through an /api/* endpoint — the site-host kills API
  routes long before a full-song generation (~30-60s) finishes; that was a
  real production 502. The model returns prose + optionally one ```json
  block with the FULL updated song; `migrateSong` coerces the doc (no
  zod/JSON-schema — one sanitizer, one place). The system prompt embeds
  `SONG_FORMAT_SPEC` and `help.md?raw` — keep the spec in sync when the
  song model changes
- Playlists: `playlists` collection (title, `songIds.list`, shareId),
  member-scoped like `songs`; public pages `/p/[shareId]` (list) and
  `/p/[shareId]/[songId]` (editor fork) read elevated, gated by the shareId

## Working rules learned the hard way

- **Pointer events are unreliable on some iPhones** — interactive elements
  use `click` (plus touch/mouse events for gestures), never pointer-only
- Build: `npm run build`; deploy: `CI=1 npm exec -y -- @wix/cli@latest release`
  (release only when frontend output changed — backend content is fetched at
  runtime)
- Autosave must never redirect anonymous users to login (silent mode + local
  draft stash)
- The `songs` and `playlists` collections are member-scoped
  (`SITE_MEMBER_AUTHOR`); public share access goes through `auth.elevate`
  only in `/api/shared/[shareId]` and the `/p/[shareId]` pages
- Playlist writes must filter `songIds` to the caller's own songs
  (`ownedOnly` in `playlistFields.ts`) — the public playlist page reads
  songs ELEVATED, so an unchecked id would publish someone else's song
