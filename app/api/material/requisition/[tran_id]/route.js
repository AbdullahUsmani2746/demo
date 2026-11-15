import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setAuditActor } from '@/lib/audit/context';
import { guard } from "@/lib/auth/route";
import { recordScopeError } from "@/lib/auth/documentScope";

// ==================== GET requisition by tran_no ====================
export async function GET(request, { params }) {
  try {
    const tranNo = params.tran_id;
  

    const requisition = await prisma.reqMaster.findUnique({
      where: { 
        tran_id: parseInt(tranNo),
        

       },
      include: {
        details: {
          include:{
            item:true
          }
        }, // fetch requisition lines
        godown2Details:true,
        godownDetails:true
      },
    });

    if (!requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    }

    // Data scope (Admin → Permissions): another godown's requisition is not shown.
    const scopeError = await recordScopeError(
      await getServerSession(authOptions), "godown", [requisition.issued_for, requisition.issued_by],
    );
    if (scopeError) {
      return NextResponse.json({ error: scopeError }, { status: 403 });
    }

    // Collect all unique so_no values from master and details
    const soNos = new Set();
    if (requisition.so_no) soNos.add(requisition.so_no);
    for (const d of requisition.details) {
      if (d.so_no) soNos.add(d.so_no);
    }

    // Fetch customer name AND sale_po from OrderMaster for each so_no
    const soCustomerMap = {};
    const soCustomerCodeMap = {};
    const soSalePOMap = {};
    if (soNos.size > 0) {
      const orders = await prisma.orderMaster.findMany({
        where: { order_no: { in: Array.from(soNos) } },
        include: { acno: true }, // ACNO relation gives acname
      });
      for (const order of orders) {
        soCustomerMap[order.order_no] = order.acno?.acname || '';
        soCustomerCodeMap[order.order_no] = order.acno?.acno ?? order.party_code ?? '';
        soSalePOMap[order.order_no] = order.sale_po || '';
      }
    }

    // Attach acname, acno, and sale_po to each detail row
    const detailsWithCustomer = requisition.details.map((d) => {
      const rowSoNo = d.so_no;
      let rowAcname = '';
      let rowAcno = '';
      let rowSalePo = '';

      if (rowSoNo && rowSoNo in soCustomerMap) {
        rowAcname = soCustomerMap[rowSoNo] || '';
        rowAcno = soCustomerCodeMap[rowSoNo] || '';
        rowSalePo = soSalePOMap[rowSoNo] || '';
      } else if (requisition.so_no && requisition.so_no in soCustomerMap) {
        rowAcname = soCustomerMap[requisition.so_no] || '';
        rowAcno = soCustomerCodeMap[requisition.so_no] || '';
        rowSalePo = soSalePOMap[requisition.so_no] || '';
      }

      return {
        ...d,
        acname: rowAcname,
        acno: rowAcno,
        sale_po: rowSalePo,
      };
    });

    // Also attach master-level info from master so_no
    const masterAcname = requisition.so_no ? (soCustomerMap[requisition.so_no] || '') : '';
    const masterAcno = requisition.so_no ? (soCustomerCodeMap[requisition.so_no] || '') : '';
    const masterSalePo = requisition.so_no ? (soSalePOMap[requisition.so_no] || '') : '';

    const result = {
      ...requisition,
      acname: masterAcname,
      acno: masterAcno,
      sale_po: masterSalePo,
      details: detailsWithCustomer,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('GET requisition error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ==================== PUT requisition (update remarks/status) ====================
export const PUT = guard("requisition.update", async (request, { params }) => {
  try {
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const { status } = await request.json();

    const requisition = await prisma.reqMaster.update({
      where: { tran_no: parseInt(params.tran_no) },
      data: { rmk: status, sync_status: 'pending' }, // mimic your order fields
      include: { details: true },
    });

    // You could later sync requisition to external system if needed
    // await syncRequisitionToERP(requisition);

    return NextResponse.json(requisition);
  } catch (error) {
    console.error('PUT requisition error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
