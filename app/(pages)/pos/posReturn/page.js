import { Suspense } from "react";
import RefundScreen from "@/components/POS/RefundScreen";

export const metadata = { title: "Refund · Point of Sale" };

export default function RefundPage() {
  return (
    <Suspense fallback={null}>
      <RefundScreen />
    </Suspense>
  );
}
