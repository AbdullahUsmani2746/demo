-- Sale Order → Production Plan → Lab Nature → Process Order → Dispatch (ported
-- from Eastland; Features saleOrder.planFromOrder, production.labNature,
-- dispatch.requirePostedProcessOrder — all off by default).
-- No schema change here: OrderDetail.plan_date / plan_qty, ReqDetail.nature /
-- nature_at, Transactions.plan_no / process_order_no and
-- TransactionsMaster.invoiced_at already exist.
--
-- The two new reports (scripts/seed-permissions.mjs adds their
-- report.<key>.view codes) are given to the same roles as the closest existing
-- report. Re-runnable: only missing grants are added.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT np.id, g.role, g.allow, now(), now()
FROM (VALUES
  ('report.isoTimeline.view',   'report.saleOrderToDispatch.view'),
  ('report.pendingReport.view', 'report.processOrderTiming.view')
) AS m(new_code, like_code)
JOIN "Permission" np ON np.code = m.new_code
JOIN "Permission" lp ON lp.code = m.like_code
JOIN "PermissionGrant" g ON g."permissionId" = lp.id AND g.role IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "PermissionGrant" x WHERE x."permissionId" = np.id AND x.role = g.role
);
