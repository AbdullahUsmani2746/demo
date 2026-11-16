import { redirect } from "next/navigation";

// Payment is taken on the till itself (Sell → Pay).
export default function CheckoutPage() {
  redirect("/pos/cart");
}
