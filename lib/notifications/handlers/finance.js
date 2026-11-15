// Handles notifications for finance records (tax challans).
import { NOTIFICATION_TYPES, NOTIFICATION_EXPIRY } from "../config";
import { emit } from "../emit";

async function customerName(prisma, acno) {
  if (!acno) return "Unknown Customer";
  const customer = await prisma.aCNO.findUnique({ where: { acno }, select: { acname: true } });
  return customer?.acname || `Customer #${acno}`;
}

/** TaxChallan created. Tax is critical — kept for 30 days. */
export async function taxChallanCreated(data, prisma) {
  try {
    const customer = await customerName(prisma, data.customer_acno);
    const taxAmount = data.tax_amount?.toLocaleString() || "0";
    const netAmount = data.net_amount?.toLocaleString() || "0";

    await emit(prisma, "taxChallanCreated", {
      title: "New Tax Challan",
      message: `Tax Challan created for ${customer} - Invoice: ${data.invoice_no} - Tax: ${taxAmount}, Net: ${netAmount}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "tax_challan",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.CRITICAL,
    });
  } catch (error) {
    console.error("Error creating tax challan notification:", error);
  }
}

/** TaxChallan updated — paid / cancelled get their own wording. */
export async function taxChallanUpdated(data, prisma) {
  try {
    const customer = await customerName(prisma, data.customer_acno);
    let type = NOTIFICATION_TYPES.INFO;
    let title = "Tax Challan Updated";
    let message = `Tax Challan for ${customer} (Invoice: ${data.invoice_no}) updated`;

    if (data.status === "paid") {
      type = NOTIFICATION_TYPES.SUCCESS;
      title = "Tax Challan Paid";
      message = `✅ Tax Challan PAID for ${customer} (Invoice: ${data.invoice_no})${data.challan_no ? ` - Challan: ${data.challan_no}` : ""}`;
    } else if (data.status === "cancelled") {
      type = NOTIFICATION_TYPES.WARNING;
      title = "Tax Challan Cancelled";
      message = `❌ Tax Challan CANCELLED for ${customer} (Invoice: ${data.invoice_no})`;
    }

    await emit(prisma, "taxChallanUpdated", {
      title,
      message,
      type,
      entity: "tax_challan",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.CRITICAL,
    });
  } catch (error) {
    console.error("Error creating tax challan update notification:", error);
  }
}
