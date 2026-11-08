async (page) => {
  const keys = await page.evaluate(() => Object.keys(window.__AIFX_BLOCK_CATALOG__.blocks));
  return { total: keys.length, sample: keys.slice(0, 10) };
}