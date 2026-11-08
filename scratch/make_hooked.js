const fs = require('fs');
let code = fs.readFileSync('tools/console-extract-blocks.js', 'utf8');
const hook = 'state.catalog = catalog;\n      window.__AIFX_BLOCK_CATALOG__ = catalog;\n      fetch("http://127.0.0.1:45678", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog) }).catch(console.error);';
code = code.replace('state.catalog = catalog;\n      window.__AIFX_BLOCK_CATALOG__ = catalog;', hook);
fs.writeFileSync('scratch/console-extract-blocks-hooked.js', code);
console.log('Hooked script saved.');

