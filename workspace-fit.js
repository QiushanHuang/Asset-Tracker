(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof define === 'function' && define.amd) define([], () => api);
  root.AssetTrackerWorkspaceFit = api;
})(globalThis, function () {
  'use strict';
  const spans = {full:12, wide:8, half:6, narrow:4};
  const minima = {cashflow:76, assets:44, trend:126, allocation:126, review:70,
    automation:70, projects:70, recent:92, assistant:72, memo:70};
  const owns = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
  const finite = (value,fallback=0) => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0,value)) : fallback;

  // Grid row/column positions are zero-based; each page uses the same height budget.
  function plan(modules, options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const width = finite(options.width), height = Math.floor(finite(options.height));
    const gap = finite(options.gap,6), narrow = width < 600, rows = [];
    for (const module of Array.isArray(modules) ? modules : []) {
      if (!module || typeof module.id !== 'string') continue;
      const span = narrow ? 12 : owns(spans,module.width) ? spans[module.width] : 12;
      const base = narrow && module.id === 'assistant' ? 90 : owns(minima,module.id) ? minima[module.id] : 70;
      const override = typeof module.minHeight === 'number' && Number.isFinite(module.minHeight) && module.minHeight > 0;
      const minimum = override ? Math.ceil(Math.min(500,module.minHeight)) : base;
      const weight = ['trend','allocation'].includes(module.id) ? 4 : ['recent','assistant'].includes(module.id) ? 2 : 1;
      let row = rows[rows.length-1];
      if (!row || row.columns+span > 12) {
        row = {items:[],columns:0,minimum:0,weight:1}; rows.push(row);
      }
      row.items.push({id:module.id,column:row.columns,span});
      row.columns += span; row.minimum = Math.max(row.minimum,minimum); row.weight = Math.max(row.weight,weight);
    }

    const groups = [];
    let group = [], used = 0;
    for (const row of rows) {
      if (group.length && used+gap+row.minimum > height) {
        groups.push(group); group = []; used = 0;
      }
      used += (group.length ? gap : 0)+row.minimum; group.push(row);
    }
    if (group.length) groups.push(group);

    const pages = groups.map(group => {
      const budget = Math.max(0,Math.floor(height-gap*(group.length-1)));
      // A window shorter than one readable row still receives that row, on its own page.
      const heights = group.map(row => Math.min(row.minimum,budget));
      let remaining = Math.max(0,budget-heights.reduce((sum,value) => sum+value,0));
      let remainingWeight = group.reduce((sum,row) => sum+row.weight,0);
      group.forEach((row,index) => {
        const extra = Math.floor(remaining*(row.weight/remainingWeight));
        heights[index] += extra; remaining -= extra; remainingWeight -= row.weight;
      });
      return {rows:heights,items:group.flatMap((row,index) => row.items.map(item => ({...item,row:index,height:heights[index]})))};
    });
    const minimumTotal = rows.reduce((sum,row) => sum+row.minimum,0)+Math.max(0,rows.length-1)*gap;
    return {pages,compact:narrow || pages.length > 1 || minimumTotal > height*0.8};
  }
  return Object.freeze({plan});
});
