async (page) => {
  const result = await page.evaluate(async () => {
    window.__AIFX_CHUNK__ = function(start, count) {
      const keys = Object.keys(window.__AIFX_BLOCK_CATALOG__.blocks);
      const slice = keys.slice(start, start + count);
      const out = {};
      for (const k of slice) out[k] = window.__AIFX_BLOCK_CATALOG__.blocks[k];
      return { total: keys.length, slice: out };
    };
    return window.__AIFX_CHUNK__(0, 10);
  });
  return { total: result.total, sampleKeys: Object.keys(result.slice) };
}

