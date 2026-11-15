// Dispatch Invoicing moved to Sale Invoicing (/accounting/invoicing/sale),
// one of the four Invoicing screens (components/Invoicing/InvoicingPage.jsx).
// Kept as a redirect for bookmarks and notification links.
import { redirect } from "next/navigation";

export default function DispatchInvoicingRedirect() {
  redirect("/accounting/invoicing/sale");
}
