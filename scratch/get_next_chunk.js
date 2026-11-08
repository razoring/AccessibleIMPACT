async (page) => {
  return await page.evaluate(() => {
    return window.__AIFX_CHUNK_INDEX__ ? window.__AIFX_CHUNK_INDEX__ : 0;
  });
}

