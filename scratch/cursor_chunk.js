async (page) => {
  return await page.evaluate(() => {
    if (typeof window.__AIFX_CHUNK_CURSOR__ === 'undefined') {
      window.__AIFX_CHUNK_CURSOR__ = 0;
    }
    const keys = Object.keys(window.__AIFX_BLOCK_CATALOG__.blocks);
    const start = window.__AIFX_CHUNK_CURSOR__;
    const end = Math.min(start + 50, keys.length);
    window.__AIFX_CHUNK_CURSOR__ = end;

    const slice = keys.slice(start, end);
    const out = [];
    for (const k of slice) {
      const b = window.__AIFX_BLOCK_CATALOG__.blocks[k];
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
      total: keys.length,
      start,
      end,
      done: end >= keys.length,
      items: out
    };
  });
}

