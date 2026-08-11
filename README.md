# Work Log

A single-page daily work/time tracker. Start a timer against a project and task, stop it to log an entry, and review your history in a filterable table with stats and Excel export. Backed by Supabase for auth, data, and screenshot storage, so entries sync across devices for a signed-in user.

## Features

- **Timer** — start/stop tracking against a project + task, with an optional remark, screenshots, and reference URLs attached to each entry.
- **Breaks** — one-click Lunch Break / Tea Break timers, logged as their own entries.
- **Screen-off handling** — locking the screen (or switching tabs) pauses the clock; coming back logs the segment up to that point, records the gap as a "Screen off" break, and starts a fresh timer for the same task. Uses the Idle Detection API where available (Chrome/Edge), falling back to the Page Visibility API elsewhere.
- **Office hours cutoff** — any timer still running at 8:00 pm is automatically logged and stopped, clipped to the cutoff.
- **Dashboard stats** — today / this month / this year / all-time totals, entry counts, and project count.
- **Filtering** — filter logged entries by year and month.
- **Export** — export the log to an `.xlsx` file (via ExcelJS), with per-project row coloring, merged date groups, and signed links to any attached screenshots. Also supports "Open in Google Sheets" (downloads the file and opens a blank sheet to import it into).
- **Auth** — email/password sign up, sign in, and password reset via Supabase Auth. Each user's entries and screenshots are private (enforced by row-level security).
- **Local → cloud migration** — if entries exist in this browser's `localStorage` from an earlier local-only version of the app, they're detected on sign-in and can be imported into the signed-in account.

## Project structure

```
index.html                   Markup for the auth screens and the main app
assets/
  style.css                  Styling
  script.js                  Core app logic: timer, entries, stats, export, screen-off handling
  auth.js                    Sign in / sign up / password reset / session UI
  supabase-client.js         Supabase project URL + anon key, client init
  migrate-local.js           One-time import of legacy localStorage entries into Supabase
  particles.js                Background particle effect
supabase/
  schema.sql                 Supabase schema: entries table, RLS policies, screenshots storage bucket
```

## Setup

1. Create a [Supabase](https://supabase.com) project.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql). It creates the `entries` table, row-level security policies, and a private `screenshots` storage bucket. Safe to re-run.
3. In [`assets/supabase-client.js`](assets/supabase-client.js), set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your project's values (Project Settings → API).
4. Open [`index.html`](index.html) directly in a browser, or serve the directory with any static file server. There's no build step.

## Notes

- All persistence is in Supabase (Postgres + Storage); the only thing kept in `localStorage` is the in-progress timer state (so a page refresh doesn't lose a running timer) and, once, any legacy entries from a pre-Supabase version of the app.
- Screenshots are stored in a private bucket under `${userId}/${screenshotId}`; access is restricted per-user by storage RLS policies.
