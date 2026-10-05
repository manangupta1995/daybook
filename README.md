# Daybook

A personal task, calendar and habit app. Static web app (no build step), installable on iPhone as a Home Screen app, synced through a private GitHub repo.

This repo holds only the app code. Your data lives in a separate private repo (`daybook-data`) and is read and written through the GitHub API using a fine-grained access token that stays in your browser.

## Run locally

    python3 -m http.server 8000

Then open http://localhost:8000/

## Layout

- `js/store.js` data model, merge rules, habit streaks
- `js/sync.js` GitHub sync (pull, merge, push, conflict retry)
- `js/tasks.js`, `js/calendar.js`, `js/habits.js`, `js/settings.js` screens
- `sw.js` offline shell
