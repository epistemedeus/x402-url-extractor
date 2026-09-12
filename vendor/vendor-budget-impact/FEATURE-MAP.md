# Vendor budget impact (engine projection)

Deterministic compare of two caller-supplied pricing-row JSON objects.

## Accepted snapshot

```json
{
  "rows": [
    { "field": "desk-chat-input", "value": 1.0, "unit": "USD/1M-tokens" }
  ]
}
```

Optional snapshot `label` and `note` strings are admission metadata only.
They are not price fields. HTTP adapters must not accept paths, URLs,
commands, or writable-cache selectors.

## Outputs

- fieldChanges: same unit, numeric/value delta
- unitChanges: unit string changed; numerics are not compared
- added / removed rows
- conflicting / unknown (partial, still a completed scan)
- identical rows: informational, not failure

`purchaseAuthority` is always false.
