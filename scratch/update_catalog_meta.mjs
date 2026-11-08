import fs from 'fs';

const cat = JSON.parse(fs.readFileSync('catalog/catalog.json', 'utf8'));

cat.controls_else = {
  type: 'controls_else',
  file: 'controls_else.svg',
  width: 237,
  height: 92,
  category: 'Logic',
  isMultiLine: true,
  fields: [
    { name: '', kind: 'dh', text: 'else' },
    { name: '', kind: 'r', text: 'remove else branch' }
  ],
  inputs: [ '', '' ]
};

cat.controls_else_if = {
  type: 'controls_else_if',
  file: 'controls_else_if.svg',
  width: 257,
  height: 92,
  category: 'Logic',
  isMultiLine: true,
  fields: [
    { name: '', kind: 'dh', text: 'else if' },
    { name: '', kind: 'dh', text: 'then' },
    { name: '', kind: 'r', text: 'remove else if branch' }
  ],
  inputs: [ 'logic_boolean', '', '' ]
};

cat.controls_else_if_true = {
  type: 'controls_else_if_true',
  file: 'controls_else_if_true.svg',
  width: 257,
  height: 92,
  category: 'Logic',
  isMultiLine: true,
  fields: [
    { name: '', kind: 'dh', text: 'else if' },
    { name: '', kind: 'dh', text: 'then' },
    { name: '', kind: 'r', text: 'remove else if branch' }
  ],
  inputs: [ 'logic_boolean', '', '' ]
};

fs.writeFileSync('catalog/catalog.json', JSON.stringify(cat, null, 2), 'utf8');

const tm = JSON.parse(fs.readFileSync('catalog/token_map.json', 'utf8'));
tm['else'] = 'controls_else';
tm['else if'] = 'controls_else_if';
tm['else if false'] = 'controls_else_if';
tm['else if true'] = 'controls_else_if_true';
tm['else if true then'] = 'controls_else_if_true';
tm['else if false then'] = 'controls_else_if';
tm['else if then'] = 'controls_else_if';

fs.writeFileSync('catalog/token_map.json', JSON.stringify(tm, null, 2), 'utf8');

console.log('Updated catalog.json and token_map.json with else blocks.');

