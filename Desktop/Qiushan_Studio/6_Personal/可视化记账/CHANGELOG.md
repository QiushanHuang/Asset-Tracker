# Changelog

## v0.2.0 - 2026-04-14

### Template and transaction workflow
- Allowed transaction templates without preset amounts so a template can prefill category, direction, purpose, and note while leaving the amount for the current entry.
- Added transaction list filtering by purpose category, fuzzy purpose search, and fuzzy note search.
- Added purpose suggestions in the transaction form for faster repeated entry.

### Category management
- Added collapsible child-category branches in the category panel so large trees can be folded by parent.
- Changed category trees to start in a folded state and added one-click expand-all / collapse-all controls.

### Dashboard and analytics
- Added dashboard date-range controls for the overview chart.
- Expanded the total asset change card with month, week, and day income/expense/net rows.
- Moved currency summary into the asset overview card.
- Added recent transactions and overview memo cards to the dashboard.
- Rebuilt analytics so chart configuration sits above historical comparison with horizontal controls.
- Removed the old asset-state timeline and replaced it with richer income, expense, net-income, forecast, composition, pie, radar, and tree views.
- Added income and expense mean metrics directly beside the corresponding time-series charts.
- Added richer category-composition and multi-pie controls with day, week, month, year, and custom ranges.
- Added inline historical exchange-rate entry to unblock historical comparisons when rates are missing.
- Changed income and expense pie charts to group by transaction purpose instead of account category.
- Reworked analytics card layout so smaller cards stack beside larger charts with matched row heights.
- Swapped the positions of the pie-composition card and the recurring cashflow heat-zone card for a denser analytics column layout.
- Changed the analytics tree snapshot to start folded by default and added one-click expand-all / collapse-all controls.
- Split the lower analytics area into dedicated forecast, composition, and snapshot rows so the right edge stays aligned with the upper charts.
- Moved the cashflow heat-zone and category-composition cards into the same balanced row and paired the radar/custom cards beside the tree snapshot to reduce bottom whitespace.
- Restored the forecast chart to the upper analysis grid so it sits alongside income, expense, and net-income panels again.
- Restacked pie composition above the cashflow heat-zone in the left column and let category composition span the aligned right column.

### Stability and compatibility
- Preserved template, rule, and transaction compatibility for older local data and legacy imports.
- Kept analytics and dashboard state persisted in-panel so rerenders do not drop the active filters.
