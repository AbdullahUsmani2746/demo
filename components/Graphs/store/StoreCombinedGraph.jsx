"use client"

import { useEffect, useState, useMemo } from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js"
import { Line } from "react-chartjs-2"
import GraphCard from "../shared/GraphCard"
import { Warehouse } from "lucide-react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import axios from "axios"
import { chartText, chartGrid, chartSurface, series } from "../shared/chartTheme"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const fetchStoreData = async ({ queryKey }) => {
  const [_, params] = queryKey
  const response = await axios.get("/api/graphs/store", { params })
  return response.data
}

const StoreCombinedGraph = ({ dateFrom = null, dateTo = null, className = "" }) => {
  const [filters, setFilters] = useState({
    dateFrom:
      dateFrom ||
      (() => {
        const today = new Date()
        const threeMonthsAgo = new Date()
        threeMonthsAgo.setMonth(today.getMonth() - 3)
        return threeMonthsAgo
      })(),
    dateTo: dateTo || new Date(),
  })

  useEffect(() => {
    if (dateFrom) setFilters((prev) => ({ ...prev, dateFrom }))
    if (dateTo) setFilters((prev) => ({ ...prev, dateTo }))
  }, [dateFrom, dateTo])

  const buildQueryParams = useMemo(() => {
    const params = { ...filters }
    Object.keys(params).forEach((key) => {
      if (params[key] === null || params[key] === undefined || params[key] === "") {
        delete params[key]
      } else if (params[key] instanceof Date) {
        params[key] = params[key].toISOString()
      }
    })
    return params
  }, [filters])

  const {
    data: graphData,
    isLoading,
    isError,
    error: queryError,
    isFetching,
  } = useQuery({
    queryKey: ["storeGraphData", buildQueryParams],
    queryFn: fetchStoreData,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const monthWiseData = graphData?.monthWise || []

  const prepareChartData = () => {
    if (!monthWiseData || monthWiseData.length === 0) return null

    return {
      data: {
        labels: monthWiseData.map((item) => item.month),
        datasets: [
          {
            label: "Material Received (Qty)",
            data: monthWiseData.map((item) => item.receivedQty || 0),
            borderColor: series(0),
            backgroundColor: series(0, 0.1),
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: series(0),
            pointBorderColor: chartSurface(),
            pointBorderWidth: 2,
          },
          {
            label: "Material Issued (Qty)",
            data: monthWiseData.map((item) => item.issuedQty || 0),
            borderColor: series(1),
            backgroundColor: series(1, 0.1),
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: series(1),
            pointBorderColor: chartSurface(),
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              usePointStyle: true,
              padding: 20,
              font: { size: 13, weight: "500", family: "'Inter', 'system-ui', sans-serif" },
              color: chartText(),
            },
          },
          tooltip: {
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            padding: 12,
            titleFont: { size: 14, weight: "600", family: "'Inter', 'system-ui', sans-serif" },
            bodyFont: { size: 13, family: "'Inter', 'system-ui', sans-serif" },
            titleColor: "#f9fafb",
            bodyColor: "#f9fafb",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            cornerRadius: 8,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || ""
                return `${label.split(" ")[0]} Qty: ${context.parsed.y.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              },
            },
          },
        },
        scales: {
          y: {
            type: "linear",
            beginAtZero: true,
            grid: { color: chartGrid(), lineWidth: 1 },
            ticks: {
              font: { size: 12, family: "'Inter', 'system-ui', sans-serif" },
              color: chartText(),
            },
            title: { display: true, text: "Quantity", color: chartText(), font: { size: 11 } },
          },
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 12, family: "'Inter', 'system-ui', sans-serif" },
              color: chartText(),
            },
          },
        },
      },
    }
  }

  const chartConfig = prepareChartData()

  return (
    <GraphCard
      title="Store Stock Movements (Received vs Issued)"
      className={className}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      error={isError ? queryError?.message || "Failed to load store data" : null}
      empty={!chartConfig}
      emptyIcon={Warehouse}
      emptyTitle="No store data available"
      emptyHint="No records found for the selected period."
      height={280}
    >
      <div className="relative" style={{ height: 280 }}>
        {chartConfig && <Line data={chartConfig.data} options={chartConfig.options} />}
      </div>
    </GraphCard>
  )
}

export default StoreCombinedGraph
