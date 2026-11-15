// ============================================
// NOTIFICATION CONFIGURATION
// ============================================
// Maps database models (as named in schema.prisma) to handler names in
// dispatcher.js. Add a model here to start raising notifications for it.

export const notificationEvents = {
  // ==================== VOUCHERS & TRANSACTIONS ====================
  TransactionsMaster: {
    create: "transactionCreated",
    update: "transactionUpdated",
  },

  // ==================== ORDERS ====================
  OrderMaster: {
    create: "orderCreated",
    update: "orderUpdated",
  },

  // ==================== SALE RETURN REMARKS ====================
  SaleReturnRemark: {
    create: "saleReturnRemarkSaved",
    update: "saleReturnRemarkSaved",
  },

  // ==================== PRODUCTION ====================
  productionPlanMaster: {
    create: "productionCreated",
    update: "productionUpdated",
  },

  QualityMaster: {
    create: "qualityCheckCreated",
    update: "qualityCheckUpdated",
  },

  // ==================== INVENTORY ====================
  Item: {
    create: "itemCreated",
    update: "itemUpdated",
  },

  ReqMaster: {
    create: "requisitionCreated",
    update: "requisitionUpdated",
  },

  // ==================== ACCOUNTS & FINANCE ====================
  TaxChallan: {
    create: "taxChallanCreated",
    update: "taxChallanUpdated",
  },

  // ==================== USER MANAGEMENT ====================
  User: {
    create: "userCreated",
    update: "userUpdated",
  },

  Employee: {
    create: "employeeCreated",
    update: "employeeUpdated",
  },
};

// ==================== TRANSACTION CODES MAPPING ====================
// Maps transaction codes to readable names
export const TRANSACTION_TYPES = {
  1: "Bank Receipt",
  2: "Bank Payment",
  3: "Journal Voucher",
  4: "Purchase/GRN",
  6: "Sale/Dispatch",
  7: "Material Issue",
  8: "Material Input",
  9: "Purchase Return",
  10: "Sale Return",
  11: "Transfer",
  20: "Credit Note / Service Entry",
  21: "Service Invoice",
  400: "Purchase Order",
  500: "Service Order",
  600: "Sale Order",
  1000: "Requisition",
};

// ==================== RECIPIENTS ====================
// Who receives which event is no longer hard-coded here. It lives in the
// NotificationEvent / NotificationRule tables, seeded from
// lib/notifications/catalog.js and managed from Settings → Notifications.

// ==================== NOTIFICATION TYPES ====================
export const NOTIFICATION_TYPES = {
  SUCCESS: "success",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
};

// ==================== NOTIFICATION EXPIRY ====================
// Define how long notifications should remain visible (in days)
export const NOTIFICATION_EXPIRY = {
  DEFAULT: 7, // 7 days
  URGENT: 3, // 3 days
  CRITICAL: 30, // 30 days
};