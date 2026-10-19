# Reminder sender (Cloudflare Worker)

GitHub's scheduler runs scheduled workflows only a few times a day on small repos, which is too slow for reminders. A free Cloudflare Worker with a cron trigger runs every minute instead.

`worker.js` is generated from `../sender/due.mjs`, `webpush-web.js` and `main.js` (`node build.mjs`). Test with `node test.mjs`.

## Set up (about 10 minutes, no command line)

1. Sign up (free) at https://dash.cloudflare.com
2. **Workers & Pages → Create → Create Worker**, name it `daybook-reminders`, click **Deploy**.
3. Click **Edit code**, select everything, delete it, paste the contents of `worker.js`, click **Deploy**.
4. **Settings → Variables and Secrets → Add**, type **Secret**, twice:
   - `DATA_TOKEN`: the same GitHub access token the app uses
   - `VAPID_PRIVATE_KEY`: the private key from Daybook's Settings → Reminders
5. **Settings → Trigger Events → Add Cron Trigger**: `* * * * *`
6. Open the worker's `workers.dev` URL once. It answers `ok, sent 0` when everything is connected.
7. Optional: in the `daybook` repo's **Actions → reminders**, choose **… → Disable workflow** so only one sender runs.

## Free-plan CPU limit

A Worker run that uses more than ~10 ms of CPU is killed (`exceededCpu` in Observability) and sends nothing. On 2026-10-17 this silently dropped a 4 PM habit reminder: every run failed for hours, longer than the catch-up window. To stay under the limit the Worker fetches `data.json` as raw text with an ETag and keeps the parsed copy in memory, so an unchanged file (GitHub answers 304) costs no parsing. `loaded data.json` in the logs should therefore appear only when the data changes. The catch-up window is 3 hours; reminders older than that are dropped.
