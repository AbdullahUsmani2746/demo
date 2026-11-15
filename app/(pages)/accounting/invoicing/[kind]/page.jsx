// /accounting/invoicing/[kind] — Sale, Sale Return, Purchase and Purchase
// Return Invoicing. One shared screen: components/Invoicing/InvoicingPage.jsx.
import { notFound } from "next/navigation";
import InvoicingPage from "@/components/Invoicing/InvoicingPage";
import { INVOICING_KINDS } from "@/components/Invoicing/kinds";

export async function generateMetadata({ params }) {
  const { kind } = await params;
  return { title: INVOICING_KINDS[kind]?.title || "Invoicing" };
}

export default async function Page({ params }) {
  const { kind } = await params;
  if (!INVOICING_KINDS[kind]) notFound();
  return <InvoicingPage kind={kind} />;
}
