// config/entityConfig.js

const entityConfig = {
  companies: {
    title: "Companies",
    endpoint: "/api/setup/companies",
    buttonText: "Add Company",
    tableFields: [
      { name: "company", label: "Company", sortable: true },
      { name: "city", label: "City", sortable: true },
      { name: "phone", label: "phone", sortable: true },
      { name: "email", label: "Email", sortable: true },
    ],
    fields: [
      {
        name: "company",
        label: "Company",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "addr1",
        label: "Address 1",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      { name: "addr2", label: "Address 2", fieldType: "text", sortable: true, uppercase: true },
      {
        name: "city",
        label: "City",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "phone",
        label: "phone",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      { name: "fax", label: "Fax", fieldType: "text", sortable: true, uppercase: true },
      {
        name: "email",
        label: "Email",
        fieldType: "email",
        required: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  currencies: {
    title: "Currencies",
    endpoint: "/api/setup/currencies",
    buttonText: "Add Currency",
    fields: [
      {
        name: "currency",
        label: "Currency",
        fieldType: "text",
        required: true,
        uppercase: true,
        sortable: true,
      },
    ],
  },

  godowns: {
    title: "Godowns",
    endpoint: "/api/setup/godowns",
    // Closed godowns are hidden from every dropdown, but this screen must list
    // them so they can be reopened.
    listParams: { includeInactive: true },
    buttonText: "Add Godown",
    fields: [
      { name: "godown", label: "Godown", fieldType: "text", required: true, uppercase: true },
      {
        name: "is_active",
        label: "Status",
        fieldType: "checkbox",
        checkboxLabel: "Open — untick to close this godown everywhere",
        trueLabel: "Open",
        falseLabel: "Closed",
        defaultValue: true,
      },
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
    ],
    allowDelete: false
  },

  bond_locations: {
    title: "Bond Locations",
    endpoint: "/api/setup/bond_locations",
    buttonText: "Add Bond Location",
    fields: [
      { name: "location", label: "Location", fieldType: "text", required: true, uppercase: true },
      { name: "address", label: "Address", fieldType: "text", required: false },
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
    ],
    allowDelete: false
  },

  product_master_categories: {
    title: "Product Master Categories",
    endpoint: "/api/setup/product_master_categories",
    buttonText: "Add Product Master Category",
    fields: [
      {
        name: "pmc_name",
        label: "Product Master Category Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
  },

  main_categories: {
    title: "Ink Series",
    endpoint: "/api/setup/main_categories",
    buttonText: "Add Ink Series",
    fields: [
      {
        name: "mc_name",
        label: "Ink Series",
        fieldType: "text",
        required: true,
        sortable: true,
      },
      {
        name: "id",
        label: "ID",
        fieldType: "number",
        required: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  product_groups: {
    title: "Product Groups",
    endpoint: "/api/setup/product_groups",
    buttonText: "Add Product Group",
    fields: [
      {
        name: "pg_name",
        label: "Product Group Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        relation: "ProductMasterCategories",
        relationName: "pmc_name",
        name: "pmc_id",
        label: "Product Master Category",
        fieldType: "select",
        fetchFrom: "/api/setup/product_master_categories",
        optionLabelKey: "pmc_name",
        optionValueKey: "id",
        required: true,
      },
    ],
  },

  item_categories: {
    title: "Item Categories",
    endpoint: "/api/setup/item_categories",
    buttonText: "Add Item Category",
    fields: [
      {
        name: "id",
        label: "Code",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "ic_name",
        label: "Item Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "gets_plant_expenses",
        label: "Gets plant expenses",
        fieldType: "checkbox",
        checkboxLabel: "Costing: every item of this group shares the month's plant expenses when made on a process order",
        trueLabel: "Yes",
        falseLabel: "No",
        defaultValue: false,
        // read by the "item" costing engine only (lib/costing/plantExpenseProducts.js)
        feature: "costing.engine",
        featureValue: "item",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "sale_acno",
        name: "sale_acno",
        label: "Sale Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      // Sale account of a "Despatch Without Godown" Sale Order — no default:
      // empty refuses such a dispatch (lib/dispatch/withoutGodown.js)
      {
        relation: "ProductMasterCategories",
        relationName: "nogodown_sale_acno",
        name: "nogodown_sale_acno",
        label: "No Godown Sale Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "cogs_acno",
        name: "cogs_acno",
        label: "Cogs Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "pos_acno",
        name: "pos_acno",
        label: "POS Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "cogm_acno",
        name: "cogm_acno",
        label: "Cogm Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      // Settings → Features "grn.directRateByItem" (lib/grn/directRate.js)
      {
        name: "grn_direct_rate",
        label: "Rate entered on the GRN",
        fieldType: "checkbox",
        checkboxLabel: "Its items take the rate typed on the GRN (not the PO rate)",
        defaultValue: false,
        feature: "grn.directRateByItem",
      },
    ],
    allowDelete: false
  },

  items: {
    title: "Items",
    endpoint: "/api/setup/items",
    buttonText: "Add Item",
    fields: [
      {
        name: "item",
        label: "Item Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        relation: "item_category",
        relationName: "item_category",
        name: "ic_id",
        label: "Item Category",
        fieldType: "select",
        fetchFrom: "/api/setup/item_categories",
        optionLabelKey: "ic_name",
        optionValueKey: "id",
        required: true,
      },
    ],
  },
  fixed_asset_items: {
    title: "Fixed Asset Items",
    endpoint: "/api/setup/fixed_asset_items",
    buttonText: "Add Fixed Asset Item",
    tableFields: [
      { name: "itcd", label: "Code", sortable: true },
      { name: "item", label: "Item Name", sortable: true },
      {
        relation: "itemCategories",
        relationName: "ic_name",
        name: "itemCategories",
        label: "Item Category",
        sortable: false,
      },
    ],
    fields: [
      {
        name: "item",
        label: "Item Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true,
      },
      {
        relation: "itemCategories",
        relationName: "itemCategories",
        name: "ic_id",
        label: "Item Category",
        fieldType: "select",
        // Only FA categories
        fetchFrom: "/api/setup/fixed_asset_categories",
        optionLabelKey: "ic_name",
        optionValueKey: "id",
        required: true,
      },
    ],
    allowDelete: false,
  },

  fixed_asset_categories: {
    title: "FIxed Asset Categories",
    endpoint: "/api/setup/fixed_asset_categories",
    buttonText: "Add Fixed Asset Category",
    fields: [
      {
        name: "ic_name",
        label: "Item Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        relation: "ProductMasterCategories",
        relationName: "sale_acno",
        name: "sale_acno",
        label: "Sale Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "cogs_acno",
        name: "cogs_acno",
        label: "Cogs Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "pos_acno",
        name: "pos_acno",
        label: "POS Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        relation: "ProductMasterCategories",
        relationName: "cogm_acno",
        name: "cogm_acno",
        label: "Cogm Acno",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
    ],
    allowDelete: false
  },


  subtrates: {
    title: "Subtrates",
    endpoint: "/api/setup/subtrates",
    buttonText: "Add Subtrate",
    fields: [
      {
        name: "subtrate",
        label: "Subrate Name",
        fieldType: "text",
        required: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },


  // Add these to your existing entityConfig.js

  ink_types: {
    title: "Ink Types",
    endpoint: "/api/setup/ink_types",
    buttonText: "Add Ink Type",
    fields: [
      {
        name: "ink_type",
        label: "Ink Type",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  sr_laminations: {
    title: "SR Lamination",
    endpoint: "/api/setup/sr_laminations",
    buttonText: "Add SR Lamination",
    fields: [
      {
        name: "sr_lamination",
        label: "SR Lamination",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  color_codes: {
    title: "Color Codes",
    endpoint: "/api/setup/color_codes",
    buttonText: "Add Color Code",
    fields: [
      {
        name: "color_code",
        label: "Color Code",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  business_units: {
    title: "Business Units",
    endpoint: "/api/setup/business_units",
    buttonText: "Add Business Unit",
    fields: [
      {
        name: "business_unit",
        label: "Business Unit",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  nature_of_inks: {
    title: "Nature of Inks",
    endpoint: "/api/setup/nature_of_inks",
    buttonText: "Add Nature of Ink",
    fields: [
      {
        name: "nature_of_ink",
        label: "Nature of Ink",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  printing_properties: {
    title: "Printing Properties",
    endpoint: "/api/setup/printing_properties",
    buttonText: "Add Printing Property",
    fields: [
      {
        name: "printing_property",
        label: "Printing Property",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  financial_years: {
    title: "Financial Years",
    endpoint: "/api/setup/financial_years",
    buttonText: "Add Financial Year",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
      },
      {
        name: "date_from",
        label: "Start Date",
        fieldType: "date",
        required: true,
        sortable: true,
      },
      {
        name: "date_to",
        label: "End Date",
        fieldType: "date",
        required: true,
        sortable: true,
      },
      {
        name: "status",
        label: "Status",
        fieldType: "select",
        options: [
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
        ],
        required: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  seasons: {
    title: "Seasons",
    endpoint: "/api/setup/seasons",
    buttonText: "Add Season",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
      {
        name: "date_from",
        label: "Start Date",
        fieldType: "date",
        required: true,
        sortable: true,
      },
      {
        name: "date_to",
        label: "End Date",
        fieldType: "date",
        required: true,
        sortable: true,
      },
      {
        name: "status",
        label: "Status",
        fieldType: "select",
        options: [
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
        ],
        required: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  purchase_product_categories: {
    title: "PO Product Categories",
    endpoint: "/api/setup/purchase_product_categories",
    buttonText: "Add PO Product Category",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
      {
        name: "category_name",
        label: "Category Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  delivery_modes: {
    title: "Delivery Modes",
    endpoint: "/api/setup/delivery_modes",
    buttonText: "Add Delivery Mode",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
      {
        name: "delivery_mode",
        label: "Delivery Mode",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "rate_kg",
        label: "Rate",
        fieldType: "number",
        required: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  tax_setups: {
    title: "Tax Setups",
    endpoint: "/api/setup/tax_setups",
    buttonText: "Add Tax Setup",
    fields: [
      {
        name: "tax_name",
        label: "Tax Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      }
    ]
  },

  tax_laws: {
    title: "Tax Laws",
    endpoint: "/api/setup/tax_laws",
    buttonText: "Add Tax Law",
    fields: [
      {
        relation: "taxSetup",
        relationName: "tax_name",
        name: "tax_code",
        label: "Tax Code",
        fieldType: "select",
        fetchFrom: "/api/setup/tax_setups",
        optionLabelKey: "tax_name",
        optionValueKey: "tax_code",
        required: true,
        // sortable: true,
      },
      {
        name: "section_description",
        label: "Section Description",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "rate_filer",
        label: "Rate for Filer",
        fieldType: "number",
        required: true,
        sortable: true,
      },
      {
        name: "rate_non_filer",
        label: "Rate for Non Filer",
        fieldType: "number",
        required: true,
        sortable: true,
      },
      // Where the withheld tax is booked (Settings → Features "tax.lineWht", lib/tax/lineWht.js)
      {
        relation: "taxAcno",
        relationName: "acname",
        name: "tax_acno",
        label: "Payable Account",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
    ],
  },
  delivery_terms: {
    title: "Delivery Terms",
    endpoint: "/api/setup/delivery_terms",
    buttonText: "Add Delivery Term",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
      {
        name: "delivery_term",
        label: "Delivery Term",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  commission_terms: {
    title: "Commission Terms",
    endpoint: "/api/setup/commission_terms",
    buttonText: "Add Commission Term",
    fields: [
      {
        relation: "company",
        relationName: "company",
        name: "company_id",
        label: "Company",
        fieldType: "select",
        fetchFrom: "/api/setup/companies",
        optionLabelKey: "company",
        optionValueKey: "id",
        required: true,
        sortable: false,
      },
      {
        name: "commission_term",
        label: "Commission Term",
        fieldType: "text",
        required: true,
        uppercase: true,
        sortable: true,
      },
    ],
    allowDelete: false
  },

  departments: {
    title: "Departments",
    endpoint: "/api/setup/departments",
    buttonText: "Add Department",
    fields: [
      {
        name: "dept_name",
        label: "Dept Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      // {
      //   relation: "company",
      //   relationName: "company",
      //   name: "company_id",
      //   label: "Company",
      //   fieldType: "select",
      //   fetchFrom: "/api/setup/companies",
      //   optionLabelKey: "company",
      //   optionValueKey: "id",
      //   required: true,
      // },
      {
        name: "dept_description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  cost_centers: {
    title: "Cost Centers",
    endpoint: "/api/setup/cost_centers",
    buttonText: "Add Cost Center",
    fields: [
      {
        name: "ccname",
        label: "CC Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "cc_description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  work_locations: {
    title: "Work Locations",
    endpoint: "/api/setup/work_locations",
    buttonText: "Add Work Location",
    fields: [
      {
        name: "location_name",
        label: "Work Location",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
      {
        name: "location_description",
        label: "Description",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
  },

  banks: {
    title: "Banks",
    endpoint: "/api/setup/banks",
    buttonText: "Add Bank",
    fields: [
      {
        name: "name",
        label: "Bank",
        fieldType: "text",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  designations: {
    title: "Designation",
    endpoint: "/api/setup/designations",
    buttonText: "Add Designation",
    fields: [
      {
        name: "desg_name",
        label: "Job Title",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "desg_description",
        label: "Description",
        fieldType: "text",
        required: true,
        uppercase: true,
        sortable: true,
      },
    ],
    allowDelete: false,
  },
  cities: {
    title: "Cities",
    endpoint: "/api/setup/cities",
    buttonText: "Add City",
    fields: [
      {
        name: "name",
        label: "City Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },

    ],
    allowDelete: false
  },

  branches: {
    title: "Branches",
    endpoint: "/api/setup/branches",
    buttonText: "Add Branch",
    fields: [
      {
        name: "name",
        label: "Branch Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },

    ],
    allowDelete: false
  },

  bank_branches: {
    title: "Bank Branches",
    endpoint: "/api/setup/bank_branches",
    buttonText: "Add Bank Branch",
    fields: [
      {
        relation: "bank",
        relationName: "name",
        name: "bank_id",
        label: "Bank",
        fieldType: "select",
        fetchFrom: "/api/setup/banks",
        optionLabelKey: "name",
        optionValueKey: "id",
        required: true,
        sortable: true,
      },
      {
        name: "name",
        label: "Branch Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "branch_code",
        label: "Branch Code",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },
  allowances: {
    title: "Allowances",
    endpoint: "/api/setup/allowances",
    buttonText: "Add Allowance",
    fields: [
      {
        name: "allowance",
        label: "Allowance",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "allowance_description",
        label: "Description",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "rate",
        label: "Rate",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  deductions: {
    title: "Deductions",
    endpoint: "/api/setup/deductions",
    buttonText: "Add Deduction",
    fields: [
      {
        name: "deduction",
        label: "Deduction",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "deduction_description",
        label: "Description",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "rate",
        label: "Rate",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  leaves: {
    title: "Leaves",
    endpoint: "/api/setup/leaves",
    buttonText: "Add Leave",
    fields: [
      {
        name: "leave",
        label: "Leave",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "leave_description",
        label: "Description",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "balance",
        label: "Balance",
        fieldType: "number",
        required: false,
        sortable: true,
      },
      {
        name: "maxCarryForward",
        label: "Max Carry Forward",
        fieldType: "number",
        required: false,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  },

  managers: {
    title: "Managers",
    endpoint: "/api/setup/managers",
    buttonText: "Add Manager",
    tableFields: [
      { name: "manager", label: "Manager Name", sortable: true },
      {
        name: "department",
        label: "Department",
        sortable: true,
        relationKey: "dept_name",
      },
      {
        name: "employee",
        label: "Employee",
        sortable: true,
        relationKey: "firstName",
      },
    ],
    fields: [
      {
        relation: "department",
        relationName: "department",
        name: "department_id",
        label: "Department",
        fieldType: "select",
        fetchFrom: "/api/setup/departments",
        optionLabelKey: "dept_name",
        optionValueKey: "id",
        required: true,
      },
      {
        relation: "employee",
        relationName: "employee",
        name: "employeeId",
        label: "Employee (Manager)",
        fieldType: "select",
        // Department ke basis par employees filter karo
        fetchFrom: (formData) => {
          if (formData.department_id) {
            return `/api/setup/employees?departmentId=${formData.department_id}&status=ACTIVE`;
          }
          return "/api/setup/employees?status=ACTIVE";
        },
        // Full name display karo
        optionLabelKey: (item) => {
          const middleName = item.middleName ? ` ${item.middleName}` : "";
          return `${item.firstName}${middleName} ${item.surname}`;
        },
        optionValueKey: "id",
        required: true,
        dependsOn: ["department_id"],
      },
      {
        name: "manager",
        label: "Manager Name",
        fieldType: "text",
        required: true,
        readOnly: true,
        uppercase: true,
        placeholder: "Will be auto-filled when employee is selected",
      },
    ],
    allowDelete: false,
  },

  employee_types: {
    title: "Employee Type",
    endpoint: "/api/setup/employee_types",
    buttonText: "Add Employee Type",
    fields: [
      {
        name: "name",
        label: "Employee Type",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
  },

  employee_categories: {
    title: "Employee Categories",
    endpoint: "/api/setup/employee_categories",
    buttonText: "Add Employee Type",
    fields: [
      {
        name: "name",
        label: "Employee Category",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
  },

  employees: {
    title: "Employees",
    endpoint: "/api/setup/employees",
    buttonText: "Add Employee",
    tableFields: [
      { name: "firstName", label: "Name", sortable: true },
      { name: "emailAddress", label: "Email", sortable: true },
      { name: "phoneNumber", label: "Phone", sortable: true },
      { name: "status", label: "Status", sortable: true },
    ],
    fields: [
      {
        name: "firstName",
        label: "First Name",
        fieldType: "text",
        required: true,
        sortable: true,
        upppercase: true
      },
      {
        name: "surname",
        label: "Surname",
        fieldType: "text",
        required: true,
        sortable: true,
        upppercase: true
      },
      {
        name: "dob",
        label: "Date of Birth",
        fieldType: "date",
        required: true,
        sortable: true,
        upppercase: true
      },
      {
        name: "cnicNumber",
        label: "CNIC Number",
        fieldType: "text",
        required: true,
        sortable: true,
      },
      {
        name: "hireDate",
        label: "Hire Date",
        fieldType: "date",
        required: true,
        sortable: true,
      },
      {
        name: "dor",
        label: "Date of Regularization",
        fieldType: "date",
        required: false,
        sortable: true,
      },
      {
        name: "gender",
        label: "Gender",
        fieldType: "select",
        options: [
          { value: "Male", label: "Male" },
          { value: "Female", label: "Female" },
        ],
        required: true,
        sortable: true,
      },
      {
        relation: "city",
        relationName: "name",
        name: "cityId",
        label: "City",
        fieldType: "select",
        fetchFrom: "/api/setup/cities",
        optionLabelKey: "name",
        optionValueKey: "id",
        required: true,
        // sortable: true,
        upppercase: true
      },
      {
        name: "phoneNumber",
        label: "Phone Number",
        fieldType: "text",
        sortable: true,
      },
      {
        name: "emailAddress",
        label: "Email",
        fieldType: "email",
        required: true,
        sortable: true,
      },
      {
        relation: "Designation",
        relationName: "desg_name",
        name: "designationId",
        label: "Designation",
        fieldType: "select",
        fetchFrom: "/api/setup/designations",
        optionLabelKey: "desg_name",
        optionValueKey: "id",
        required: true,
        // sortable: true,
      },
      {
        relation: "department",
        relationName: "dept_name",
        name: "departmentId",
        label: "Department",
        fieldType: "select",
        fetchFrom: "/api/setup/departments",
        optionLabelKey: "dept_name",
        optionValueKey: "id",
        required: true,
        sortable: true,
      },
      {
        relation: "branch",
        relationName: "branch",
        name: "branchId",
        label: "Branch",
        fieldType: "select",
        fetchFrom: "/api/setup/branches",
        optionLabelKey: "name",
        optionValueKey: "id",
        required: true,
        // sortable: true,
      },

      {
        relation: "employeeCategory",
        relationName: "name",
        name: "employeecatId",
        label: "Employee Category",
        fieldType: "select",
        fetchFrom: "/api/setup/employee_categories",
        optionLabelKey: "name",
        optionValueKey: "id",
        required: true,
        sortable: true,
      },

      {
        relation: "employeeType",
        relationName: "name",
        name: "employeetypeId",
        label: "Employee Type",
        fieldType: "select",
        fetchFrom: "/api/setup/employee_types",
        optionLabelKey: "name",
        optionValueKey: "id",
        required: true,
        sortable: true,
      },



      // {
      //   relation: "workLocation",
      //   relationName: "workLocation",
      //   name: "workLocationId",
      //   label: "Work Location",
      //   fieldType: "select",
      //   fetchFrom: "/api/setup/work_locations",
      //   optionLabelKey: "location_name",
      //   optionValueKey: "id",
      //   required: true,
      //   sortable: true,
      // },
      {
        relation: "manager",
        relationName: "manager",
        name: "managerId",
        label: "Manager",
        fieldType: "select",
        fetchFrom: "/api/setup/managers",
        optionLabelKey: "manager",
        optionValueKey: "id",
        sortable: true,
      },
      {
        name: "status",
        label: "Status",
        fieldType: "select",
        options: [
          { value: "ACTIVE", label: "ACTIVE" },
          { value: "INACTIVE", label: "INACTIVE" },
        ],
        required: true,
        sortable: true,
      },
      {
        name: "paymentMethod",
        label: "Payment Method",
        fieldType: "select",
        options: [
          { value: "CASH", label: "CASH" },
          { value: "DIRECT_DEPOSIT", label: "DIRECT_DEPOSIT" },
          { value: "CHEQUE", label: "CHEQUE" },
        ],
        required: true,
      },
      {
        relation: "bank",
        relationName: "bank",
        name: "bankId",
        label: "Bank",
        fieldType: "select",
        fetchFrom: "/api/setup/banks",
        optionLabelKey: "name",
        optionValueKey: "id",
      },
      {
        relation: "bankBranch",
        relationName: "bankBranch",
        name: "bankBranchId",
        label: "Bank Branch",
        fieldType: "select",
        fetchFrom: "/api/setup/bank_branches",
        optionLabelKey: "name",
        optionValueKey: "id",
        // required: true,
        sortable: true,
      },
      {
        name: "accountName",
        label: "Account Name",
        fieldType: "text",
        upppercase: true
      },
      {
        name: "accountNumber",
        label: "Account Number",
        fieldType: "text",
        upppercase: true
      },
      {
        name: "payType",
        label: "Pay Type",
        fieldType: "select",
        options: [
          { value: "SALARY", label: "SALARY" },
          { value: "HOUR", label: "HOUR" },
        ],
        required: true,
      },
      {
        name: "rate",
        label: "Salary/Hour Rate",
        fieldType: "number",
        required: true,
      },
      {
        name: "payFrequency",
        label: "Pay Frequency",
        fieldType: "select",
        options: [
          { value: "MONTHLY", label: "MONTHLY" },
          { value: "FORTNIGHTLY", label: "FORTNIGHTLY" },
          { value: "WEEKLY", label: "WEEKLY" },
        ],
        required: true,
      },
      {
        relation: "costCenter",
        relationName: "costCenter",
        name: "costCenterId",
        label: "Cost Center",
        fieldType: "select",
        fetchFrom: "/api/setup/cost_centers",
        optionLabelKey: "ccname",
        optionValueKey: "ccno",
        required: true,
      },
    ],
    allowDelete: false
  },

  vendors: {
    title: "Vendor Master",
    endpoint: "/api/setup/vendors",
    tableFields: [
      { name: "acno", label: "Code", sortable: true },
      { name: "acname", label: "Name", sortable: true },
      { name: "city", label: "City", sortable: true },
      { name: "email", label: "Email", sortable: true },
      { name: "category", label: "Category", sortable: true },
    ],
    fields: [
      {
        name: "acno",
        label: "Code",
        fieldType: "text",
        required: true,
        readOnly: true,
      },
      { name: "acname", label: "Name", fieldType: "text", required: true, upppercase: true },
      { name: "address", label: "Detail Address", fieldType: "text", upppercase: true },
      { name: "area", label: "Area", fieldType: "text", upppercase: true },
      { name: "city", label: "City", fieldType: "text", upppercase: true },
      { name: "phoneFax", label: "Phone/Fax", fieldType: "text", upppercase: true },
      { name: "salesArea", label: "Sales Person", fieldType: "text", upppercase: true },
      { name: "contactPerson", label: "Contact Person", fieldType: "text", upppercase: true },
      { name: "ntnNo", label: "NTN No", fieldType: "text", required: false, upppercase: true },
      { name: "isDisabled", label: "Disabled", fieldType: "checkbox" },
      {
        name: "type",
        label: "Type",
        fieldType: "select",
        options: [{ value: "regular", label: "Regular" }],
      },
    ],
    allowAdd: true, // add disable
    allowEdit: true, // sirf edit khulega
    allowDelete: false, // delete bhi disable
  },

  quality_parameters: {
    title: "Quality Parameters",
    endpoint: "/api/setup/quality_parameters",
    buttonText: "Add Quality Parameter",
    fields: [
      {
        name: "parameter_name",
        label: "Parameter Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false,

    tableFields: [
      {
        name: "parameter_name",
        label: "Parameter Name",
        fieldType: "text",
        sortable: true,
      },
    ],
  },
  menus: {
    title: "Menu Masters",
    endpoint: "/api/setup/menus",
    tableFields: [
      { name: "id", label: "ID", sortable: true },
      { name: "title", label: "Title", sortable: true },
      { name: "url", label: "URL", sortable: true },
      { name: "icon", label: "Icon", sortable: true },
      { name: "parent_id", label: "Parent ID", sortable: true },
      { name: "order_no", label: "Order No", sortable: true },
      { name: "is_active", label: "Active", sortable: true },
    ],
    fields: [
      {
        name: "title",
        label: "Title",
        fieldType: "text",
        required: true,
        uppercase: true
      },
      {
        name: "url",
        label: "URL",
        fieldType: "text",
        required: false,
      },
      {
        name: "icon",
        label: "Icon",
        fieldType: "text",
        required: false,
        placeholder: "e.g. SquareTerminal",
        uppercase: true
      },
      {
        name: "parent_id",
        label: "Parent ID",
        fieldType: "number",
        required: false,
      },
      {
        name: "order_no",
        label: "Order Number",
        fieldType: "number",
        required: false,
      },
      {
        name: "is_active",
        label: "Active",
        fieldType: "checkbox",
      },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: false,
  },

  employee_menus: {
    title: "Employee Menu Assignments",
    endpoint: "/api/setup/employee_menus",
    fields: [

      {
        relation: "employee",
        relationName: "firstName",
        relationName2: "surname",
        name: "employee_id",
        label: "Employee",
        fieldType: "select",
        fetchFrom: "/api/setup/employees",
        // Full name + employee no, so people with the same first name can be told apart
        optionLabelKey: (e) =>
          `${[e.firstName, e.middleName, e.surname].filter(Boolean).join(" ")} (${e.id})`,
        optionValueKey: "id",
        required: true,
      },
      {
        relation: "menu",
        relationName: "title",
        name: "menu_id",
        label: "Menu",
        fieldType: "select",
        fetchFrom: "/api/setup/menus?parent_id=null",
        optionLabelKey: "title",
        optionValueKey: "id",
        required: true,
      },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: false,
  },

  service_categories: {
    title: "Service Categories",
    endpoint: "/api/setup/service_categories",
    buttonText: "Add Service Category",
    fields: [
      {
        name: "sc_name",
        label: "Service Category",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        name: "expense_acno",
        label: "Default Expense Account",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
    ],
    allowDelete: false
  },

  services: {
    title: "Services",
    endpoint: "/api/setup/services",
    // Show switched-off services too, so they can be switched back on.
    listParams: { includeInactive: true },
    buttonText: "Add Service",
    fields: [
      {
        name: "service_name",
        label: "Service Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      {
        relation: "serviceCategory",
        relationName: "sc_name",
        name: "sc_id",
        label: "Service Category",
        fieldType: "select",
        fetchFrom: "/api/setup/service_categories",
        optionLabelKey: "sc_name",
        optionValueKey: "id",
        required: true,
      },
      {
        name: "expense_acno",
        label: "Expense Account (blank = category default)",
        fieldType: "select",
        fetchFrom: "/api/accounts/acno",
        optionLabelKey: "acname",
        optionValueKey: "acno",
      },
      {
        name: "is_active",
        label: "Status",
        fieldType: "checkbox",
        checkboxLabel: "Active — untick to hide this service from new invoices",
        trueLabel: "Active",
        falseLabel: "Off",
        defaultValue: true,
      },
    ],
    allowDelete: false
  },

  lc: {
    title: "Letter of Credits",
    endpoint: "/api/setup/lc",
    buttonText: "Add Letter of Credit",
    tableFields: [
      { name: "acname", label: "LC Name", sortable: true },
      // { name: "acno", label: "ID", sortable: true },
    ],
    fields: [
      {
        name: "acname",
        label: "LC Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
      // The server requires a main account from Account Settings → "LC / Import
      // Accounts" (requireLcMacno); without this field every save was refused.
      {
        name: "macno",
        label: "Main Account",
        fieldType: "select",
        fetchFrom: "/api/accounts/macno?group=lc_accounts",
        optionLabelKey: "macname",
        optionValueKey: "macno",
        required: true,
      },
    ],
    allowDelete: false
  },

  beneficiary: {
    title: "Beneficiaries",
    endpoint: "/api/setup/beneficiary",
    buttonText: "Add Beneficiary",
     tableFields: [
      { name: "acname", label: "Beneficiary Name", sortable: true },
      { name: "acno", label: "ID", sortable: true },
    ],
    fields: [
      {
        name: "acname",
        label: "Beneficiary Name",
        fieldType: "text",
        required: true,
        sortable: true,
        uppercase: true
      },
    ],
    allowDelete: false
  }

};

export default entityConfig;
