# RC-1 Design — Linux visual-baseline provenance (2026-10-16)

Status: **captured and reviewed; independent comparison required**. This record is evidence for #552/#729, not owner approval or RC-1 certification.

- Candidate run: [GitHub Actions #38932878348](https://github.com/Rwanbt/unifia/actions/runs/38932878348), manual `workflow_dispatch` on Ubuntu, Playwright Chromium, shard 1/3, artifact `playwright-linux-shard-1-1`.
- Source commit: `a6226e0bc18bed60da3f8775763621549bda3744`; Node `v22.23.3`; platform `linux`. Each candidate's metadata records its theme, viewport, source SHA and canonical file `.unifia/design/canvas.design.json`.
- Eight passing capture-only test cases produced the images; each compared two consecutive pixels-identical candidate captures. **This run did not compare committed Linux baselines.**
- All eight PNGs were visually inspected and independently verified for exact viewport dimensions and more than 2,000 orange Canvas pixels each. The visible rectangle and text are real SDK-loaded Design Canvas content, not empty studio chrome. No masks, skipped pixels or comparison tolerance are introduced.

| Theme | Width × height | SHA-256 (PNG) |
| --- | --- | --- |
| dark | 375 × 812 | `7bfd0751b5c93d9757a284dca3697f4103cc572dcec7dd41edd52bf0701dd8a3` |
| dark | 768 × 1024 | `197d458fb56eb4c8a6e629ceaf20c20852caeadb9ff6be01b5d434e0d3662ad` |
| dark | 1280 × 800 | `2827dc160b08fd7d5906aee8113b1e66a907f5e36a6ef0c20e57dad86ff664b2` |
| dark | 1440 × 900 | `6ca0f27b61e2676806e1b7c11a73ab1d47787760f834d340e120423061f95f85` |
| light | 375 × 812 | `b5aa0bdc710b7a94904210077c4278e1678ed3fa943b266e2757558f8b3e3bdd` |
| light | 768 × 1024 | `edfd134a1a37284b206c30a54e9ab74c716c99d9b1c32f0fe3133163cf9de508` |
| light | 1280 × 800 | `01bb0e6a25062d011947be88a583cff70a646f0c3e2c50c032605114da03eb4e` |
| light | 1440 × 900 | `c437b8dd56324b2a57defd73faa8889fa34f7287f4db0ac68ace77f606987181` |

The **separate subsequent PR-triggered CI** must run with `GITHUB_EVENT_NAME=pull_request`, use the committed `__screenshots__/linux` PNGs, compare them at zero pixel tolerance and pass twice before #552 can be considered fully qualified. The existing #751 negative oracle must remain green.
