# P4 — Deployment / IMPACT Integration

## Targets
- `https://impact.codeninjas.com/*` (content script: overlay.js)
- `https://arcade.makecode.com/*` (all_frames: renderer.js — embedded Blockly)

## Corpus Coverage
- 261 instruction payload files in `instructions/` (9 belts)
- `instructions.txt` (IMPACT panel dump) + `blocks.txt` (vocabulary only; `bubbles.txt` untouched)
- `tree.txt` (221 blocks + taxonomy) drives `catalog/catalog.json` (taxonom-y_normalization, no manual mapping)

## Pipeline (live-render, no saved images)
1. overlay TreeWalker scans instruction-area text nodes (`isInstructionArea`).
2. Bracket tokens (`[word …]`) matched; bubbles/prose skipped.
3. `chrome.runtime.sendMessage({action:'renderToken'})` to renderer.
4. renderer selects category via `window.__renderIndex` / taxonomy, clicks flyout, clones `getSvgRoot()`, inlines computed styles (`fill`/`stroke`/font), serializes standalone SVG via `XMLSerializer`.
5. SVG returned; overlay swaps placeholder span (`.aifx-rendered`).
6. Unmatched tokens: preserved as original bracket text (`data-token` kept, never wrong block).

## Design Rules Verification
- Only `blocks.txt` tokens replaced; `bubbles.txt` prose untouched.
- No session `data-id` relied on at runtime (`catalog` has `dataIdRef=null`; renderer uses `type` + flyout clone).
- Toolbox-default inline SVG; no PNG/raster artifacts (`poc_*.svg` removed; only live render).
- Unmatched → original text (never invented block).

## Remaining (P5 QA)
- End-to-end test across all 261 payloads (resolution rate ≥95%).
- Storage LRU / cache for rendered SVGs in renderer.
- Version pinning (`0.1.0` in manifest); verify `arcade.makecode.com` API stability for flyout access.
