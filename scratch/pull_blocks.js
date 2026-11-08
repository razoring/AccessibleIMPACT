async (page) => {
  return await page.evaluate((start, count) => {
    return window.__AIFX_CHUNK__(0, 20);
  });
}
