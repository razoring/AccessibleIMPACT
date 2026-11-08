async (page) => {
  return await page.evaluate(() => {
    const catalog = window.__AIFX_BLOCK_CATALOG__;
    const blocks = catalog.blocks;
    const keys = Object.keys(blocks);
    const out = [];
    for (const k of keys) {
      const b = blocks[k];
      out.push({
        key: b.key,
        type: b.type,
        category: b.category,
        width: b.width,
        height: b.height,
        isMultiLine: b.isMultiLine,
        fields: b.fields,
        inputs: b.inputs,
        svg: b.svg
      });
    }
    return {
      count: keys.length,
      firstChunk: out.slice(0, 50)
    };
  });
}

