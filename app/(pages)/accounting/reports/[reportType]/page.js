// app/reports/[reportType]/page.jsx
import ReportViewer from '@/components/Reports/ReportViewer';

const ReportPage = async ({ params }) => {
  const { reportType } = await params;
  return <ReportViewer reportType={reportType} />;
};

export default ReportPage;