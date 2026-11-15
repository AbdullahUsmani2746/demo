"use client";
import React, { useState } from "react";
import { useCompany } from "@/context/CompanyContext";

import { generateVoucherPDF } from "@/components/Template/Payment";
import { generateUnifiedPDF } from "@/components/Template/UnifiedReport";
import { generateOrderBalancePDF } from "@/components/Template/OrderBalance";
import { generateSalesBalancePDF } from "@/components/Template/SalesBalance";
import { generateCustomerAgingPDF } from "@/components/Template/CustomerAging";
import { generateSalesTaxPDF, generateSaleTaxPDF } from "@/components/Template/SaleTax";
import { generateRequisitionNotePDF } from "@/components/Template/RequistNote";
import { generatePurchaseOrderPDF } from "@/components/Template/PurchaseOrderNew";
import { generateDispatchNotePDF } from "@/components/Template/Dispatch";
import { generateGRNPDF } from "@/components/Template/Grn";
import { generateLocalPurchaseOrderPDF } from "@/components/Template/LocalPo";
import { generateBOMPDF, generateBomPDF } from "@/components/Template/Bom";
import { generateProcessOrderPDF } from "@/components/Template/ProcessOrder";
import { generateGatePassPDF } from "@/components/Template/GatePass";
import { generateDeliveryNotePDF } from "@/components/Template/DeliveryNote";
import { generateCommercialInvoicePDF } from "@/components/Template/CommercialInvoice";
import { generateOffGatePassPDF } from "@/components/Template/OffGatePass";
import { generateOffCommercialInvoicePDF } from "@/components/Template/OffCommercialInvoice";
import { generateOffDeliveryNotePDF } from "@/components/Template/OffDeliveryNote";
import { generateSalesTaxInvoicePDF } from "@/components/Template/SalesTaxInvoice";


