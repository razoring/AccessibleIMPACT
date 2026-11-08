async (page) => {
  return await page.evaluate(async () => {
    try {
      const res = await fetch('http://localhost:4567/status');
      return await res.json();
    } catch (e) {
      return { err: e.message };
    }
  });
}

