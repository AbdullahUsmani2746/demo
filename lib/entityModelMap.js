// lib/entityModelMap.js
//
// Optional per-entity hooks read by app/api/setup/[entity]/route.js:
//   defaultWhere   object, or async () => object (resolved per request — used
//                  for account groups from Finance → Account Settings)
//   beforeCreate   async (data) => data — completes / validates a new row;
//                  throw an Error with statusCode to refuse the create
//   beforeUpdate   async (data) => data — same, for app/api/setup/[entity]/[id]
import prisma from "@/lib/prisma"; // Import Prisma client
import { getVendorMacnos } from "@/lib/accounts/partyMacnos";
import { getAccountGroup, accountSettingError } from "@/lib/accounts/accountSettings";

// An account picked on a setup form ({value,label} or a number); blank → null.
function optionalAcno(v) {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// An LC / import account must sit under a main account of the "lc_accounts"
// group (Finance → Account Settings).
async function requireLcMacno(data) {
  const groups = await getAccountGroup("lc_accounts");
  if (!groups.length) throw accountSettingError("lc_accounts");
  if (!groups.includes(Number(data.macno))) {
    throw Object.assign(
      new Error("Pick a main account from 'LC / Import Accounts' (Finance → Account Settings)"),
      { statusCode: 422 },
    );
  }
  return data;
}
import { Description } from "@radix-ui/react-dialog";
import { Citrus } from "lucide-react";

const entityModelMap = {
  currencies: {
    model: prisma.currency,
    fields: (body) => ({
      currency: body.currency,
    }),
  },
  product_master_categories: {
    model: prisma.productMasterCategory,
    searchableFields: ["pmc_name"],
    fields: (body) => ({
      pmc_name: body.pmc_name,
    }),
  },
  product_groups: {
    model: prisma.productGroup,
    include: { ProductMasterCategories: true },
    searchableFields: ["pg_name"],
    fields: (body) => ({
      pg_name: body.pg_name,
      pmc_id: parseInt(body.pmc_id),
    }),
  },
  product_categories: {
    model: prisma.productCategory,
    searchableFields: ["pc_name"],
    fields: (body) => ({
      pc_name: body.pc_name,
    }),
  },
  main_categories: {
    model: prisma.mainCategory,
    searchableFields: ["mc_name"],
    defaultSort: { mc_name: "asc" },
    fields: (body) => ({
      mc_name: body.mc_name,
    }),
  },
  // Dropdown source for Item.mc_id (Main Category)
  item_main_categories: {
    model: prisma.mainCategory,
    searchableFields: ["mc_name"],
    defaultSort: { mc_name: "asc" },
    fields: (body) => ({
      mc_name: body.mc_name,
    }),
  },
  // Dropdown source for Item.pc_id (Item Sub Category)
  item_sub_categories: {
    model: prisma.productCategory,
    searchableFields: ["pc_name"],
    defaultSort: { pc_name: "asc" },
    fields: (body) => ({
      pc_name: body.pc_name,
    }),
  },
  item_categories: {
    model: prisma.itemCategory,
    include: { mainCategory: true },
    // Real ItemCategory columns only (`name` / `mc_id` are not columns, so a
    // save failed). An account left empty saves as null, not 0 / NaN.
    fields: (body) => ({
      ic_name: body.ic_name,
      sale_acno: optionalAcno(body.sale_acno),
      nogodown_sale_acno: optionalAcno(body.nogodown_sale_acno),
      pos_acno: optionalAcno(body.pos_acno),
      cogs_acno: optionalAcno(body.cogs_acno),
      cogm_acno: optionalAcno(body.cogm_acno),
      // Settings → Features "grn.directRateByItem"; not sent while the feature is off → kept
      ...(typeof body.grn_direct_rate === "boolean" ? { grn_direct_rate: body.grn_direct_rate } : {}),
    }),
  },
  subtrates: {
    model: prisma.subtrates,
    fields: (body) => ({
      subtrate: body.subtrate,
      description: body.description,
    }),
  },
  // Add these to your existing entityModelMap.js

  ink_types: {
    model: prisma.inkType,
    searchableFields: ["ink_type"],
    defaultSort: { ink_type: "asc" },
    fields: (body) => ({
      ink_type: body.ink_type,
      description: body.description,
    }),
  },

  sr_laminations: {
    model: prisma.sRLamination,
    searchableFields: ["sr_lamination"],
    defaultSort: { sr_lamination: "asc" },
    fields: (body) => ({
      sr_lamination: body.sr_lamination,
      description: body.description,
    }),
  },

  color_codes: {
    model: prisma.colorCode,
    searchableFields: ["color_code"],
    defaultSort: { color_code: "asc" },
    fields: (body) => ({
      color_code: body.color_code,
      description: body.description,
    }),
  },

  business_units: {
    model: prisma.businessUnit,
    searchableFields: ["business_unit"],
    defaultSort: { business_unit: "asc" },
    fields: (body) => ({
      business_unit: body.business_unit,
      description: body.description,
    }),
  },

  nature_of_inks: {
    model: prisma.natureOfInk,
    searchableFields: ["nature_of_ink"],
    defaultSort: { nature_of_ink: "asc" },
    fields: (body) => ({
      nature_of_ink: body.nature_of_ink,
      description: body.description,
    }),
  },

  printing_properties: {
    model: prisma.printingProperty,
    searchableFields: ["printing_property"],
    defaultSort: { printing_property: "asc" },
    fields: (body) => ({
      printing_property: body.printing_property,
      description: body.description,
    }),
  },

  items: {
    model: prisma.item,
    id: "itcd",
    searchableFields: ["item", "itcd?", "code"],
    defaultSort: { itcd: "asc" },
    select: { item: true, itcd: true, ic_id: true, code: true, itemCategories: { select: { ic_name: true, id: true } } },
    fields: (body) => ({
      name: body.item,
      itemCategoryId: parseInt(body.ic_id),
    }),
  },
  // Read-only source for FA category dropdowns: ItemCategory scoped by name.
  fixed_asset_categories: {
    model: prisma.itemCategory,
    searchableFields: ["ic_name"],
    defaultSort: { ic_name: "asc" },
    include: { mainCategory: true },
    defaultWhere: {
      mainCategory: { mc_name: { startsWith: "FIXED ASSET", mode: "insensitive" } },
    },
    // A new category joins the FIXED ASSET main category (looked up by name —
    // never a fixed id). Depreciation defaults and posting accounts per
    // category are on Settings → Fixed assets (fa_category_defaults).
    fields: (body) => ({
      ic_name: body.ic_name,
      sale_acno: optionalAcno(body.sale_acno),
      pos_acno: optionalAcno(body.pos_acno),
      cogs_acno: optionalAcno(body.cogs_acno),
      cogm_acno: optionalAcno(body.cogm_acno),
    }),
    beforeCreate: async (data) => {
      const main = await prisma.mainCategory.findFirst({
        where: { mc_name: { startsWith: "FIXED ASSET", mode: "insensitive" } },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (!main) {
        const error = new Error('Add a main category named "FIXED ASSETS" first (Setup → Main Categories).');
        error.statusCode = 422;
        throw error;
      }
      return { ...data, mainCategoryId: main.id };
    },
  },

  // FA item setup: Item model scoped to items under FIXED ASSET categories.
  fixed_asset_items: {
    model: prisma.item,
    searchableFields: ["item", "itcd?", "code"],
    defaultSort: { itcd: "asc" },
    select: {
      item: true,
      itcd: true,
      ic_id: true,
      code: true,
      itemCategories: { select: { ic_name: true, id: true } },
    },
    defaultWhere: {
      itemCategories: {
        mainCategory: { mc_name: { startsWith: "FIXED ASSET", mode: "insensitive" } },
      },
    },
    fields: (body) => ({
      item: body.item,
      ic_id: parseInt(body.ic_id),
      ...(body.code ? { code: String(body.code) } : {}),
    }),
  },
  service_categories: {
    model: prisma.serviceCategory,
    searchableFields: ["sc_name", "id?"],
    include: { services: true },
    fields: (body) => ({
      sc_name: body.sc_name,
      // Default expense account for this category's services (Service Invoice)
      expense_acno: optionalAcno(body.expense_acno),
    }),
  },
  services: {
    model: prisma.service,
    // The Service picker (Service Invoice / Order / Entry lines, Services
    // panel) sends what is typed as ?search= — by name, or by its number.
    searchableFields: ["service_name", "id?"],
    defaultSort: { id: "asc" },
    include: { serviceCategory: true },
    // Switched-off services are left out of GET unless ?includeInactive=true,
    // so every service picker hides them (lib/service/serviceInvoice.js also
    // refuses them on a new invoice line).
    activeField: "is_active",
    fields: (body) => ({
      service_name: body.service_name,
      sc_id: parseInt(body.sc_id),
      company_id: parseInt(body.company_id),
      // Expense account a Service Invoice line of this service is debited to
      expense_acno: optionalAcno(body.expense_acno),
      is_active: body.is_active === undefined || body.is_active === null
        ? true
        : body.is_active === true || body.is_active === "on" || body.is_active === "true",
    }),
  },
  companies: {
    model: prisma.company,
    fields: (body) => ({
      company: body.company,
      addr1: body.addr1,
      addr2: body.addr2,
      city: body.city,
      phone: body.phone,
      fax: body.fax,
      email: body.email,
    }),
  },
  godowns: {
    model: prisma.godown,
    searchableFields: ["id?", "godown"],
    // Closed godowns are left out of GET unless ?includeInactive=true (see
    // app/api/setup/[entity]/route.js) — every entry-form dropdown reads this
    // endpoint, so closing a godown hides it system-wide.
    activeField: "is_active",

    include: { company: true },
    fields: (body) => ({
      godown: body.godown,
      company_id: parseInt(body.company_id),
      // Missing (e.g. a new godown) means open
      is_active: body.is_active === undefined || body.is_active === null
        ? true
        : body.is_active === true || body.is_active === "on" || body.is_active === "true",
    }),
  },
  bond_locations: {
    model: prisma.bondLocation,
    searchableFields: ["location"],
    defaultSort: { location: "asc" },
    include: { company: true },
    fields: (body) => ({
      location: body.location,
      address: body.address || null,
      company_id: parseInt(body.company_id),
    }),
  },
  financial_years: {
    model: prisma.financialYear,
    include: { company: true },
    fields: (body) => ({
      date_from: new Date(body.date_from),
      date_to: new Date(body.date_to),
      status: body.status,
      company_id: parseInt(body.company_id),
    }),
  },

  seasons: {
    model: prisma.season,
    include: { company: true },
    fields: (body) => ({
      date_from: new Date(body.date_from),
      date_to: new Date(body.date_to),
      status: body.status,
      company_id: parseInt(body.company_id),
    }),
  },

  purchase_product_categories: {
    model: prisma.PoPrdCat,
    include: { company: true },
    fields: (body) => ({
      category_name: body.category_name,
      company_id: parseInt(body.company_id),
    }),
  },

  delivery_modes: {
    model: prisma.deliveryMode,
    include: { company: true },
    fields: (body) => ({
      delivery_mode: body.delivery_mode,
      rate_kg: parseFloat(body.rate_kg),
      company_id: parseInt(body.company_id),
    }),
  },

  delivery_terms: {
    model: prisma.deliveryTerm,
    include: { company: true },
    fields: (body) => ({
      delivery_term: body.delivery_term,
      company_id: parseInt(body.company_id),
    }),
  },

  commission_terms: {
    model: prisma.commissionTerm,
    include: { company: true },
    fields: (body) => ({
      commission_term: body.commission_term,
      company_id: parseInt(body.company_id),
    }),
  },

  // Cost Centers
  cost_centers: {
    model: prisma.costCenter,
    searchableFields: ["ccname"],
    defaultSort: { ccname: "asc" },
    include: { company: true },
    id: "ccno", // Use ccno as the identifier
    fields: (body) => ({
      ccname: body.ccname,
      cc_description: body.cc_description,
      company_id: parseInt(body.company_id),
    }),
  },

  // Departments
  departments: {
    model: prisma.department,
    searchableFields: ["dept_name"],
    defaultSort: { dept_name: "asc" },
    include: { company: true },
    fields: (body) => ({
      dept_name: body.dept_name,
      dept_description: body.dept_description,
      company_id: parseInt(body.company_id),
    }),
  },

  // Work Locations
  work_locations: {
    model: prisma.workLocation,
    searchableFields: ["location_name"],
    defaultSort: { location_name: "asc" },
    include: { company: true },
    fields: (body) => ({
      location_name: body.location_name,
      location_description: body.location_description,
      company_id: 1,
    }),
  },

  // Banks
  banks: {
    model: prisma.bank,
    include: { company: true },
    searchableFields: ["bank_name"],
    defaultSort: { bank_name: "asc" },
    fields: (body) => ({
      bank_name: body.bank_name,
      bank_description: body.bank_description,
      company_id: 1,
    }),
  },

  // (Job Titles: no table — job titles are Designations below.)

  designations: {
    model: prisma.designation,
    searchableFields: ["desg_name"],
    defaultSort: { desg_name: "asc" },
    fields: (body) => ({
      desg_name: body.desg_name,
      desg_description: body.desg_description,
      // department_id: parseInt(body.department_id),
      company_id: 1,
    }),
  },

  cities: {
    model: prisma.city,
    searchableFields: ["name"],
    defaultSort: { name: "asc" },
    fields: (body) => ({
      name: body.name,
      // department_id: parseInt(body.department_id),
    }),
  },


  branches: {
    model: prisma.branch,
    searchableFields: ["name"],
    defaultSort: { name: "asc" },
    fields: (body) => ({
      name: body.name,
      // department_id: parseInt(body.department_id),
    }),
  },

  banks: {
    model: prisma.bank,
    searchableFields: ["name"],
    defaultSort: { name: "asc" },
    fields: (body) => ({
      name: body.name,
      company_id: 1,

      // department_id: parseInt(body.department_id),
    }),
  },

  employee_types: {
    model: prisma.employement_type,
    searchableFields: ["name"],
    defaultSort: { name: "asc" },
    fields: (body) => ({
      name: body.name,
    }),
  },

  employee_categories: {
    model: prisma.employement_catagory,
    searchableFields: ["name"],
    defaultSort: { name: "asc" },
    fields: (body) => ({
      name: body.name,
    }),
  },


  bank_branches: {
    model: prisma.bank_branch,
    searchableFields: ["name", "bank_id?"],
    defaultSort: { name: "asc" },
    include: { bank: true },
    fields: (body) => ({
      name: body.name,
      branch_code: body.branch_code,
      bank_id: parseInt(body.bank_id),
    }),
  },


  // Allowances
  allowances: {
    model: prisma.allowance,
    searchableFields: ["allowance"],
    defaultSort: { allowance: "asc" },
    include: { company: true },
    fields: (body) => ({
      allowance: body.allowance,
      allowance_description: body.allowance_description,
      rate: body.rate,
      company_id: 1,
    }),
  },

  // Deductions
  deductions: {
    model: prisma.deduction,
    searchableFields: ["deduction"],
    defaultSort: { deduction: "asc" },
    include: { company: true },
    fields: (body) => ({
      deduction: body.deduction,
      deduction_description: body.deduction_description,
      rate: body.rate,
      company_id: 1,
    }),
  },

  // Leaves
  leaves: {
    model: prisma.leave,
    searchableFields: ["leave"],
    defaultSort: { leave: "asc" },
    include: { company: true },
    fields: (body) => ({
      leave: body.leave,
      leave_description: body.leave_description,
      balance: body.balance ? Number(body.balance) : 0,
      maxCarryForward: body.maxCarryForward ? Number(body.maxCarryForward) : 15,
      company_id: 1,
    }),
  },

  managers: {
    model: prisma.manager,
    include: {
      department: true,
      company: true,
      employee: true,
    },
    searchableFields: ["manager"],
    defaultSort: { manager: "asc" },
    fields: async (body) => {
      const employee = await prisma.employee.findUnique({
        where: { id: parseInt(body.employeeId) },
        select: {
          firstName: true,
          middleName: true,
          surname: true,
        },
      });

      // Full name
      const fullName = `${employee.firstName} ${employee.middleName ? employee.middleName + " " : ""
        }${employee.surname}`.trim();

      return {
        manager: fullName, // auto manager name with full name
        department_id: parseInt(body.department_id),
        employeeId: parseInt(body.employeeId),
        company_id: 1,
      };
    },
  },

  employees: {
    model: prisma.employee,
    include: {
      company: true,
      //   // jobTitle: true,
      department: true,
      workLocation: true,
      manager: true,
      branch: true,
      city: true,
      bankBranch: { include: { bank: true } },
      bank: true,
      Designation: true,
      employeetype: true,
      employeecat: true,
      bank: true,
      costCenter: true,
      allowances: true,
      deductions: true,
    },
    searchableFields: ["firstName", "surname"],
    defaultSort: { firstName: "asc" },
    fields: (body) => ({
      firstName: body.firstName,
      middleName: body.middleName || null,
      surname: body.surname,
      dob: body.dob ? new Date(body.dob) : null,
      gender: body.gender,
      phoneNumber: body.phoneNumber,
      emailAddress: body.emailAddress,
      status: body.status || "ACTIVE",
      hireDate: body.hireDate ? new Date(body.hireDate) : null,
      // jobTitleId: body.jobTitleId ? parseInt(body.jobTitleId) : null,
      departmentId: body.departmentId ? parseInt(body.departmentId) : null,
      designationId: body.designationId ? parseInt(body.designationId) : null,
      employeeTypeId: body.employeetypeId
        ? parseInt(body.employeetypeId)
        : null,
      employeeCategoryId: body.employeecatId
        ? parseInt(body.employeecatId)
        : null,
      workLocationId: body.workLocationId
        ? parseInt(body.workLocationId)
        : null,
      costCenterId: body.costCenterId ? parseInt(body.costCenterId) : null,

      managerId: body.managerId ? parseInt(body.managerId) : null,
      company_id: 1,
      paymentMethod: body.paymentMethod,
      bankId: body.bankId ? parseInt(body.bankId) : null,
      bankBranchId: body.bankBranchId ? parseInt(body.bankBranchId) : null,
      accountName: body.accountName || null,
      accountNumber: body.accountNumber || null,
      payType: body.payType,
      rate: body.rate ? parseFloat(body.rate) : null,
      payFrequency: body.payFrequency,
    }),
  },

  vendors: {
    model: prisma.aCNO,
    searchableFields: ["acname", "acno?", "city", "email", "category"],
    defaultSort: { acno: "asc" },
    // Vendors = the "vendors" account group (Finance → Account Settings).
    defaultWhere: async () => ({ macno: { in: await getVendorMacnos() } }),
    id: "acno",

    fields: (body) => ({
      // ACNO's own columns (the old mapping named columns that do not exist).
      acno: body.acno,
      acname: body.acname,
      address: body.address,
      area: body.area,
      city: body.city,
      phoneFax: body.phoneFax,
      email: body.email,
      category: body.category,
      ntnNo: body.ntnNo || null,
    }),
  },

  lc: {
    model: prisma.aCNO,
    searchableFields: ["acname", "acno?"],
    defaultSort: { acno: "desc" },
    // LC accounts = the "lc_accounts" account group (Finance → Account Settings).
    defaultWhere: async () => ({ macno: { in: await getAccountGroup("lc_accounts") } }),
    id: "acno",

    fields: (body) => ({
      acname: body.acname,
      macno: Number(body.macno)


    }),
    // The main account picked on the form must be one of the LC groups, or
    // the account would drop out of this list — on create and on edit.
    beforeCreate: (data) => requireLcMacno(data),
    beforeUpdate: (data) => requireLcMacno(data),
  },

  beneficiary: {
  model: prisma.aCNO,
  searchableFields: ["acname", "acno"],
  defaultSort: { acno: "desc" },
  // Beneficiaries = the "beneficiaries" account group (Finance → Account
  // Settings); new ones are created under its first main account.
  defaultWhere: async () => ({ macno: { in: await getAccountGroup("beneficiaries") } }),
  id: "acno",
  fields: (body) => ({
    acname: body.acname,
  }),
  beforeCreate: async (data) => {
    const [macno] = await getAccountGroup("beneficiaries");
    if (macno == null) throw accountSettingError("beneficiaries");
    return { ...data, macno };
  },
},

  quality_parameters: {
    model: prisma.quality_parameters,
    id: "parameter_name",
    searchableFields: ["parameter_name"],
    defaultSort: { parameter_name: "asc" },
    fields: (body) => ({
      parameter_name: body.parameter_name,
    }),
  },

  menus: {
    model: prisma.menus, // assuming your Prisma model is named `menus`
    searchableFields: ["title", "url", "icon", "parent_id"],
    defaultSort: { id: "asc" },
    id: "id",

    fields: (body) => ({
      title: body.title,
      url: body.url,
      icon: body.icon,
      parent_id: body.parent_id ? Number(body.parent_id) : null,
      order_no: body.order_no ? Number(body.order_no) : 0,
      is_active: body.is_active === "on" || body.is_active === true,
    }),
  },

  employee_menus: {
    model: prisma.employee_menu,
    searchableFields: ["employee_id", "menu_id"],
    defaultSort: { id: "asc" },
    include: { employee: true, menu: true },
    id: "id",

    fields: (body) => ({
      employee_id: parseInt(body.employee_id),
      menu_id: parseInt(body.menu_id),
    }),
  },

  tax_setups: {
    model: prisma.taxSetup,
    searchableFields: ["tax_name"],
    defaultSort: { tax_name: "asc" },
    fields: (body) => ({
      tax_name: body.tax_name,
    }),

  },

  tax_laws: {
    model: prisma.taxLaws,
    searchableFields: ["tax_code"],
    defaultSort: { tax_code: "asc" },
    include: { taxSetup: true, taxAcno: { select: { acno: true, acname: true } } },
    fields: (body) => ({
      tax_code: Number(body.tax_code),
      section_description: body.section_description,
      rate_filer: parseFloat(body.rate_filer),
      rate_non_filer: parseFloat(body.rate_non_filer),
      // payable account of the withholding (tax.lineWht) — empty = none
      ...(body.tax_acno !== undefined ? { tax_acno: optionalAcno(body.tax_acno) } : {}),
    }),
  }


};

export default entityModelMap;