const PDF = () => {
  const [isDownloading, setIsDownloading] = useState(false);
  const { company, shortName } = useCompany();

  const voucher = {
    documentType: 'commission', // or 'delivery' or 'sales'
    dated: new Date(),
    vr_no: '12345',
    customer: {
      name: 'SAMPLE CUSTOMER',
      strn: '12345',
      ntn: '67890',
      address: 'Customer Address'
    },
    invoice: {
      number: '13',
      date: '02-07-2024',
      po: 'PO-12345'
    },
    entries: [
      ['1', '0565D DILUENT', '4365', '225', 'KG', '754.02', '169,655'],
      ['2', '5639NT P-CYAN', '', '24', 'KG', '754.02', '18,096'],
      ['3', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['4', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['5', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['1', '0565D DILUENT', '4365', '225', 'KG', '754.02', '169,655'],
      ['2', '5639NT P-CYAN', '', '24', 'KG', '754.02', '18,096'],
      ['3', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['4', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['5', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['6', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['7', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['8', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['9', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850'],
      ['10', '5011GXF ROYAL BLUE', '3900', '25', 'KG', '754.02', '18,850']
      // ... more entries
    ],
    // entries: [
    //     ["1", "0565D DILUENT", "4365", "25 X 9 = 225"],
    //     ["2", "5639NT P-CYAN", "", "24 X 1 = 24"],
    //     ["3", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["4", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["5", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["6", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["7", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["8", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["9", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["10", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["5", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["6", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["7", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["8", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],  
    //     ["9", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"],
    //     ["10", "5011GXF ROYAL BLUE", "3900", "25 X 1 = 25 KG"]


    //   ],

    totals: {
      amount: '243,930',
      tax: { value: '43,907', percentage: '18' },
      grandTotal: { value: '287,837', weight: '274' }
    }
  };


  const handleDownload1 = () => {
    const doc = generateVoucherPDF();
    doc.save("payment-voucher.pdf");
  };



  const handleDownload5 = () => {
    const doc = generateUnifiedPDF(voucher, company)
    doc.save("delivery-invoice.pdf");
  };
  const handleDownload7 = () => {
    const doc = generateOrderBalancePDF(company)
    doc.save("order-balance.pdf");
  };
  const handleDownload8 = async () => {
    setIsDownloading(true);
    try {
      const doc = await generateSalesBalancePDF();

      doc.save("salesOrder-balance.pdf");
    } finally {
      setIsDownloading(false);
    }
  };
  const handleDownload9 = () => {
    const doc = generateCustomerAgingPDF(company)
    doc.save("customer-aging.pdf");
  };

  const handleDownload10 = () => {
    const doc = generateSalesTaxPDF()
    doc.save("sale-tax.pdf");
  };

  const handleDownload11 = () => {
    const doc = generateRequisitionNotePDF()
    doc.save("Requisition-Note.pdf");
  };

  const handleDownload12 = () => {
    const doc = generatePurchaseOrderPDF()
    doc.save("purchase-order.pdf");
  };

  const handleDownload13 = () => {
    const doc = generateBOMPDF()
    doc.save("Bom_report.pdf");
  };

  const handleDownload14 = () => {
    const doc = generateProcessOrderPDF()
    doc.save("Process_Order.pdf");
  };

  const handleDownload15 = () => {
    const doc = generateLocalPurchaseOrderPDF(company)
    doc.save("Scan_PO.pdf");
  };
  
  const handleOffGatePass = () => {
    const doc = generateOffGatePassPDF();
    doc.save(`${shortName}_Off_Gate_Pass.pdf`);
  };

  const handleOffCommercialInvoice = () => {
    const doc = generateOffCommercialInvoicePDF();
    doc.save(`${shortName}_Off_Commercial_Invoice.pdf`);
  };

  const handleOffDeliveryNote = () => {
    const doc = generateOffDeliveryNotePDF();
    doc.save(`${shortName}_Off_Delivery_Note.pdf`);
  };

  const handleOffSalesTaxInvoice = async () => {
    const doc = await generateSalesTaxInvoicePDF();
    doc.save(`${shortName}_Sales_Tax_Invoice.pdf`);
  };

  const handleDownloadGatePass = async () => {
    setIsDownloading(true);
    try {
      const doc = await generateGatePassPDF(1); // Using dummy ID for test
      doc.save("gatepass.pdf");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadDeliveryNote = async () => {
    setIsDownloading(true);
    try {
      const doc = await generateDeliveryNotePDF(1);
      doc.save("delivery-note.pdf");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadInvoice = async () => {
    setIsDownloading(true);
    try {
      const doc = await generateCommercialInvoicePDF(1);
      doc.save("commercial-invoice.pdf");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="p-4">

      

      <div className="mb-6 p-4 border border-blue-300 rounded bg-blue-50">
        <h2 className="text-lg font-bold mb-3 text-blue-900">New Templates</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleOffGatePass}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium shadow"
          >
            Off Gate Pass
          </button>
          <button
            onClick={handleOffCommercialInvoice}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium shadow"
          >
            Off Commercial Invoice
          </button>
          <button
            onClick={handleOffDeliveryNote}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium shadow"
          >
            Off Delivery Note
          </button>
          <button
            onClick={handleOffSalesTaxInvoice}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium shadow"
          >
            Sales Tax Invoice
          </button>
        </div>
      </div>

      <button
        onClick={handleDownload1}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        voucher 2
      </button>

      <div className="p-4">


        <button
          onClick={handleDownload5}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          invoice 3
        </button>
      </div>
      <div className="p-4">
        <button
          onClick={handleDownload7}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          sales order balance
        </button>
        <button
          onClick={handleDownload8}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          sales balance
        </button>
        <button
          onClick={handleDownload9}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          customer aging
        </button>
        <button
          onClick={handleDownload10}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          sale tax
        </button>
        <button
          onClick={handleDownload11}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Requisition Note
        </button>

        <br /><br />

        <button
          onClick={handleDownload12}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Purchase order
        </button>
        <br /> <br />

        <button
          onClick={handleDownload15}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Local Purchase order
        </button>
        <br /> <br />
        <button
          onClick={handleDownload13}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Bom
        </button>
        <button
          onClick={handleDownload14}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Process Order
        </button>
        <button
          onClick={handleDownloadGatePass}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 ml-2"
          disabled={isDownloading}
        >
          {isDownloading ? "Generating..." : "Gate Pass"}
        </button>
        <button
          onClick={handleDownloadDeliveryNote}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 ml-2"
          disabled={isDownloading}
        >
          {isDownloading ? "Generating..." : "Delivery Note"}
        </button>
        <button
          onClick={handleDownloadInvoice}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 ml-2"
          disabled={isDownloading}
        >
          {isDownloading ? "Generating..." : "Comm. Invoice"}
        </button>

      </div>
    </div>
  );
};

export default PDF;
