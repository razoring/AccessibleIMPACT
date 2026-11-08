import fs from 'fs';

const files = [
  'catalog/variables_set_projectile_createfromside.svg',
  'catalog/variables_set_projectile_createfromsprite.svg'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Add defs pattern if not present
  if (!content.includes('id="aifx-checker-0"')) {
    const pattern = '<defs><pattern id="aifx-checker-0" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#dedede"/><rect x="0" y="0" width="8" height="8" fill="#aeaeae"/><rect x="8" y="8" width="8" height="8" fill="#aeaeae"/></pattern></defs>';
    if (content.includes('<defs>')) {
      content = content.replace('<defs>', '<defs><pattern id="aifx-checker-0" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#dedede"/><rect x="0" y="0" width="8" height="8" fill="#aeaeae"/><rect x="8" y="8" width="8" height="8" fill="#aeaeae"/></pattern>');
    } else {
      content = content.replace(/(<svg[^>]*>)/, '$1' + pattern);
    }
  }

  // Update rect stroke & fill to #7c8592 and url(#aifx-checker-0)
  content = content.replace(
    /<rect x="5" y="1" width="40px" height="40px" class="blocklyFieldRect blocklySpriteField"[^>]*>/g,
    '<rect x="5" y="1" width="40px" height="40px" class="blocklyFieldRect blocklySpriteField" stroke="#7c8592" stroke-width="1.5" rx="4" ry="4" fill="url(#aifx-checker-0)" style="fill:url(#aifx-checker-0) !important;stroke:#7c8592 !important;stroke-width:1.5px !important;rx:4px !important;ry:4px !important;opacity:1 !important;"/>'
  );

  // Remove the superimposed 16x16 / 32x32 blank checkerboard image inside blocklySpriteField
  content = content.replace(
    /<image[^>]*xlink:href="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8\/9hAAAAVklEQVR4AdyRwQkAIAzEihN18s7SCbqKkl\/\+fkQhEAgIp6uqtpmZbdxwN3zF5XnggsyMFN0dLdxwN\/yBCZefEIsdhp3GDXfDf3gDdhh2GjfcDf\/gDQ4AAAD\/\/xRE6jsAAAAGSURBVAMA0Hd9MQrHq6MAAAAASUVORK5CYII="[^>]*><\/image>/g,
    ''
  );

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Successfully patched projectile SVGs');

