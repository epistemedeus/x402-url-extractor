// Test-only mapping from reserved example names to an owned loopback fixture.
// This is not a captured hosted action or a production network configuration.
const origin = new URL(process.env.READER_FIXTURE_ORIGIN);
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw Error('fixture must be loopback');
const fetchFixture = globalThis.fetch;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = async (url, options) => {
  const u = new URL(url);
  if (u.origin !== 'https://fixture.example') throw Error('unknown source fixture');
  const response = await fetchFixture(origin.origin + u.pathname, options);
  // Preserve the virtual source provenance, not the fixture server's transport URL.
  return { status: response.status, headers: response.headers, body: response.body };
};
