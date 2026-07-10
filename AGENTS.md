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
- `src/lib/patterns.ts` / `drums.ts` / `theory.ts` / `audio.ts` /
  `sampler.ts` — rhythm generators, drum synth, music theory, Web Audio,
  sample banks (`public/samples`, CC-BY tonejs-instruments)
- `src/pages/api/*` — song CRUD (member session rides automatically) and the
  elevated public share read

## Working rules learned the hard way

- **Pointer events are unreliable on some iPhones** — interactive elements
  use `click` (plus touch/mouse events for gestures), never pointer-only
- Build: `npm run build`; deploy: `CI=1 npm exec -y -- @wix/cli@latest release`
  (release only when frontend output changed — backend content is fetched at
  runtime)
- Autosave must never redirect anonymous users to login (silent mode + local
  draft stash)
- The `songs` collection is member-scoped (`SITE_MEMBER_AUTHOR`); public
  share access goes through `auth.elevate` in `/api/shared/[shareId]` only
