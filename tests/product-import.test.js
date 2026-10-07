const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/fitshop-2026-09-24.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'product-import.js'), 'utf8');

function importer() {
  const window = { location: { href: 'https://example.test/index.html' } };
  const document = {
    currentScript: { src: 'https://example.test/product-import.js' },
    createElement: () => ({ textContent: '' }),
    head: { appendChild() {} }
  };
  const context = {
    window, document, URL, Blob, console, setTimeout, clearTimeout,
    renderAdmin() {}, products: [], activityLog: [],
    localStorage: { setItem() {} },
    toast() {}, save() {}
  };
  vm.runInNewContext(script, context, { filename: 'product-import.js' });
  return window.BioTechPdfImport;
}

test('PDF dataset has 584 unique EANs and no financial fields', () => {
  assert.equal(dataset.productCount, 584);
  assert.equal(dataset.products.length, 584);
  assert.match(dataset.categoryNote, /requieren revisión administrativa/i);
  const eans = dataset.products.map(row => row.ean);
  assert.equal(new Set(eans).size, eans.length);
  assert.ok(eans.every(ean => /^\d{8,14}$/.test(ean)));
  assert.ok(dataset.products.every(row => row.presentation));
  const forbidden = /^(price|cost|stock|margin|profit|public|combo|intermed\.?|key\s?partner|supplierprice)$/i;
  for (const row of dataset.products) assert.ok(Object.keys(row).every(key => !forbidden.test(key)));
});

test('import preserves existing commercial data and manual image, fills only blank descriptive fields', () => {
  const api = importer();
  const item = dataset.products[0];
  const existing = {
    id: 'existing-1', ean: item.ean, barcode: item.ean,
    name: 'Nombre comercial existente', brand: '', category: 'Rendimiento', subcategory: 'Pre-entreno',
    price: 42.5, cost: 19.25, stock: 7, incoming: 3,
    supplierId: 'supplier-9', image: 'https://storage.example.test/manual.jpg',
    imageOrigin: 'manual', imageVerified: true, imagePaths: ['products/manual.jpg'],
    orders: [{ id: 'order-1' }]
  };
  const result = api.apply([item], [existing], '2026-10-07T12:00:00Z');
  const saved = result.products[0];
  assert.equal(result.totals.updated, 1);
  assert.equal(saved.price, 42.5);
  assert.equal(saved.cost, 19.25);
  assert.equal(saved.stock, 7);
  assert.equal(saved.incoming, 3);
  assert.equal(saved.supplierId, 'supplier-9');
  assert.equal(saved.category, 'Rendimiento');
  assert.equal(saved.subcategory, 'Pre-entreno');
  assert.deepEqual(saved.orders, [{ id: 'order-1' }]);
  assert.equal(saved.image, existing.image);
  assert.equal(saved.imageOrigin, 'manual');
  assert.equal(saved.imageVerified, true);
  assert.deepEqual(saved.imagePaths, ['products/manual.jpg']);
  assert.equal(saved.name, 'Nombre comercial existente');
  assert.equal(saved.brand, item.brand);
});

test('new catalog item is an unpublished draft with no invented commercial data', () => {
  const api = importer();
  const item = dataset.products[0];
  const result = api.apply([item], [], '2026-10-07T12:00:00Z');
  assert.equal(result.totals.new, 1);
  assert.equal(result.products[0].barcode, item.ean);
  assert.equal(result.products[0].price, null);
  assert.equal(result.products[0].cost, null);
  assert.equal(result.products[0].stock, 0);
  assert.equal(result.products[0].published, false);
  assert.equal(result.products[0].status, 'draft');
  assert.equal(result.products[0].image, '');
  assert.equal(result.products[0].category, '');
  assert.equal(result.products[0].categorySuggestion, item.category);
  assert.ok(result.totals.categoriesPending > 0);
  assert.equal(result.products[0].imageAudit.status, 'pending');
});

test('duplicate EANs already present in the store are skipped rather than overwritten', () => {
  const api = importer();
  const item = dataset.products[0];
  const first = { id: 'a', barcode: item.ean, price: 10 };
  const second = { id: 'b', ean: item.ean, price: 20 };
  const result = api.apply([item], [first, second], '2026-10-07T12:00:00Z');
  assert.equal(result.totals.duplicatesAvoided, 1);
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].price, 10);
  assert.equal(result.products[1].price, 20);
});
