"use client"

import { useEffect, useState, useMemo } from "react"
import { Chart as ChartJS, ArcElement, Title, Tooltip, Legend } from "chart.js"
import { Pie } from "react-chartjs-2"
import GraphCard from "../shared/GraphCard"
import { selectStyles } from "@/components/shared/EntityFormPanel"
import Select from "react-select"
import { PieChart, UserX } from "lucide-react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import axios from "axios"
import { chartText, chartSurface, seriesList } from "../shared/chartTheme"

ChartJS.register(ArcElement, Title, Tooltip, Legend)

const CHART_COLORS = seriesList(8, 0.85)

const CHART_COLORS_SOLID = seriesList(8)

const fetchGraphData = async ({ queryKey }) => {
  const [_, params] = queryKey
  const response = await axios.get("/api/graphs", { params })
  return response.data
}

const SalesRegionGraph = ({ customer = null, dateFrom = null, dateTo = null, className = "" }) => {
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
    type: "region",
  })
  const [selectedMonth, setSelectedMonth] = useState(null)

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

  const monthRegionData = graphData?.monthRegion || []

  const prepareChartData = () => {
    const selectedMonthData =
      monthRegionData.find((item) => item.monthKey === selectedMonth) ||
      (monthRegionData.length > 0 ? monthRegionData[0] : null)

    if (!selectedMonthData || !selectedMonthData.regions) {
      return null
    }

    if (!selectedMonth && monthRegionData.length > 0) {
      setSelectedMonth(monthRegionData[0].monthKey)
    }

    return {
      type: "pie",
      data: {
        labels: selectedMonthData.regions.map((r) => r.name),
        datasets: [
          {
            label: "Sales Amount",
            data: selectedMonthData.regions.map((r) => r.value),
            backgroundColor: selectedMonthData.regions.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
            borderColor: chartSurface(),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 12,
              font: { size: 11 },
              usePointStyle: true,
              color: chartText(),
            },
          },
          tooltip: {
            backgroundColor: "rgba(17, 24, 39, 0.95)",
            padding: 10,
            titleFont: { size: 13, weight: "bold" },
            bodyFont: { size: 12 },
            callbacks: {
              label: (context) => {
                const label = context.label || ""
                const value = context.parsed || 0
                const total = context.dataset.data.reduce((a, b) => a + b, 0)
                const percentage = ((value / total) * 100).toFixed(1)
                return `${label}: PKR ${value.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} (${percentage}%)`
              },
            },
          },
        },
      },
      selectedMonthData,
    }
  }

  const chartConfig = prepareChartData()

  // Only show "Please select a customer" if customer is null/undefined, but allow "all"
  if (customer === null || customer === undefined) {
    return (
      <GraphCard title="Month-wise Sales by Region" className={className} empty emptyIcon={UserX}
        emptyTitle="Choose a customer" emptyHint="Pick a customer (or All Customers) in the filters above." />
    )
  }

  return (
    <GraphCard
      title="Month-wise Sales by Region"
      className={className}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      error={isError ? queryError?.message || "Failed to load graph data" : null}
      empty={!chartConfig}
      emptyIcon={PieChart}
      emptyTitle="No sales in this period"
      emptyHint="No records found for the selected period."
      actions={monthRegionData.length > 0 && (
        <Select
          aria-label="Month"
          value={{
            value: selectedMonth || monthRegionData[0]?.monthKey,
            label:
              monthRegionData.find((m) => m.monthKey === (selectedMonth || monthRegionData[0]?.monthKey))?.month ||
              "Select Month",
          }}
          onChange={(opt) => setSelectedMonth(opt.value)}
          options={monthRegionData.map((item) => ({
            value: item.monthKey,
            label: item.month,
          }))}
          isSearchable={false}
          className="w-full text-sm sm:w-[180px]"
          menuPortalTarget={typeof window !== "undefined" ? document.body : null}
          styles={selectStyles(false)}
        />
      )}
    >
      <div className="space-y-3">
        <div className="relative" style={{ height: 240 }}>
          {chartConfig && <Pie data={chartConfig.data} options={chartConfig.options} />}
        </div>
        {chartConfig?.selectedMonthData && (
          <ul className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2 2xl:grid-cols-3">
            {chartConfig.selectedMonthData.regions.map((item, index) => (
              <li key={item.name} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: CHART_COLORS_SOLID[index % CHART_COLORS_SOLID.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={item.name}>{item.name}</span>
                <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">PKR {item.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GraphCard>
  )
}

export default SalesRegionGraph
