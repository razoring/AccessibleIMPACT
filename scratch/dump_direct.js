async (page) => {
  const fs = require('fs');
  const path = require('path');
  const catalog = await page.evaluate(() => window.__AIFX_BLOCK_CATALOG__);
  const root = 'c:\\Users\\conta\\OneDrive\\Documents\\Personal\\Projects\\Coding\\AccessibleIMPACT';
  const catalogDir = path.join(root, 'catalog');
  const catalogJson = path.join(catalogDir, 'catalog.json');
  
  if (!fs.existsSync(catalogDir)) {
    fs.mkdirSync(catalogDir, { recursive: true });
  }

  // Save the full aifx-block-catalog.json
  const aifxCatalogPath = path.join(root, 'aifx-block-catalog.json');
  fs.writeFileSync(aifxCatalogPath, JSON.stringify(catalog, null, 2), 'utf8');

  // Also dump every SVG directly into catalog/ and update catalog.json
  const blocks = catalog.blocks || {};
  let existing = {};
  if (fs.existsSync(catalogJson)) {
    try { existing = JSON.parse(fs.readFileSync(catalogJson, 'utf8')); } catch (e) {}
  }
  const merged = { ...existing };
  let written = 0;

  for (const b of Object.values(blocks)) {
    const key = b.key;
    if (!key || !b.svg) continue;
    const file = key + '.svg';
    fs.writeFileSync(path.join(catalogDir, file), b.svg, 'utf8');
    written++;

    merged[key] = {
      type: b.type,
      file,
      width: b.width,
      height: b.height,
      category: b.category,
      isMultiLine: !!b.isMultiLine,
      fields: (b.fields || []).map(f => ({ name: f.name, kind: f.kind, text: f.text })),
      inputs: b.inputs || []
    };
  }

  fs.writeFileSync(catalogJson, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  return {
    totalBlocks: Object.keys(blocks).length,
    writtenSVGs: written,
    catalogDir,
    aifxCatalogPath
  };
}

