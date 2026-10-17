# RC-1 Design — Linux visual-baseline provenance (2026-10-16)

Status: **historical full-page capture, superseded — replacement candidates required**. This record preserves evidence from the initial capture but does **not** certify the current Design-only screenshot boundary. The independent comparison run #38935997122 exposed 940 unrelated changing pixels in the shared chat composer. The Design-only gate must be recaptured on Ubuntu, reviewed and passed in separate CI before #552 closure.

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

## Candidate replacement: Design-only capture from a failed, independent Ubuntu comparison

The original full-page images above remain historical evidence. Their
dimensions are the **viewport**, not the element
`[data-workbench-surface="design"]` that the current regression test
captures. The Linux PR test run
[38938887853](https://github.com/Rwanbt/unifia/actions/runs/38938887853)
on `a5cdfcb75263392dbbbcf074bb7ffb84b072a3db` failed eight comparisons:
for example, the original dark 1440 reference is 1440×900 but the real
Design element was 966×808. **This mismatch is a screenshot-boundary
error, not a reason to ignore pixels or loosen the gate.**

The same failed run uploaded `playwright-linux-shard-1-1` artifact
`12063162320`, including actual Design-element PNGs from Ubuntu
Chromium. We extracted the **original actual PNG bytes** (no scaling,
cropping, post-processing or image generation), manually inspected dark
1440 and light 375 and checked all eight for the real orange Canvas
rectangle (at least 2,837 sampled orange pixels per image). Critically,
for each theme/viewport the primary capture and both test retries had
**identical SHA-256** hashes, not merely visually similar pixels.

| Design element / viewport | Actual PNG dimensions | SHA-256 of proposed Linux baseline |
| --- | --- | --- |
| dark / 375×812 | 351×680 | `8372aeec757d0254399e506c7cc0526cceb27dd199cfbe410327fc4e369a5657` |
| dark / 768×1024 | 656×932 | `c5d529e0f549d91983eb5e8641aa2106caaab1f3fec144498851c71293fb3d11` |
| dark / 1280×800 | 824×708 | `ce0e2333799ac74d59a3a44d7fee25954c1486a90243aea53d4bdfa1faf616ab` |
| dark / 1440×900 | 966×808 | `e98bfc03972c6944d80f89b7540d596073deb22cde8aa43b805e9b5f2f9d1ddc` |
| light / 375×812 | 351×680 | `0463b436f7ff1655cb86f1e90f82c9e9f3b9b372a9e8d5ad0af4c44e9839b97a` |
| light / 768×1024 | 656×932 | `2a69f5b5e9d91b27f04e467166f51e4edd7c15da2f17fa170cb34983dc130c18` |
| light / 1280×800 | 824×708 | `c1fa4f7483e5a2f45d9afd21daecd57592759e493e6397bdb6fc3a140f1652ef` |
| light / 1440×900 | 966×808 | `0f5a79784911bcdb94b96365193e80f66ea4674d5889cd1f49ad9b246fe25b56` |

**Status: candidate, not approved by the capture run.** The eight
committed replacements must be compared against a new `pull_request`
CI run at the new exact head SHA, **twice on independent runs** before
marking #552 complete. Keep the `maxDiffPixels: 0` / `threshold: 0`
regression and #751 color-mutation negative oracle unchanged. A pass
on these PNGs alone cannot certify the entire Design/Android UI.
