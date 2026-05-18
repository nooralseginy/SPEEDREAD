# SPEEDREAD

A minimal RSVP (Rapid Serial Visual Presentation) speed reader. Drop in an
EPUB, PDF, or TXT and read it one word at a time on a black canvas with the
ORP letter highlighted so your eye stays fixed.

## Run it

PDF and EPUB parsing pulls modules from a CDN, which requires an `http(s)://`
origin (not `file://`). Easiest local option:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Plain TXT files work over `file://` too.

Deploy to GitHub Pages, Netlify, Vercel, or any static host — no build step.

## Controls

| Action | Mouse / Touch | Keyboard |
| --- | --- | --- |
| Play / pause | Tap the word, or ▶/⏸ | `Space` |
| ±1 word | — | `← / →` |
| ±1 sentence | ◀◀ / ▶▶ | `Shift + ← / →` |
| ±25 WPM | − / + or slider | `↑ / ↓` |
| Back to library | ✕ | `Esc` |

WPM range is 100–1000 in steps of 25. Sentence-ending punctuation gets a
slightly longer pause for natural pacing.

## Storage

Documents and reading progress live in your browser's `localStorage` (capped
around 4 MB per file). Clear browser data to reset.
