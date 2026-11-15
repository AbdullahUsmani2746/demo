"use client"

import { useEffect, useState, useMemo } from "react"
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js"
import { Bar } from "react-chartjs-2"
import GraphCard from "../shared/GraphCard"
import { UserX } from "lucide-react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import axios from "axios"
import { series, chartText, chartGrid } from "../shared/chartTheme"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const fetchGraphData = async ({ queryKey }) => {
  const [_, params] = queryKey
  const response = await axios.get("/api/graphs", { params })
  return response.data
}

const SalesQuantityGraph = ({ customer = null, dateFrom = null, dateTo = null, className = "" }) => {
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
    type: "quantity",
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

  const {
    data: graphData,
    isLoading,
    isError,
    error: queryError,
    isFetching,
  } = useQuery({
    queryKey: ["graphData", buildQueryParams],
    queryFn: fetchGraphData,
    enabled: Object.keys(filters).length > 0 && customer !== null && customer !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const monthWiseData = graphData?.monthWise || []

  const prepareChartData = () => {
    const data = monthWiseData

    if (!data || data.length === 0) {
      return null
    }

    return {
      type: "bar",
      data: {
        labels: data.map((item) => item.month),
        datasets: [
          {
            label: "Quantity",
            data: data.map((item) => item.qty || 0),
            backgroundColor: series(0, 0.8),
            borderColor: series(0, 1),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            padding: 10,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 12 },
            callbacks: {
              label: (context) => `Quantity: ${context.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: chartGrid(),
            },
            ticks: {
              font: { size: 11 },
              color: chartText(),
            },
          },
          x: {
            grid: {
              display: false,
            },
            ticks: {
              font: { size: 11 },
              color: chartText(),
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
      <GraphCard title="Month-wise Sales Quantity" className={className} empty emptyIcon={UserX}
        emptyTitle="Choose a customer" emptyHint="Pick a customer (or All Customers) in the filters above." />
    )
  }

  return (
    <GraphCard
      title="Month-wise Sales Quantity"
      className={className}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      error={isError ? queryError?.message || "Failed to load graph data" : null}
      empty={!chartConfig}
    >
      <div className="relative" style={{ height: 280 }}>
        {chartConfig && <Bar data={chartConfig.data} options={chartConfig.options} />}
      </div>
    </GraphCard>
  )
}

export default SalesQuantityGraph
