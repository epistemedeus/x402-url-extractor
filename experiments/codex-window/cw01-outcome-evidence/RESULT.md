# CW01 result

- Execution surface: native ChatGPT Work Linux VM; Node.js test runner; no nested model CLI.
- Exact input: `epistemedeus/x402-url-extractor` master `0153295c5851bf8f93fb27c77070a31417a59f69`.
- Owned paths only: `experiments/codex-window/cw01-outcome-evidence/`.
- Focused adapter tests: 10 passed, 0 failed.
- Owning `examples/customer-x402` regression suite: 204 tests, 197 passed, 7 skipped, 0 failed. Skips are the pre-existing opt-in production preflight and mounted merchant-runtime cases whose dependencies are not installed.
- External effects: public repository read and dependency download only during validation; no production request, payment, deploy, default-branch mutation, or private production-data read.
- Sample inputs and portable output are synthetic and explicitly labeled. They are not customer, demand, revenue, organic-use, or return-on-investment evidence.
