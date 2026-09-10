# S56 TEST LOG — x402-url-extractor

## Commands
```bash
npm ci --ignore-scripts
NETWORK=eip155:8453 node --test \
  commerce-events.test.mjs \
  commerce-rare-funnel.mounted.test.mjs \
  commerce-nonlive-suite.test.mjs \
  commerce-privacy-coverage.test.mjs \
  merchant-rc.test.mjs
```

## Result
102 pass / 0 fail (see `/home/ubuntu/work/s56/logs/x402-test.log` on composer VM).

## Inherited vs re-run
- Re-run: focused rare-funnel/mounted + nonlive/privacy + merchant-rc on composition tip.
- Inherited (S33 final-review): 91 commerce / 117 nonlive — not re-executed this wave.
