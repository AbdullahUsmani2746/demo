import ReceiptsList from "@/components/POS/ReceiptsList";

export const metadata = { title: "Receipt · Point of Sale" };

// /pos/orders/<tran_id> — the receipts list with that receipt open.
export default async function ReceiptPage({ params }) {
  const { id } = await params;
  return <ReceiptsList openId={Number(id) || null} />;
}
