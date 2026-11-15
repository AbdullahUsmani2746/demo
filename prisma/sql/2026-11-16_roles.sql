-- Role management — roles are data (app_roles), a person may hold several
-- (User.role = primary + user_roles = more), and only Super Admin skips
-- the permission checks. lib/auth/roles.js · lib/auth/roleCatalog.js.
--
--   1. app_roles      the role catalogue (name, level, which sidebar)
--   2. user_roles     extra roles of a user (the primary stays on User.role)
--   3. role columns   User / PermissionGrant / FieldPolicy .role become
--                     VARCHAR(40) holding an app_roles.code (was enum "Role")
--   4. first run only (app_roles empty): seed the roles, back up every grant
--      to "PermissionGrant_backup_20261116", re-grant each role its
--      best-practice template, move the ACCOUNTANT logins to Super Admin.
--      A person's work screens add view / add / edit / print on those
--      screens at run time (lib/auth/menuPermissions.js) — not stored here.
--
-- Re-runnable: tables IF NOT EXISTS, type changes are no-ops the second
-- time, and step 4 runs only while app_roles is still empty, so a later run
-- never resets roles an admin has changed.

-- 1 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_roles (
  code        VARCHAR(40)  PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(300),
  -- system | management | head | staff | self — groups the Roles screen
  level       VARCHAR(20)  NOT NULL DEFAULT 'staff',
  -- all = the whole menu (Setup → Menu); assigned = the person's Employee menus
  nav_mode    VARCHAR(10)  NOT NULL DEFAULT 'assigned',
  -- built-in: cannot be deleted or deactivated (Super Admin, Employee)
  is_system   BOOLEAN      NOT NULL DEFAULT false,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  sort        INT          NOT NULL DEFAULT 0,
  created_by  VARCHAR(50),
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT         NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role_code  VARCHAR(40)  NOT NULL REFERENCES app_roles(code) ON UPDATE CASCADE,
  created_by VARCHAR(50),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_code)
);
CREATE INDEX IF NOT EXISTS user_roles_role_code_idx ON user_roles (role_code);

-- 3 ──────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN role TYPE VARCHAR(40) USING role::text;
ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'EMPLOYEE';
ALTER TABLE "PermissionGrant" ALTER COLUMN role TYPE VARCHAR(40) USING role::text;
ALTER TABLE "FieldPolicy" ALTER COLUMN role TYPE VARCHAR(40) USING role::text;

-- 4 ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  self_rx  CONSTANT TEXT := '^(hr\.attendance\.own|hr\.leave\.apply|hr\.loan\.apply|hr\.payslip\.own)$';
  view_rx  CONSTANT TEXT := '(\.view$|^export\.)';
  setup_v  CONSTANT TEXT := '^setup\.[a-z_]+\.view$';
