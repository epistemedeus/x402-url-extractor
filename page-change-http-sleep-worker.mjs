// Test-only worker. Sleeps until killed so abort/timeout tests can prove
// owned child reaping. Not used in production.
const ms = Number(process.env.PAGE_CHANGE_HTTP_SLEEP_MS || 30_000);
await new Promise((resolve) => setTimeout(resolve, ms));
process.stdout.write(JSON.stringify({ ok: false, error: "sleep worker should have been killed", code: "sleep_elapsed" }));
