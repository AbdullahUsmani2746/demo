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
import { LineChart, UserX } from "lucide-react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import axios from "axios"
import { chartText, chartGrid, chartSurface, series } from "../shared/chartTheme"

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const fetchGraphData = async ({ queryKey }) => {
  const [_, params] = queryKey
  const response = await axios.get("/api/graphs", { params })
  return response.data
}

const SalesCombinedGraph = ({ customer = null, dateFrom = null, dateTo = null, className = "" }) => {
  const [filters, setFilters] = useState({
    customer: customer,
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
    if (customer !== null && customer !== undefined) {
      setFilters((prev) => ({ ...prev, customer }))
    }
    if (dateFrom) {
      setFilters((prev) => ({ ...prev, dateFrom }))
    }
    if (dateTo) {
      setFilters((prev) => ({ ...prev, dateTo }))
    }
  }, [customer, dateFrom, dateTo])

  const buildQueryParams = useMemo(() => {
    const params = {
      ...filters,
    }
    Object.keys(params).forEach((key) => {
      if (params[key] === null || params[key] === undefined || params[key] === "") {
        delete params[key]
      } else if (params[key] instanceof Date) {
        params[key] = params[key].toISOString()
      }
    })

    return params
  }, [filters])

  // Fetch amount data
  const {
    data: amountData,
    isLoading: isLoadingAmount,
    isError: isErrorAmount,
    error: errorAmount,
    isFetching: isFetchingAmount,
  } = useQuery({
    queryKey: ["graphData", { ...buildQueryParams, type: "amount" }],
    queryFn: fetchGraphData,
    enabled: Object.keys(filters).length > 0 && customer !== null && customer !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  // Fetch quantity data
  const {
    data: quantityData,
    isLoading: isLoadingQuantity,
    isError: isErrorQuantity,
    error: errorQuantity,
    isFetching: isFetchingQuantity,
  } = useQuery({
    queryKey: ["graphData", { ...buildQueryParams, type: "quantity" }],
    queryFn: fetchGraphData,
    enabled: Object.keys(filters).length > 0 && customer !== null && customer !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const amountMonthWiseData = amountData?.monthWise || []
  const quantityMonthWiseData = quantityData?.monthWise || []

  const isLoading = isLoadingAmount || isLoadingQuantity
  const isFetching = isFetchingAmount || isFetchingQuantity
  const isError = isErrorAmount || isErrorQuantity
  const queryError = errorAmount || errorQuantity

  const prepareChartData = () => {
    // Merge data from both sources by month
    const monthMap = new Map()

    // Add amount data
    amountMonthWiseData.forEach((item) => {
      monthMap.set(item.month, {
        month: item.month,
        amount: item.amount || 0,
        qty: 0,
      })
    })

    // Add quantity data
    quantityMonthWiseData.forEach((item) => {
      if (monthMap.has(item.month)) {
        monthMap.get(item.month).qty = item.qty || 0
      } else {
        monthMap.set(item.month, {
          month: item.month,
          amount: 0,
          qty: item.qty || 0,
        })
      }
    })

    const mergedData = Array.from(monthMap.values()).sort((a, b) => {
      // Sort by month name (assuming format like "January 2024")
      return new Date(a.month + " 1") - new Date(b.month + " 1")
    })

    if (!mergedData || mergedData.length === 0) {
      return null
    }

    return {
      type: "line",
      data: {
        labels: mergedData.map((item) => item.month),
        datasets: [
          {
            label: "Amount",
            data: mergedData.map((item) => (item.amount || 0) / 1000),
            borderColor: series(0), // Deep Maroon - Primary
            backgroundColor: series(0, 0.1),
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: series(0),
            pointBorderColor: chartSurface(),
            pointBorderWidth: 2,
            pointHoverBackgroundColor: series(0),
            pointHoverBorderColor: chartSurface(),
            pointHoverBorderWidth: 3,
            shadowOffsetX: 0,
            shadowOffsetY: 4,
            shadowBlur: 10,
            shadowColor: series(0, 0.3),
          },
          {
            label: "Quantity",
            data: mergedData.map((item) => item.qty || 0),
            borderColor: series(1), // Vibrant Red - Accent
            backgroundColor: series(1, 0.1),
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 8,
            pointBackgroundColor: series(1),
            pointBorderColor: chartSurface(),
            pointBorderWidth: 2,
            pointHoverBackgroundColor: series(1),
            pointHoverBorderColor: chartSurface(),
            pointHoverBorderWidth: 3,
            shadowOffsetX: 0,
            shadowOffsetY: 4,
            shadowBlur: 10,
            shadowColor: series(1, 0.3),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: "index",
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              usePointStyle: true,
              padding: 20,
              font: {
                size: 13,
                weight: "500",
                family: "'Inter', 'system-ui', sans-serif",
              },
              color: chartText(),
              boxWidth: 12,
              boxHeight: 12,
            },
          },
          tooltip: {
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            padding: 12,
            titleFont: {
              size: 14,
              weight: "600",
              family: "'Inter', 'system-ui', sans-serif",
            },
            bodyFont: {
              size: 13,
              family: "'Inter', 'system-ui', sans-serif",
            },
            titleColor: "#f9fafb",
            bodyColor: "#f9fafb",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || ""
                if (label.includes("Amount")) {
                  return `Amount: PKR ${(context.parsed.y * 1000).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                } else {
                  return `Quantity: ${context.parsed.y.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                }
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: chartGrid(),
              lineWidth: 1,
              drawBorder: false,
            },
            ticks: {
              font: {
                size: 12,
                family: "'Inter', 'system-ui', sans-serif",
              },
              color: chartText(),
              padding: 10,
              callback: (value) =>
                value.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                }),
            },
          },
          x: {
            grid: {
              display: false,
              drawBorder: false,
            },
            ticks: {
              font: {
                size: 12,
                family: "'Inter', 'system-ui', sans-serif",
              },
              color: chartText(),
              padding: 12,
            },
          },
        },
      },
    }
  }

  const chartConfig = prepareChartData()

  // Only show "Please select a customer" if customer is null/undefined, but allow "all"
  if (customer === null || customer === undefined) {
    return (
      <GraphCard title="Month-wise Sales Amount & Quantity" className={className} empty emptyIcon={UserX}
        emptyTitle="Choose a customer" emptyHint="Pick a customer (or All Customers) in the filters above." />
    )
  }

  return (
    <GraphCard
      title="Month-wise Sales Amount & Quantity"
      subtitle="Amount in PKR thousands"
      className={className}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      error={isError ? queryError?.message || "Failed to load graph data" : null}
      empty={!chartConfig}
      emptyIcon={LineChart}
      emptyTitle="No sales in this period"
      emptyHint="Try a wider date range or another customer."
    >
      <div className="relative" style={{ height: 280 }}>
        {chartConfig && <Line data={chartConfig.data} options={chartConfig.options} />}
      </div>
    </GraphCard>
  )
}

export default SalesCombinedGraph
