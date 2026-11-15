-- Reports ported from the Eastland and Accounting systems into Bizlogist ERP
-- (scripts/seed-permissions.mjs adds their report.<key>.view codes).
-- Each new report is given to the same roles as the existing report closest to it,
-- so nobody has to hand them out one by one. Re-runnable: only missing grants are added.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT np.id, g.role, g.allow, now(), now()
FROM (VALUES
  ('report.profitLossMonthly.view',        'report.profitLoss.view'),
  ('report.withHoldingTax.view',           'report.profitLoss.view'),
  ('report.digitalInvoice.view',           'report.profitLoss.view'),
  ('report.dailyProduction.view',          'report.materialProduction.view'),
  ('report.monthWiseRMMovingAverage.view', 'report.materialProduction.view'),
  ('report.rmCosting.view',                'report.materialProduction.view'),
  ('report.customerFile.view',             'report.customerAging.view'),
  ('report.ilfile.view',                   'report.customerAging.view'),
  ('report.pcfile.view',                   'report.customerAging.view'),
  ('report.prfile.view',                   'report.customerAging.view'),
  ('report.purchasingfile.view',           'report.purchaseOrder.view')
) AS m(new_code, like_code)
JOIN "Permission" np ON np.code = m.new_code
JOIN "Permission" lp ON lp.code = m.like_code
JOIN "PermissionGrant" g ON g."permissionId" = lp.id AND g.role IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "PermissionGrant" x WHERE x."permissionId" = np.id AND x.role = g.role
);
