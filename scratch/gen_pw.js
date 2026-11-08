const fs = require('fs');
const hex = fs.readFileSync('scratch/extract_hex.txt', 'utf8');
const chunks = [];
const SIZE = 20000;
for (let i = 0; i < hex.length; i += SIZE) chunks.push(hex.slice(i, i + SIZE));

let pwScript = 'await page.evaluate(() => { window.__AIFX_HEX__ = ""; });\n';
for (const c of chunks) {
  pwScript += `await page.evaluate((c) => { window.__AIFX_HEX__ += c; }, '${c}');\n`;
}
pwScript += `const res = await page.evaluate(() => {
  const hex = window.__AIFX_HEX__;
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  const code = decodeURIComponent(escape(str));
  return eval(code);
});
`;

fs.writeFileSync('scratch/run_pw.js', pwScript);
console.log('Wrote scratch/run_pw.js, size:', pwScript.length);

