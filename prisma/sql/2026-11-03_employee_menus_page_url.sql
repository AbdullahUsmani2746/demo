-- Point the "Employee menus" menu at the new screen (/accounting/employee-menus)
-- instead of the old row-per-pair setup page. Re-runnable: only rows still on
-- the old url change. EMPLOYEE-role users need the menu url to match the page
-- they open (middleware checks /api/menu/check-permission).
UPDATE "menus"
SET url = '/accounting/employee-menus'
WHERE url = '/accounting/setup/employee_menus';
