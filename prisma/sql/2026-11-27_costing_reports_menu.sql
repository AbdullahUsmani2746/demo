-- =====================================================================
-- Top-level menu COSTING REPORTS with its reports:
--   STOCK ACTIVITY WITH RATE       /accounting/reports/stockActivityWithRate
--   DATA CHECKING REPORT           /accounting/reports/dataChecking
--   COST OF GOODS MANUFACTURED     /accounting/reports/costOfGoodsManufactured
--   COST OF GOODS SOLD             /accounting/reports/costOfGoodsSold
-- The existing entries under FINANCE / PRODUCTION REPORTS stay. Access to
-- each report is still its permission (report.<key>.view). Employees who
-- have one of these reports in their Employee menus get the same report
-- here, and the new heading with it. Re-runnable. No new tables.
-- =====================================================================
BEGIN;

INSERT INTO "menus" (title, url, parent_id, order_no, icon, is_active)
SELECT 'COSTING REPORTS', NULL, NULL,
       (SELECT COALESCE(MAX(order_no), 0) + 1 FROM "menus" WHERE parent_id IS NULL),
       'ChartNoAxesCombined', true
 WHERE NOT EXISTS (SELECT 1 FROM "menus" WHERE parent_id IS NULL AND title = 'COSTING REPORTS');

INSERT INTO "menus" (title, url, parent_id, order_no, icon, is_active)
SELECT v.title, v.url, p.id, v.ord, v.icon, true
  FROM (VALUES
         ('STOCK ACTIVITY WITH RATE',   '/accounting/reports/stockActivityWithRate',   1, 'Boxes'),
         ('DATA CHECKING REPORT',       '/accounting/reports/dataChecking',            2, 'ListChecks'),
         ('COST OF GOODS MANUFACTURED', '/accounting/reports/costOfGoodsManufactured', 3, 'Factory'),
         ('COST OF GOODS SOLD',         '/accounting/reports/costOfGoodsSold',         4, 'HandCoins')
       ) AS v(title, url, ord, icon)
  JOIN "menus" p ON p.parent_id IS NULL AND p.title = 'COSTING REPORTS'
 WHERE NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.parent_id = p.id AND m.url = v.url);

-- Employee menus: the same report elsewhere → this one too …
INSERT INTO employee_menu (employee_id, menu_id)
SELECT DISTINCT em.employee_id, nm.id
  FROM employee_menu em
  JOIN "menus" om ON om.id = em.menu_id
  JOIN "menus" p  ON p.parent_id IS NULL AND p.title = 'COSTING REPORTS'
  JOIN "menus" nm ON nm.parent_id = p.id AND nm.url = om.url AND nm.id <> om.id
ON CONFLICT DO NOTHING;

-- … and the heading for anyone who has one of its reports.
INSERT INTO employee_menu (employee_id, menu_id)
SELECT DISTINCT em.employee_id, p.id
  FROM employee_menu em
  JOIN "menus" c ON c.id = em.menu_id
  JOIN "menus" p ON p.id = c.parent_id AND p.parent_id IS NULL AND p.title = 'COSTING REPORTS'
ON CONFLICT DO NOTHING;

COMMIT;
