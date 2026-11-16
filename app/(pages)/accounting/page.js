import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// /accounting: the business dashboard for roles that see the whole menu;
// everyone else their Applications launcher (their own screens) — the
// dashboard is a MANAGEMENT screen they may not hold.
export default async function Page() {
  const session = await getServerSession(authOptions)
  redirect(session?.user?.navMode === 'all' ? '/accounting/dashboard' : '/accounting/apps')
}
