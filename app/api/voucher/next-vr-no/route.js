import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getCashBankMacnos } from '@/lib/accounts/partyMacnos'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const tran_code = searchParams.get('tran_code')

  if (!tran_code || isNaN(tran_code)) {
    return NextResponse.json({ message: 'Invalid tran_code' }, { status: 400 })
  }

  const tranCodeNum = parseInt(tran_code)

  let whereClause = { tran_code: tranCodeNum }

  // Receipts and Payments run one voucher series each, across every cash and
  // bank group. They used to run separate cash/bank series off a paymentType
  // query param, back when the vouchers themselves were split.
  if (tranCodeNum === 1 || tranCodeNum === 2) {
    whereClause.acno = { macno: { in: await getCashBankMacnos() } }
  }

  const lastVoucher = await prisma.transactionsMaster.findFirst({
    where: whereClause,
    orderBy: { vr_no: 'desc' },
  })

  const nextVrNo = lastVoucher ? lastVoucher.vr_no + 1 : 1

  return NextResponse.json({ nextVrNo })
}
