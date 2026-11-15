import { syncFromWooCommerce } from '@/services/wooCommerceSync';
import { NextResponse } from 'next/server';
import { guard } from "@/lib/auth/route";

export const POST = guard("pos.manage", async (req) => {
  await syncFromWooCommerce();
  return NextResponse.json({ message: 'Sync completed' });
});