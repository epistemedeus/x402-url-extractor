// Test preload for the unchanged documented --stdout CLI. No network fallback.
import assert from 'node:assert/strict';
// Do not import the target CLI here: its entry point would run before this
// preload installs the mock. Literal fixture routes are pinned to GRAPH.json.
const BOARDS = {
  acxiom: { endpoint: 'https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs' },
  liverampAshby: { endpoint: 'https://api.ashbyhq.com/posting-api/job-board/liveramp-inc' },
  liverampWorkday: { endpoint: 'https://liveramp.wd5.myworkdayjobs.com/wday/cxs/liveramp/LiveRampCareers/jobs' },
};
let requests = 0;
globalThis.fetch = async (url, options) => {
  assert.ok(++requests <= 6, 'recipe request budget');
  assert.equal(options.redirect, 'manual');
  assert.ok(options.signal instanceof AbortSignal);
  if (url === BOARDS.acxiom.endpoint) {
    const { offset, limit } = JSON.parse(options.body);
    assert.equal(limit, 20); assert.ok(offset <= 60);
    return new Response(JSON.stringify({ total: offset ? 0 : 100,
      jobPostings: Array.from({ length: 20 }, (_, n) => ({ title: `Data Synthetic ${offset + n}`,
        locationsText: 'Remote US', externalPath: `/job/Synthetic/Row_${offset + n}` })) }), { status: 200 });
  }
  if (url === BOARDS.liverampAshby.endpoint) return new Response(JSON.stringify({ jobs: [{ title: 'Data Synthetic Listed', location: 'Remote US', isListed: true, jobUrl: 'https://jobs.ashbyhq.com/liveramp-inc/synthetic-cli' }] }), { status: 200 });
  if (url === BOARDS.liverampWorkday.endpoint) return new Response(JSON.stringify({ errorCode: 'SYNTHETIC-DENIED' }), { status: 403 });
  throw new Error('offline_fixture_has_no_route');
};
process.on('beforeExit', () => assert.equal(requests, 6));
