import fs from 'fs';

const cIf = fs.readFileSync('catalog/controls_if.svg', 'utf8');
const cIfElse = fs.readFileSync('catalog/controls_if_else.svg', 'utf8');

// Extract SVG header up to </style>
const styleHeader = cIf.slice(0, cIf.indexOf('</style>') + 8);

// Extract minus icon (remove.svg) and plus icon (add.svg) and dropdown arrow from cIfElse
const matches = cIfElse.match(/data:image\/svg\+xml;base64,[^"]+/g);
const arrowData = matches[0];
const minusData = matches[1];
const plusData = matches[2];

// 1. controls_else.svg
// Same dimensions as controls_if: 199 x 116, arm length 190.375
const elsePathD = ` m 0,0  m 0,4 a 4 4 0 0,1 4,-4  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 142.375 a 4 4 0 0,1 4,4  v 8  V 40  V 44 a 4 4 0 0,1 -4,4  H 64  c -2,0  -3,1  -4,2  l -4,4  c -1,1  -2,2  -4,2  h -12  c -2,0  -3,-1  -4,-2  l -4,-4  c -1,-1  -2,-2  -4,-2  h -8 a 4 4 0 0,0 -4,4  v 16 a 4 4 0 0,0 4,4  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  H 190.375 a 4 4 0 0,1 4,4  V 76  V 100  V 100 a 4 4 0 0,1 -4,4  h -142.375  c -2,0  -3,1  -4,2  l -4,4  c -1,1  -2,2  -4,2  h -12  c -2,0  -3,-1  -4,-2  l -4,-4  c -1,-1  -2,-2  -4,-2  h -8 a 4 4 0 0,1 -4,-4 z`;

const svgElse = `<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 199 116" width="199" height="116">${styleHeader.replace(/<svg[^>]*>/, '')}
<g role="none" class="controls_else blocklyBlock blocklyDraggable" data-aifx-type="controls_else" transform="translate(0,0)">
<path class="blocklyPath" stroke="#3480b6" fill="#45aaf2" aria-label="else" aria-roledescription="statement" role="option" d="${elsePathD}" style="fill:rgb(69, 170, 242);stroke:rgb(52, 128, 182);stroke-width:1px;font-family:&quot;Segoe UI&quot;, &quot;Segoe UI Web (West European)&quot;, -apple-system, BlinkMacSystemFont, Roboto, &quot;Helvetica Neue&quot;, sans-serif;font-size:16px;font-weight:400;letter-spacing:normal;text-anchor:start;dominant-baseline:auto;writing-mode:horizontal-tb;paint-order:normal;"/>
<g role="none" class="blocklyLabelField" aria-hidden="true" transform="translate(8,14.5)" data-aifx-field="" data-aifx-opaque="1">
<text class="blocklyText blocklyFieldText" aria-hidden="true" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, &quot;Ubuntu Mono&quot;, source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;">else</text>
</g>
<g role="none" class="blocklyImageField" aria-hidden="true" transform="translate(162.375,11.5)" data-aifx-field="" data-aifx-opaque="1">
<image height="24px" width="24px" alt="remove else branch" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${minusData}" href="${minusData}" style="fill:rgb(0, 0, 0);stroke:none;stroke-width:1px;cursor:pointer;"/>
</g>
<g role="none" class="blocklyImageField" aria-hidden="true" transform="translate(8,76)" data-aifx-field="" data-aifx-opaque="1">
<image height="24px" width="24px" alt="add else branch" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${plusData}" href="${plusData}" style="fill:rgb(0, 0, 0);stroke:none;stroke-width:1px;cursor:pointer;"/>
</g>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(12, 0)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(28, 48)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(12, 104)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<g role="none" class="blocklyConnectionIndicatorParent"/>
</g>
</svg>`;

fs.writeFileSync('catalog/controls_else.svg', svgElse, 'utf8');

// 2. controls_else_if.svg and controls_else_if_true.svg
function makeElseIfSvg(boolValue) {
  const isTrue = boolValue === 'true';
  const boolVal = isTrue ? 'true' : 'false';
  const boolWidth = isTrue ? 63.1875 : 73.1875;
  const arrowX = isTrue ? 43.1875 : 53.1875;
  const socketTotalWidth = 16 + boolWidth + 16;
  const socketStartX = 80;
  const socketEndX = socketStartX + socketTotalWidth;
  const thenX = socketEndX + 8;
  const minusX = isTrue ? 230 : 240;
  const armH = isTrue ? 210 : 220;
  const totalArmWidth = 48 + armH;
  const vbWidth = totalArmWidth + 9;

  const d = ` m 0,0  m 0,4 a 4 4 0 0,1 4,-4  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h ${armH} a 4 4 0 0,1 4,4  v 8  V 40  V 44 a 4 4 0 0,1 -4,4  H 64  c -2,0  -3,1  -4,2  l -4,4  c -1,1  -2,2  -4,2  h -12  c -2,0  -3,-1  -4,-2  l -4,-4  c -1,-1  -2,-2  -4,-2  h -8 a 4 4 0 0,0 -4,4  v 16 a 4 4 0 0,0 4,4  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  H ${totalArmWidth} a 4 4 0 0,1 4,4  V 76  V 100  V 100 a 4 4 0 0,1 -4,4  h -${armH}  c -2,0  -3,1  -4,2  l -4,4  c -1,1  -2,2  -4,2  h -12  c -2,0  -3,-1  -4,-2  l -4,-4  c -1,-1  -2,-2  -4,-2  h -8 a 4 4 0 0,1 -4,-4 z`;

  return `<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbWidth} 116" width="${vbWidth}" height="116">${styleHeader.replace(/<svg[^>]*>/, '')}
<g role="none" class="controls_else_if blocklyBlock blocklyDraggable" data-aifx-type="controls_else_if" transform="translate(0,0)">
<path class="blocklyPath" stroke="#3480b6" fill="#45aaf2" aria-label="else if ${boolVal} then" aria-roledescription="statement" role="option" d="${d}" style="fill:rgb(69, 170, 242);stroke:rgb(52, 128, 182);stroke-width:1px;font-family:&quot;Segoe UI&quot;, &quot;Segoe UI Web (West European)&quot;, -apple-system, BlinkMacSystemFont, Roboto, &quot;Helvetica Neue&quot;, sans-serif;font-size:16px;font-weight:400;letter-spacing:normal;text-anchor:start;dominant-baseline:auto;writing-mode:horizontal-tb;paint-order:normal;"/>
<g role="none" class="logic_boolean blocklyBlock logic_blocks blocklyShadow blocklyDraggable" style="display: block;" transform="translate(${socketStartX}, 8)">
<path class="blocklyPath" stroke="#3480b6" fill="#3b91ce" d=" m 16,0  h ${boolWidth}  l 16,16  l -16,16  V 32  h -${boolWidth}  l -16,-16  l 16,-16 z&#10;" style="fill:rgb(59, 145, 206);stroke:rgb(52, 128, 182);stroke-width:1px;font-family:&quot;Segoe UI&quot;, &quot;Segoe UI Web (West European)&quot;, -apple-system, BlinkMacSystemFont, Roboto, &quot;Helvetica Neue&quot;, sans-serif;font-size:16px;font-weight:400;letter-spacing:normal;text-anchor:start;dominant-baseline:auto;writing-mode:horizontal-tb;paint-order:normal;"/>
<g role="none" class="blocklyField blocklyDropdownField blocklyEditableField" aria-roledescription="value" aria-label="dropdown: ${boolVal}" aria-haspopup="listbox" aria-expanded="false" aria-hidden="true" transform="translate(20,6.5)">
<text class="blocklyText blocklyFieldText blocklyDropdownText" aria-hidden="true" dominant-baseline="central" text-anchor="start" x="0" y="9.5" style="fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, &quot;Ubuntu Mono&quot;, source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;">${boolVal}</text>
<image height="12px" width="12px" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${arrowData}" href="${arrowData}" transform="translate(${arrowX},3.5)" style="fill:rgb(0, 0, 0);stroke:none;stroke-width:1px;"/>
</g>
</g>
<g role="none" class="blocklyLabelField" aria-hidden="true" transform="translate(8,14.5)" data-aifx-field="" data-aifx-opaque="1">
<text class="blocklyText blocklyFieldText" aria-hidden="true" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, &quot;Ubuntu Mono&quot;, source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;">else&#160;if</text>
</g>
<g role="none" class="blocklyLabelField" aria-hidden="true" transform="translate(${thenX},14.5)" data-aifx-field="" data-aifx-opaque="1">
<text class="blocklyText blocklyFieldText" aria-hidden="true" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, &quot;Ubuntu Mono&quot;, source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;">then</text>
</g>
<g role="none" class="blocklyImageField" aria-hidden="true" transform="translate(${minusX},11.5)" data-aifx-field="" data-aifx-opaque="1">
<image height="24px" width="24px" alt="remove else if branch" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${minusData}" href="${minusData}" style="fill:rgb(0, 0, 0);stroke:none;stroke-width:1px;cursor:pointer;"/>
</g>
<g role="none" class="blocklyImageField" aria-hidden="true" transform="translate(8,76)" data-aifx-field="" data-aifx-opaque="1">
<image height="24px" width="24px" alt="add else branch" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${plusData}" href="${plusData}" style="fill:rgb(0, 0, 0);stroke:none;stroke-width:1px;cursor:pointer;"/>
</g>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(12, 0)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<path class="blocklyHighlightedConnectionPath" d=" M 16,-16  h ${boolWidth}  l 16,16  l -16,16  h -${boolWidth}  l -16,-16  l 16,-16 z" transform="translate(${socketStartX}, 24)" role="figure" aria-roledescription="value position" style="fill:none;stroke:none;stroke-width:1px;"/>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(28, 48)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<path class="blocklyHighlightedConnectionPath" d=" m -8,0  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h 8 " transform="translate(12, 104)" role="figure" aria-roledescription="statement position" style="fill:none;stroke:none;stroke-width:1px;"/>
<g role="none" class="blocklyConnectionIndicatorParent"/>
</g>
</svg>`;
}

fs.writeFileSync('catalog/controls_else_if.svg', makeElseIfSvg('false'), 'utf8');
fs.writeFileSync('catalog/controls_else_if_true.svg', makeElseIfSvg('true'), 'utf8');

console.log('Successfully created controls_else.svg, controls_else_if.svg, controls_else_if_true.svg');
