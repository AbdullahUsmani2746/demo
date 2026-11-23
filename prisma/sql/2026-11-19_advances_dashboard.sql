-- ============================================================
-- "Advances Dashboard — Purchase Orders" (ported from SMS 2c80f4d): every
-- Purchase Order shows here as soon as Purchasing enters it, and the system
-- keeps ordered / received / remaining qty as GRNs come in against it (BI
-- dataset "purchase_orders", lib/bi/datasets.js).
--
-- Data only: BI questions + one dashboard + who sees it. Change it later in
-- BI Designer like any other dashboard. Re-runnable: does nothing when the
-- dashboard already exists.
--
-- Sees it: the CEO, Purchase Manager and Accounts Manager roles (only those
-- that exist in app_roles) — never a named user; add people in BI Designer.
-- ============================================================
DO $$
DECLARE
  q_open INT; q_ord INT; q_rec INT; q_rem INT; q_val INT;
  q_lines INT; q_vendor INT; q_late INT; q_status INT; q_month INT; q_adv INT;
  d_id INT;
  open_only CONSTANT JSONB := '[{"field":"open_or_closed","op":"eq","value":"Open"}]';
BEGIN
  IF EXISTS (SELECT 1 FROM "BiDashboard" WHERE name = 'Advances Dashboard — Purchase Orders') THEN
    RETURN;
  END IF;

  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Open Purchase Orders', 'POs not yet fully received or closed', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','kpi','options','{}'::jsonb),
       'measures','[{"key":"orders","agg":"distinct"}]'::jsonb,'dimensions','[]'::jsonb,'filters',open_only,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_open;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Ordered Qty (open POs)', NULL, 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','kpi','options','{}'::jsonb),
       'measures','[{"key":"ordered_qty","agg":"sum"}]'::jsonb,'dimensions','[]'::jsonb,'filters',open_only,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_ord;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Received Qty (open POs)', 'GRNs − GRN returns against the PO', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','kpi','options','{}'::jsonb),
       'measures','[{"key":"received_qty","agg":"sum"}]'::jsonb,'dimensions','[]'::jsonb,'filters',open_only,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_rec;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Remaining Qty', 'Still to be received', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','kpi','options','{}'::jsonb),
       'measures','[{"key":"remaining_qty","agg":"sum"}]'::jsonb,'dimensions','[]'::jsonb,'filters',open_only,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_rem;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Pending Value', 'Remaining qty × PO rate', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','kpi','options','{}'::jsonb),
       'measures','[{"key":"pending_value","agg":"sum"}]'::jsonb,'dimensions','[]'::jsonb,'filters',open_only,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_val;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Open PO lines — ordered / received / remaining', 'One row per PO and item still open', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','table','options','{}'::jsonb),
       'measures','[{"key":"ordered_qty","agg":"sum"},{"key":"received_qty","agg":"sum"},{"key":"remaining_qty","agg":"sum"},{"key":"pending_value","agg":"sum"}]'::jsonb,
       'dimensions','[{"field":"order_no"},{"field":"vendor"},{"field":"item"},{"field":"po_status"}]'::jsonb,
       'filters',open_only,'sort',jsonb_build_object('by','m2','dir','desc'),'limit',200,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_lines;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Pending value by vendor', NULL, 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','barH','options','{}'::jsonb),
       'measures','[{"key":"pending_value","agg":"sum"}]'::jsonb,'dimensions','[{"field":"vendor"}]'::jsonb,
       'filters',open_only,'limit',10,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_vendor;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Open for more than 30 days', 'POs still waiting for material a month after they were raised', 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','table','options','{}'::jsonb),
       'measures','[{"key":"remaining_qty","agg":"sum"},{"key":"pending_value","agg":"sum"}]'::jsonb,
       'dimensions','[{"field":"order_no"},{"field":"vendor"},{"field":"item"},{"field":"days_open"}]'::jsonb,
       'filters','[{"field":"open_or_closed","op":"eq","value":"Open"},{"field":"days_open","op":"gte","value":"30"}]'::jsonb,
       'sort',jsonb_build_object('by','m1','dir','desc'),'limit',100,'period','all','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_late;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('PO status (raised this period)', NULL, 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','donut','options','{}'::jsonb),
       'measures','[{"key":"orders","agg":"distinct"}]'::jsonb,'dimensions','[{"field":"po_status"}]'::jsonb,'filters','[]'::jsonb),
     'setup-2026-11-19', now()) RETURNING id INTO q_status;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('POs raised by month — 12 months', NULL, 'purchase_orders',
     jsonb_build_object('dataset','purchase_orders','visual',jsonb_build_object('type','bar','options','{}'::jsonb),
       'measures','[{"key":"ordered_value","agg":"sum"}]'::jsonb,'dimensions','[{"field":"dated","grain":"month"}]'::jsonb,
       'filters','[]'::jsonb,'period','m12','lockPeriod',true),
     'setup-2026-11-19', now()) RETURNING id INTO q_month;
  INSERT INTO "BiQuestion" (name, description, dataset, config, created_by, updated_at) VALUES
    ('Vendor balances — advances first', 'Below 0 = advance paid to the vendor; above 0 = we owe them', 'payables',
     jsonb_build_object('dataset','payables','visual',jsonb_build_object('type','table','options','{}'::jsonb),
       'measures','[{"key":"balance","agg":"sum"}]'::jsonb,'dimensions','[{"field":"vendor"}]'::jsonb,
       'filters','[]'::jsonb,'sort',jsonb_build_object('by','m0','dir','asc'),'limit',25),
     'setup-2026-11-19', now()) RETURNING id INTO q_adv;

  INSERT INTO "BiDashboard" (name, description, layout, default_period, created_by, updated_at)
  VALUES (
    'Advances Dashboard — Purchase Orders',
    'Every Purchase Order with ordered, received and remaining qty (GRNs against the PO), what is late, and vendor advances.',
    jsonb_build_object(
      'filters', '[{"field":"vendor","label":"Vendor"},{"field":"item_category","label":"Item Category"},{"field":"po_status","label":"PO Status"}]'::jsonb,
      'sections', jsonb_build_array(
        jsonb_build_object('id','s_open','title','Open purchase orders','kind','hero','items', jsonb_build_array(
          jsonb_build_object('id','i1','width',1,'questionId',q_open),
          jsonb_build_object('id','i2','width',1,'questionId',q_rem),
          jsonb_build_object('id','i3','width',1,'questionId',q_val))),
        jsonb_build_object('id','s_qty','title','Quantities','kind','compact','items', jsonb_build_array(
          jsonb_build_object('id','i4','width',1,'questionId',q_ord),
          jsonb_build_object('id','i5','width',1,'questionId',q_rec))),
        jsonb_build_object('id','s_track','title','Tracking','items', jsonb_build_array(
          jsonb_build_object('id','i6','width',4,'questionId',q_lines),
          jsonb_build_object('id','i7','width',2,'questionId',q_vendor),
          jsonb_build_object('id','i8','width',2,'questionId',q_late))),
        jsonb_build_object('id','s_trend','title','Trend & advances','items', jsonb_build_array(
          jsonb_build_object('id','i9','width',1,'questionId',q_status),
          jsonb_build_object('id','i10','width',2,'questionId',q_month),
          jsonb_build_object('id','i11','width',1,'questionId',q_adv)))
      )
    ),
    'mtd', 'setup-2026-11-19', now())
  RETURNING id INTO d_id;

  INSERT INTO "BiDashboardAssignment" (dashboard_id, user_id, role, is_landing)
  SELECT d_id, NULL, r.code, false
  FROM app_roles r
  WHERE r.code IN ('CEO', 'PURCHASE_MANAGER', 'ACCOUNTS_MANAGER');
END $$;