BEGIN
  IF EXISTS (SELECT 1 FROM app_roles) THEN
    RETURN;
  END IF;

  INSERT INTO app_roles (code, name, description, level, nav_mode, is_system, sort) VALUES
    ('ADMIN',              'Super Admin',        'Full access to everything; the only role that skips permission checks. May approve own requests.', 'system', 'all', true, 10),
    ('SYSTEM_ADMIN',       'System Admin',       'Users, roles, permissions, menus, settings and notifications — no business documents.', 'system', 'assigned', false, 20),
    ('CEO',                'CEO',                'Sees every screen and report, decides approvals; does not enter documents.', 'management', 'all', false, 110),
    ('COO',                'COO',                'Sees every screen and report, decides approvals; does not enter documents.', 'management', 'all', false, 120),
    ('CFO',                'CFO',                'Sees every screen and report, decides approvals; does not enter documents.', 'management', 'all', false, 130),
    ('DIRECTOR',           'Director',           'Sees every screen and report, decides approvals; does not enter documents.', 'management', 'all', false, 140),
    ('MANAGER',            'General Manager',    'Sees every screen and report, decides approvals; does not enter documents.', 'management', 'all', false, 150),
    ('ACCOUNTS_MANAGER',   'Accounts Manager',   'All accounts work: vouchers, invoicing, period lock, costing, finance reports; posts and pays payroll.', 'head', 'assigned', false, 210),
    ('SALES_MANAGER',      'Sales Manager',      'All sales work, approves sale orders and returns, sees the whole sales team.', 'head', 'assigned', false, 220),
    ('PURCHASE_MANAGER',   'Purchase Manager',   'All purchasing work and purchase reports; vendors.', 'head', 'assigned', false, 230),
    ('STORE_MANAGER',      'Store Manager',      'GRN, dispatch, transfers, issues and stock adjustment; godowns and items.', 'head', 'assigned', false, 240),
    ('PRODUCTION_MANAGER', 'Production Manager', 'All manufacturing work: plans, BOM, recipes, issues, QC; production reports.', 'head', 'assigned', false, 250),
    ('HR_MANAGER',         'HR Manager',         'All HR work and HR approvals for everyone; payroll is posted and paid by Accounts.', 'head', 'assigned', false, 260),
    ('ACCOUNTANT',         'Accountant',         'Receipts, payments, journals, notes and invoicing; finance reports. No delete, no period lock.', 'staff', 'assigned', false, 310),
    ('ACCOUNTS_OFFICER',   'Accounts Officer',   'Enters receipts, payments and journals; finance reports.', 'staff', 'assigned', false, 320),
    ('SALES',              'Sales Officer',      'Sale orders and customers; sales reports for own customers.', 'staff', 'assigned', false, 330),
    ('PURCHASE_OFFICER',   'Purchase Officer',   'Purchase and service orders, bonds; purchase reports.', 'staff', 'assigned', false, 340),
    ('STORE_KEEPER',       'Store Keeper',       'GRN, dispatch, transfers and issues (no delete); stock reports.', 'staff', 'assigned', false, 350),
    ('PRODUCTION_OFFICER', 'Production Officer', 'Issues, inputs, plans, requisitions and QC (no delete); production reports.', 'staff', 'assigned', false, 360),
    ('HR_OFFICER',         'HR Officer',         'Attendance, leave, loans, shifts and holidays (no approvals, no payroll).', 'staff', 'assigned', false, 370),
    ('CASHIER',            'Cashier',            'Point of sale and cash receipts.', 'staff', 'assigned', false, 380),
    ('EMPLOYEE',           'Employee',           'Self-service: own attendance, leave, loans and payslip. Work screens come from their Employee menus.', 'self', 'assigned', true, 900);

  -- Every grant as it was, for reference / rollback.
  CREATE TABLE IF NOT EXISTS "PermissionGrant_backup_20261116" AS SELECT * FROM "PermissionGrant";

  -- Role grants are rebuilt from the templates; a person's own grants and
  -- denies (userId rows) stay as they are.
  DELETE FROM "PermissionGrant" WHERE role IS NOT NULL;

  -- Templates: (role, regex over Permission.code) — and module lists below.
  CREATE TEMP TABLE tpl (role VARCHAR(40), rx TEXT) ON COMMIT DROP;
  INSERT INTO tpl (role, rx)
  SELECT r, self_rx FROM unnest(ARRAY['SYSTEM_ADMIN','CEO','COO','CFO','DIRECTOR','MANAGER','ACCOUNTS_MANAGER','SALES_MANAGER',
    'PURCHASE_MANAGER','STORE_MANAGER','PRODUCTION_MANAGER','HR_MANAGER','ACCOUNTANT','ACCOUNTS_OFFICER','SALES','PURCHASE_OFFICER',
    'STORE_KEEPER','PRODUCTION_OFFICER','HR_OFFICER','CASHIER','EMPLOYEE']) r;

  -- Management: see everything, approve, no entry.
  INSERT INTO tpl (role, rx)
  SELECT r, x FROM unnest(ARRAY['CEO','COO','CFO','DIRECTOR','MANAGER']) r,
    unnest(ARRAY[view_rx, '\.approve$', '^(salesTeam\.viewAll|hr\.scope\.all|audit\.view)$']) x;

  INSERT INTO tpl (role, rx) VALUES
    ('SYSTEM_ADMIN', '^(users|permissions|menus|settings|notification|employee)\.manage$'),
    ('SYSTEM_ADMIN', '^(audit\.view|bi\.design)$'),
    ('SYSTEM_ADMIN', '^setup\.(menus|employee_menus)\.manage$'),
    ('SYSTEM_ADMIN', setup_v),

    ('ACCOUNTS_MANAGER', view_rx),
    ('ACCOUNTS_MANAGER', '^(receipt|payment|journal|credit|debit|letterOfCredit)\.'),
    ('ACCOUNTS_MANAGER', '^(account|taxChallan|fixedAsset|costing)\.manage$'),
    ('ACCOUNTS_MANAGER', '^knockoff\.'),
    ('ACCOUNTS_MANAGER', '^invoicing\.'),
    ('ACCOUNTS_MANAGER', '^(period\.lock|openingStock\.calculate|stock\.adjust)$'),
    ('ACCOUNTS_MANAGER', '^(dispatch\.invoice|dispatch\.unlock|customer\.creditTerms\.update|customer\.book\.update|salesTeam\.viewAll|audit\.view)$'),
    ('ACCOUNTS_MANAGER', '^hr\.(payroll\.(post|pay)|loan\.disburse)$'),
    ('ACCOUNTS_MANAGER', '^setup\.(banks|bank_branches|currencies|cost_centers|financial_years|tax_laws|tax_setups|fixed_asset_categories|fixed_asset_items|lc)\.manage$'),

    ('ACCOUNTANT', '^(receipt|payment|journal|credit|debit|letterOfCredit)\.(view|create|update|print)$'),
    ('ACCOUNTANT', '^invoicing\.[a-z-]+\.(view|generate)$'),
    ('ACCOUNTANT', '^(dispatch|dispatchEdit|dispatchReturn|grn|grnEdit|grnReturn|sale|saleReturn|purchase|purchaseReturn|serviceInvoice)\.view$'),
    ('ACCOUNTANT', '^(knockoff\.(run|allocate)|taxChallan\.manage|dispatch\.invoice)$'),
    ('ACCOUNTANT', '^report\.(accountLedgerSummary|accountLedger|accountsActivity|cbBook|checksInHand|fundsFlow|fundsPosition|journal|payment|receipt|profitLoss|trialBalancePeriod|trialBalanceSheet|trialBalance|customerAging|vendorAging|sale|purchase|stock|stockLedger)\.view$'),
    ('ACCOUNTANT', '^export\.'),
    ('ACCOUNTANT', setup_v),

    ('ACCOUNTS_OFFICER', '^(receipt|payment|journal)\.(view|create|print)$'),
    ('ACCOUNTS_OFFICER', '^report\.(accountLedger|accountLedgerSummary|cbBook|checksInHand|journal|payment|receipt|customerAging|vendorAging)\.view$'),
    ('ACCOUNTS_OFFICER', '^export\.'),
    ('ACCOUNTS_OFFICER', setup_v),

    ('SALES_MANAGER', '^(sale|saleOrder|saleOrderView|saleReturn|dispatch|dispatchEdit|dispatchReturn|dispatchTransfer)\.(view|create|update|delete|print)$'),
    ('SALES_MANAGER', '^(saleOrder|saleReturn)\.(approve|remark)$'),
    ('SALES_MANAGER', '^customer\.(create|update|delete|import|creditTerms\.update)$'),
    ('SALES_MANAGER', '^(salesItem\.rate\.update|dispatch\.rate\.override|salesTeam\.viewAll|salesTarget\.monthEnd)$'),
    ('SALES_MANAGER', '^invoicing\.sale(-return)?\.view$'),
    ('SALES_MANAGER', '^report\.[A-Za-z_]+\.view$'),
    ('SALES_MANAGER', '^export\.'),
    ('SALES_MANAGER', setup_v),

    ('SALES', '^(saleOrder|saleOrderView)\.(view|create|update|print)$'),
    ('SALES', '^(dispatch|dispatchEdit)\.view$'),
    ('SALES', '^customer\.(create|update)$'),
    ('SALES', '^report\.(saleOrder|salesOrderBalance|saleOrderToDispatch|customerAging|dispatch|dailyDispatch|sale|salesTeamMis|salesPerformanceWeekly|stock|fgstock)\.view$'),
    ('SALES', '^export\.'),
    ('SALES', setup_v),

    ('PURCHASE_MANAGER', '^(purchase|purchaseOrder|purchaseOrderEdit|purchaseReturn|serviceOrder|serviceEntry|serviceInvoice|inBond|exbond|exbondEdit|grn|grnEdit|grnReturn|fixedAssetsGrn)\.(view|create|update|delete|print)$'),
    ('PURCHASE_MANAGER', '^invoicing\.purchase(-return)?\.view$'),
    ('PURCHASE_MANAGER', '^setup\.vendors\.manage$'),
    ('PURCHASE_MANAGER', '^report\.(costOfGoodsSold|exbondReport|grnReturn|grn|importedMaterialDeals|importedMaterialinTransit|importedMaterialStock|materialprocurementenquiry|materialprocurement|purchaseOrderBalance|purchaseOrder|purchaseReturn|purchase|vendorAging|serviceEntry|serviceInvoice|serviceOrder|stock|stockLedger|stockActivity)\.view$'),
    ('PURCHASE_MANAGER', '^export\.'),
    ('PURCHASE_MANAGER', setup_v),

    ('PURCHASE_OFFICER', '^(purchaseOrder|purchaseOrderEdit|serviceOrder|inBond|exbond|exbondEdit)\.(view|create|update|print)$'),
    ('PURCHASE_OFFICER', '^(grn|grnEdit)\.view$'),
    ('PURCHASE_OFFICER', '^report\.(purchaseOrder|purchaseOrderBalance|purchase|grn|materialprocurement|materialprocurementenquiry|serviceOrder|stock)\.view$'),
    ('PURCHASE_OFFICER', '^export\.'),
    ('PURCHASE_OFFICER', setup_v),

    ('STORE_MANAGER', '^(grn|grnEdit|grnReturn|fixedAssetsGrn|dispatch|dispatchEdit|dispatchReturn|dispatchTransfer|transfer|transferEdit|requisition|requisitionTransfer|requisitionFGTransfer|fgTransfer|materialIssue|materialIssueLanded|materialInput|serviceEntry)\.(view|create|update|delete|print)$'),
    ('STORE_MANAGER', '^(saleOrder|saleOrderView|purchaseOrder|purchaseOrderEdit)\.view$'),
    ('STORE_MANAGER', '^(stock\.adjust|setup\.godowns\.manage|setup\.items\.manage)$'),
    ('STORE_MANAGER', '^report\.(fgdailystock|fgstock|monthlyStock|stockActivity|stockActivityView|stockLedger|stockMetrics|stock|grn|grnReturn|dispatch|dailyDispatch|dispatchReturn|dispatchWithoutRates|materialTransfer|returnablePacking|materialIssuance|discard|batchBalance|batchLedger)\.view$'),
    ('STORE_MANAGER', '^export\.'),
    ('STORE_MANAGER', setup_v),

    ('STORE_KEEPER', '^(grn|grnEdit|grnReturn|dispatch|dispatchEdit|dispatchReturn|dispatchTransfer|transfer|transferEdit|requisition|requisitionTransfer|requisitionFGTransfer|fgTransfer|materialIssue|serviceEntry)\.(view|create|update|print)$'),
    ('STORE_KEEPER', '^(saleOrder|saleOrderView|purchaseOrder|purchaseOrderEdit)\.view$'),
    ('STORE_KEEPER', '^report\.(fgdailystock|fgstock|stockActivity|stockLedger|stock|grn|dispatch|dailyDispatch|materialTransfer|returnablePacking|batchBalance)\.view$'),
    ('STORE_KEEPER', '^export\.'),
    ('STORE_KEEPER', setup_v),

    ('PRODUCTION_MANAGER', '^(materialIssue|materialIssueLanded|materialInput|productionPlan|requisition|requisitionTransfer|requisitionFGTransfer|fgTransfer|transfer|transferEdit)\.(view|create|update|delete|print)$'),
    ('PRODUCTION_MANAGER', '^(bom|recipe|machineInstruction|qualityControl)\.manage$'),
    ('PRODUCTION_MANAGER', '^(saleOrder|saleOrderView)\.view$'),
    ('PRODUCTION_MANAGER', '^report\.(batchBalance|batchCosting|batchLedger|bom|costOfGoodsManufactured|directMaterialIssuanceCost|masterSample|materialIssuance|materialProduction|orderQc|processOrderReconciliation|processOrderTiming|productionPlanning|qcParameters|qc|rmc|stock|stockLedger|stockActivity|fgstock|fgdailystock|saleOrder|salesOrderBalance)\.view$'),
    ('PRODUCTION_MANAGER', '^export\.'),
    ('PRODUCTION_MANAGER', setup_v),

    ('PRODUCTION_OFFICER', '^(materialIssue|materialInput|productionPlan|requisition|requisitionTransfer|requisitionFGTransfer|fgTransfer|transfer)\.(view|create|update|print)$'),
    ('PRODUCTION_OFFICER', '^qualityControl\.manage$'),
    ('PRODUCTION_OFFICER', '^report\.(batchBalance|batchLedger|materialIssuance|materialProduction|orderQc|processOrderTiming|productionPlanning|qc|stock|fgstock)\.view$'),
    ('PRODUCTION_OFFICER', '^export\.'),
    ('PRODUCTION_OFFICER', setup_v),

    -- HR prepares and approves; Accounts posts and pays (separation of duties).
    ('HR_MANAGER', '^hr\.(attendance|leave|salary|loan|payroll|payslip|devices|shifts|holidays|team|scope)\.'),
    ('HR_MANAGER', '^(employee\.manage|setup\.(departments|designations|employee_categories|employee_types|employees|job_titles|leaves|allowances|deductions|work_locations|managers)\.manage)$'),
    ('HR_MANAGER', '^report\.hr[A-Za-z]+\.view$'),
    ('HR_MANAGER', '^export\.'),
    ('HR_MANAGER', setup_v),

    ('HR_OFFICER', '^hr\.(attendance\.(view|mark|import)|leave\.(view|manage)|loan\.(view|manage)|salary\.view|payroll\.view|shifts\.manage|holidays\.manage|devices\.manage)$'),
    ('HR_OFFICER', '^report\.hr(AttendanceExceptions|AttendanceSummary|Headcount|LeaveRegister|LeaveTaken|Overtime)\.view$'),
    ('HR_OFFICER', '^export\.'),
    ('HR_OFFICER', setup_v),

    ('CASHIER', '^pos\.manage$'),
    ('CASHIER', '^receipt\.(view|create|print)$');

  INSERT INTO "PermissionGrant" ("permissionId", role, allow, "updatedAt")
  SELECT DISTINCT p.id, t.role, true, CURRENT_TIMESTAMP
  FROM "Permission" p JOIN tpl t ON p.code ~ t.rx
  -- HR Manager never posts or pays payroll, nor disburses loans (Accounts does).
  WHERE NOT (t.role = 'HR_MANAGER' AND p.code IN ('hr.payroll.post', 'hr.payroll.pay', 'hr.loan.disburse'))
  ON CONFLICT DO NOTHING;

  -- Tatheer Saleem and the "Admin (Accountant)" login become Super Admin
  -- (owner's decision); ACCOUNTANT is now an ordinary role.
  UPDATE "User" SET role = 'ADMIN' WHERE role = 'ACCOUNTANT';
END $$;
