import fs from 'fs';
const s = fs.readFileSync('catalog/controls_if_else.svg', 'utf8');
const rest = s.slice(s.indexOf('</style>') + 8);
console.log(rest);

