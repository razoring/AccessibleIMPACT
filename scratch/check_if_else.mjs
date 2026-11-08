import fs from 'fs';
const s = fs.readFileSync('catalog/controls_if_else.svg', 'utf8');
console.log('viewBox:', s.match(/viewBox="[^"]+"/)[0]);
const paths = [...s.matchAll(/d="([^"]+)"/g)].map(m => m[1]);
console.log('Paths count:', paths.length);
console.log('Main path d:\n', paths[0]);

