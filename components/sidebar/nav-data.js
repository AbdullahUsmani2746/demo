import {
  Settings2,
  SquareTerminal,
  LayoutDashboard,
  Users,
  Clipboard,
  BriefcaseBusiness,
  BriefcaseConveyorBelt,
  DollarSign as DollarSignIcon,
  LucideUmbrella,
  CircleHelp,
  Contact,
  Send,
  Locate,
  Building,
  PieChart,
  UserCheck2 as UserCheck2Icon,
  MinusCircle as MinusCircleIcon,
} from "lucide-react"

// Single source of truth for the sidebar navigation tree. Both
// app-sidebar.jsx (renders the sidebar) and search-form.jsx (flattens this
// for the command palette) import from here so the two never drift apart.
export const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Accounts",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Add Account",
          url: "/accounting/add-account",
        },
        {
          title: "Show Account",
          url: "/accounting/show-account",
        },
      ],
    },
    {
      title: "Vouchers",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Payment Voucher",
          url: "/accounting/voucher/payment",
        },
        {
          title: "Receipt Voucher",
          url: "/accounting/voucher/receipt",
        },
        {
          title: "Journal Voucher",
          url: "/accounting/voucher/journal",
        },
        {
          title: "Letter Of Credit",
          url: "/accounting/voucher/letterOfCredit",
        },
        {
          title: "In-Bond Entry",
          url: "/accounting/voucher/inBond",
        },

      ],
    },
    {
      title: "Subsidary Details",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Customers",
          url: "/accounting/forms/customer",
        },
        {
          title: "Sales Targets",
          url: "/accounting/forms/salesTargets",
        },

    {
      title: "LAB",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "BOM",
          url: "/accounting/material?tab=bom",
        },

        {
          title: "Recipe",
          url: "/accounting/material?tab=recipe",
        },

         {
          title: "Machine",
          url: "/accounting/material?tab=machine",
        },

        {
          title: "Process Order",
          url: "/accounting/material?tab=production",
        },

        {
          title: "Production Plan",
          url: "/accounting/material?tab=production-plan",
        },

        {
          title: "Grand Master BOM",
          url: "/accounting/material?tab=grand-master-bom",
        },

        {
          title: "Material Usage BOM",
          url: "/accounting/material?tab=material-usage-bom",
        },
      ],
    },
      ],
    },
    {
      title: "Invoices",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Purchase Invoice",
          url: "/accounting/invoice/purchase",
        },
        {
          title: "Sale Invoice",
          url: "/accounting/invoice/sale",
        },
        {
          title: "Good Receipt Note",
          url: "/accounting/report/grn",
        },
        {
          title: "Dispatch Note",
          url: "/accounting/report/dispatch",
        },
        {
          title: "Dispatch Invoicing",
          url: "/accounting/dispatch-invoicing",
        },

      ],
    },
    {
      title: "Orders",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Purchase Order",
          url: "/accounting/order/purchaseOrder",
        },
        {
          title: "Sale Order",
          url: "/accounting/order/saleOrder",
        },
        {
          title: "Service Order",
          url: "/accounting/order/serviceOrder",
        },
      ],
    },

    {
      title: "Returns",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Purchase Reuturn",
          url: "/accounting/return/purchaseReturn",
        },
        {
          title: "Sale Reuturn",
          url: "/accounting/return/saleReturn",
        },

      ],
    },
{
      title: "Transfer",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Godown Transfer",
          url: "/accounting/godown/transfer",
        },
        {
          title: "Material Rquisition",
          url: "/accounting/material/requisition",
        },
        {
          title: "FG Transfer Acceptance",
          url: "/accounting/fg-transfer",
        },
        {
          title: "Service Invoice",
          url: "/accounting/report/serviceInvoice",
        },
        {
          title: "Service Entry",
          url: "/accounting/report/serviceEntry",
        }
      ],
    },

    {
      title: "Produciton",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Material Transactions",
          url: "/accounting/materialTransactions",
        },
        // {
        //   title: "Material Input",
        //   url: "/accounting/production/materialInput",
        // },
      ],
    },
    {
      title: "Printing",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Sticker Printing",
          url: "/accounting/stickerPrinting",
        },
        {
          title: "Tag Printing",
          url: "/accounting/tagPrinting",
        },
      ],
    },
    {
      title: "POS",
      url: "/pos",
      icon: SquareTerminal,
      isActive: true,

    },
    {
      title: "Reports",
      url: "/accounting/reports",
      icon: SquareTerminal,
      isActive: true,

    },

    {
      title: "Setups",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Item Setup",
          url: "/accounting/forms/items",
        },
        {
          title: "Vendor Setup",
          url: "/accounting/setup/vendors",
        },
        {
          title: "Company Setup",
          url: "/accounting/setup/companies",
        },
        {
          title: "Cost Center Setup",
          url: "/accounting/setup/cost_centers",
        },
        {
          title: "Department Setup",
          url: "/accounting/setup/departments",
        },
        {
          title: "Godown Setup",
          url: "/accounting/setup/godowns",
        },
        {
          title: "Bond Location Setup",
          url: "/accounting/setup/bond_locations",
        },
        {
          title: "Season Setup",
          url: "/accounting/setup/seasons",
        },
        {
          title: "Financial Year Setup",
          url: "/accounting/setup/financial_years",
        },
        {
          title: "Product Category Setup",
          url: "/accounting/setup/purchase_product_categories",
        },
        {
          title: "Delivery Mode Setup",
          url: "/accounting/setup/delivery_modes",
        },
        {
          title: "Delivery Terms Setup",
          url: "/accounting/setup/delivery_terms",
        },
        {
          title: "Commission Term Setup",
          url: "/accounting/setup/commission_terms",
        },
        {
          title: "Employee Setup",
          url: "/accounting/setup/employees",
        },
        {
          title: "Service Setup",
          url: "/accounting/setup/services",
        },
        {
          title: "Service Category Setup",
          url: "/accounting/setup/service_categories",
        },
      ],
    },
    {
      title: "Settings",
      url: "/accounting/settings",
      icon: Settings2,
    },
  ],
  navAdmin: [
    {
      title: "Users",
      url: "/admin/user",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Roles",
          url: "/admin/roles",
        },
        {
          title: "Shift",
          url: "/admin/shift",
        },
        {
          title: "Permissions",
          url: "/admin/permissions",
        },
        {
          title: "Notifications",
          url: "/admin/notifications",
        },
      ],
    },

     {
      title: "Menu",
      url: "/accounting/setup/menus",
      icon: SquareTerminal,
      isActive: true,
      items: [
        {
          title: "Employee Menu",
          url: "/accounting/employee-menus",
        },

      ],
    },

  ],
   navEmployee: [
    {
      title: "Dashboard",
      url: "/client/dashboard",
      icon: LayoutDashboard,
      isActive: true,
    },
    {
      title: "Employee",
      url: "/accounting/setup/employees",
      icon: Users,
      isActive: true,
    },
    {
      title: "Time Entry",
      url: "/client/attendance",
      icon: Clipboard,
      isActive: true,
    },
     {
      title: "Employee Requests",
      url: "/client/request",
      icon: BriefcaseBusiness,
      isActive: true,
    },
    {
      title: "Time Approvals",
      url: "/client/approvals",
      icon: BriefcaseBusiness,
      isActive: true,
    },
    {
      title: "Leave Approvals",
      url: "/client/requestApproval",
      icon: BriefcaseBusiness,
      isActive: true,
    },
    {
      title: "Run Payroll",
      url: "/client/payroll/employeePayroll",
      icon: LucideUmbrella,
      isActive: true,
    },
    {
      title: "Reports",
      url: "/client/reports",
      icon: PieChart,
      isActive: true,
    },
    {
      title: "Help Desk",
      url: "/client/helpdesk",
      icon: CircleHelp,
      isActive: true,
    },
    {
      title: "Payroll Operations",
      url: "#",
      icon: Users,
      isActive: false,
      items: [
        {
          title: "Work Location",
          url: "/accounting/setup/work_locations",
          icon: Locate,
          isActive: true,
        },
        {
          title: "Department",
          url: "/accounting/setup/departments",
          icon: Building,
          isActive: true,
        },
        {
          title: "Cost Center",
          url: "/accounting/setup/cost_centers",
          icon: PieChart,
          isActive: true,
        },
        {
          title: "Bank",
          url: "/accounting/setup/banks",
          icon: UserCheck2Icon,
          isActive: true,
        },

        {
          title: "Manager",
          url: "/accounting/setup/managers",
          icon: BriefcaseConveyorBelt,
          isActive: true,
        },
        {
          title: "Job Title",
          url: "/accounting/setup/job_titles",
          icon: BriefcaseBusiness,
          isActive: true,
        },
        {
          title: "Allowances",
          url: "/accounting/setup/allowances",
          icon: DollarSignIcon,
          isActive: true,
        },
        {
          title: "Deductions",
          url: "/accounting/setup/deductions",
          icon: MinusCircleIcon,
          isActive: true,
        },
        {
          title: "Leaves",
          url: "/accounting/setup/leaves",
          icon: LucideUmbrella,
          isActive: true,
        },

        {
          title: "Payroll Cycle",
          url: "/client/payrollProcess",
        },
      ],
    },

    {
      title: "Settings",
      url: "/client/setting",
      icon: Settings2,
      isActive: true,
      onClick: true,
    },
  ],
  navUserEmployee: [
    {
      title: "Dashboard",
      url: "/employee/dashboard",
      icon: LayoutDashboard,
      isActive: true,
    },
    {
      title: "Profile",
      url: "/employee/profile",
      icon: Contact,
      isActive: true,
    },
    {
      title: "Attendances",
      url: "/employee/attendances",
      icon: Clipboard,
      isActive: true,
    },
    {
      title: "Request",
      url: "/employee/request",
      icon: Send,
      isActive: true,
    },

    {
      title: "Payslip",
      url: "/employee/payslips",
      icon: DollarSignIcon,
      isActive: true,
    },
    {
      title: "Help Desk",
      url: "/employee/helpdesk",
      icon: CircleHelp,
      isActive: true,
    },
    {
      title: "Settings",
      url: "/employee/setting",
      icon: Settings2,
      isActive: true,
      onClick: true,
    },
  ],
}
