"use client"

import { useEffect, useState, useMemo } from "react"
import { Chart as ChartJS, ArcElement, Title, Tooltip, Legend } from "chart.js"
import { Pie } from "react-chartjs-2"
import GraphCard from "../shared/GraphCard"
import { selectStyles } from "@/components/shared/EntityFormPanel"
import Select from "react-select"
import { Factory } from "lucide-react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import axios from "axios"
import { chartText, chartSurface, seriesList } from "../shared/chartTheme"

ChartJS.register(ArcElement, Title, Tooltip, Legend)

const CHART_COLORS = seriesList(8, 0.85)

const CHART_COLORS_SOLID = seriesList(8)

const fetchProductionData = async ({ queryKey }) => {
  const [_, params] = queryKey
  const response = await axios.get("/api/graphs/production", { params })
  return response.data
}

const ProductionItemGraph = ({ dateFrom = null, dateTo = null, item = null, className = "" }) => {
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
    type: "byItem",
    item: item || null,
  })
  const [selectedMonth, setSelectedMonth] = useState(null)

  useEffect(() => {
    if (dateFrom) setFilters((prev) => ({ ...prev, dateFrom }))
    if (dateTo) setFilters((prev) => ({ ...prev, dateTo }))
    setFilters((prev) => ({ ...prev, item: item || null }))
  }, [dateFrom, dateTo, item])

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
    queryKey: ["productionGraphData", buildQueryParams],
    queryFn: fetchProductionData,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const monthItemData = graphData?.monthItem || []

  const prepareChartData = () => {
    const selectedMonthData =
      monthItemData.find((item) => item.monthKey === selectedMonth) ||
      (monthItemData.length > 0 ? monthItemData[0] : null)

    if (!selectedMonthData || !selectedMonthData.items) return null

    if (!selectedMonth && monthItemData.length > 0) {
      setSelectedMonth(monthItemData[0].monthKey)
    }

    return {
      type: "pie",
      data: {
        labels: selectedMonthData.items.map((r) => r.name),
        datasets: [
          {
            label: "Production Qty",
            data: selectedMonthData.items.map((r) => r.qty),
            backgroundColor: selectedMonthData.items.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
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
                const pct = ((value / total) * 100).toFixed(1)
                return `${label}: ${value.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} (${pct}%)`
              },
            },
          },
        },
      },
      selectedMonthData,
    }
  }

  const chartConfig = prepareChartData()

  return (
    <GraphCard
      title="Month-wise Production by Item"
      className={className}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      error={isError ? queryError?.message || "Failed to load graph data" : null}
      empty={!chartConfig}
      emptyIcon={Factory}
      emptyTitle="No production data available"
      emptyHint="No records found for the selected period."
      actions={monthItemData.length > 0 && (
        <Select
          aria-label="Month"
          value={{
            value: selectedMonth || monthItemData[0]?.monthKey,
            label:
              monthItemData.find((m) => m.monthKey === (selectedMonth || monthItemData[0]?.monthKey))?.month ||
              "Select Month",
          }}
          onChange={(opt) => setSelectedMonth(opt.value)}
          options={monthItemData.map((item) => ({
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
            {chartConfig.selectedMonthData.items.map((item, index) => (
              <li key={item.name} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: CHART_COLORS_SOLID[index % CHART_COLORS_SOLID.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={item.name}>{item.name}</span>
                <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">Qty {item.qty.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GraphCard>
  )
}

export default ProductionItemGraph
