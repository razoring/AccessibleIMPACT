async (page) => {
  return await page.evaluate(async () => {
    const catalog = window.__AIFX_BLOCK_CATALOG__;
    const blob = new Blob([JSON.stringify(catalog)], { type: 'application/json' });
    const reader = new FileReader();
    const dataUrlPromise = new Promise(resolve => {
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const dataUrl = await dataUrlPromise;
    // Download into browser downloads folder
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'aifx-block-catalog.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    return { success: true, count: catalog.count };
  });
}

