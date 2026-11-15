
export const GRAPH_DEFINITIONS = {
  sales: {
    id: 'sales',
    name: 'Sales Analytics',
    graphs: [
      { id: 'combined', name: 'Sales Amount & Quantity', component: 'SalesCombinedGraph' },
      { id: 'region', name: 'Sales by Region', component: 'SalesRegionGraph' },
    ],
  },
  production: {
    id: 'production',
    name: 'Production Analytics',
    graphs: [
      { id: 'combined', name: 'Production Quantity & Output', component: 'ProductionCombinedGraph' },
      { id: 'item', name: 'Production by Item', component: 'ProductionItemGraph' },
    ],
  },
  lab: {
    id: 'lab',
    name: 'Lab Analytics',
    graphs: [
      { id: 'combined', name: 'Lab Item Quantity & Output', component: 'LabCombinedGraph' },
      { id: 'item', name: 'Lab by Item', component: 'LabItemGraph' },
    ],
  },
  scm: {
    id: 'scm',
    name: 'SCM Analytics',
    graphs: [
      { id: 'combined', name: 'Purchase Orders & Invoices', component: 'ScmCombinedGraph' }
    ],
  },
  finance: {
    id: 'finance',
    name: 'Finance Analytics',
    graphs: [
      { id: 'combined', name: 'Receipts & Payments Flow', component: 'FinanceCombinedGraph' }
    ],
  },
  store: {
    id: 'store',
    name: 'Store Analytics',
    graphs: [
      { id: 'combined', name: 'Material Issuance & GRN', component: 'StoreCombinedGraph' }
    ],
  },
  dispatch: {
    id: 'dispatch',
    name: 'Dispatch Analytics',
    graphs: [
      { id: 'combined', name: 'Dispatch Execution', component: 'DispatchCombinedGraph' }
    ],
  },
  opmanager: {
    id: 'opmanager',
    name: 'OpManager Analytics',
    graphs: [
      { id: 'combined', name: 'Production Plan Yield', component: 'OpManagerCombinedGraph' }
    ],
  },
  qualityassurance: {
    id: 'qualityassurance',
    name: 'Quality Assurance Analytics',
    graphs: [
      { id: 'combined', name: 'QA Batch Status Breakdown', component: 'QualityAssuranceCombinedGraph' }
    ],
  },
  payrolloperation: {
    id: 'payrolloperation',
    name: 'Payroll Operation Analytics',
    graphs: [
      { id: 'combined', name: 'Payroll Processing Summary', component: 'PayrollOperationCombinedGraph' }
    ],
  },
  // Add more categories here as you expand
}
