'use client'

import { useState, useCallback, useEffect } from 'react'
import { CUSTOMER_GROUP_PARAM } from '@/lib/accounts/groupParams'
import { selectStyles } from '@/components/shared/EntityFormPanel'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import AsyncSelect from 'react-select/async'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'
import axios from 'axios'
import { cn } from '@/lib/utils'

const GraphFilters = ({ 
  dateFrom: initialDateFrom = null,
  dateTo: initialDateTo = null,
  customer: initialCustomer = null,
  item: initialItem = null,
  onDateFromChange,
  onDateToChange,
  onCustomerChange,
  onItemChange,
  customerApiEndpoint = `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
  showCustomer = true,
  showItem = false,
  className = ''
}) => {
  const defaultDateFrom = (() => {
    const today = new Date()
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(today.getMonth() - 3)
    return threeMonthsAgo
  })()

  const [dateFrom, setDateFrom] = useState(initialDateFrom || defaultDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo || new Date())
  const [customer, setCustomer] = useState(initialCustomer || { value: 'all', label: 'All Customers' })
  const [item, setItem] = useState(initialItem || null)
  const [openStates, setOpenStates] = useState({
    dateFrom: false,
    dateTo: false,
  })

  const loadCustomerOptions = useCallback((inputValue) => {
    return new Promise((resolve) => {
      const url = `${customerApiEndpoint}${inputValue ? `&search=${encodeURIComponent(inputValue)}` : ''}`

      axios
        .get(url)
        .then((response) => {
          const data = response.data.data || response.data || []
          const options = (Array.isArray(data) ? data : [data]).map((item) => ({
            value: String(item.acno),
            label: item.acname || String(item.acno),
          }))

          // Prepend "All Customers" option at the beginning
          const allCustomersOption = {
            value: 'all',
            label: 'All Customers',
          }

          // Filter options if there's a search input, but always include "All Customers"
          const filteredOptions = inputValue
            ? options.filter(opt =>
              opt.label.toLowerCase().includes(inputValue.toLowerCase())
            )
            : options

          resolve([allCustomersOption, ...filteredOptions])
        })
        .catch((err) => {
          console.error('Error loading customers:', err)
          // Even on error, return "All Customers" option
          resolve([{ value: 'all', label: 'All Customers' }])
        })
    })
  }, [customerApiEndpoint])

  const loadItemOptions = useCallback((inputValue) => {
    return new Promise((resolve) => {
      const url = `/api/forms/items?limit=50${inputValue ? `&search=${encodeURIComponent(inputValue)}` : ''}`
      axios
        .get(url)
        .then((response) => {
          const data = response.data.items || []
          const options = (Array.isArray(data) ? data : []).map((i) => ({
            value: String(i.itcd),
            label: i.item || String(i.itcd),
          }))
          const allOption = { value: 'all', label: 'All Items' }
          resolve([allOption, ...options])
        })
        .catch(() => resolve([{ value: 'all', label: 'All Items' }]))
    })
  }, [])

  const handleOpenChange = (filterName, value) => {
    setOpenStates((prev) => ({ ...prev, [filterName]: value }))
  }

  useEffect(() => {
    if (initialDateFrom !== null && initialDateFrom !== dateFrom) {
      setDateFrom(initialDateFrom)
    }
  }, [initialDateFrom])

  useEffect(() => {
    if (initialDateTo !== null && initialDateTo !== dateTo) {
      setDateTo(initialDateTo)
    }
  }, [initialDateTo])

  useEffect(() => {
    if (initialCustomer !== null && initialCustomer !== customer) {
      setCustomer(initialCustomer)
    }
  }, [initialCustomer])

  useEffect(() => {
    if (initialItem !== null && initialItem !== item) {
      setItem(initialItem)
    }
  }, [initialItem])

  const handleDateFromChange = (date) => {
    setDateFrom(date)
    if (onDateFromChange) onDateFromChange(date)
    handleOpenChange('dateFrom', false)
  }

  const handleDateToChange = (date) => {
    setDateTo(date)
    if (onDateToChange) onDateToChange(date)
    handleOpenChange('dateTo', false)
  }

  const handleCustomerChange = (selectedOption) => {
    setCustomer(selectedOption)
    if (onCustomerChange) onCustomerChange(selectedOption)
  }

  const handleItemChange = (selectedOption) => {
    setItem(selectedOption)
    if (onItemChange) onItemChange(selectedOption)
  }

  // Disable future dates
  const today = new Date()
  today.setHours(23, 59, 59, 999) // Set to end of today
  
  const disabledFutureDates = (date) => {
    return date > today
  }

  const cols = 2 + (showCustomer ? 1 : 0) + (showItem ? 1 : 0)
  const gridCols = cols === 4 ? 'lg:grid-cols-4' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
  const dateButton = (value, placeholder) => (
    <Button
      variant="outline"
      className={cn(
        'h-10 w-full justify-start gap-2 bg-background text-left font-normal hover:border-primary/50 hover:bg-primary/[0.04]',
        !value && 'text-muted-foreground'
      )}
    >
      <CalendarIcon className="h-4 w-4 flex-shrink-0 text-primary/70" />
      {value ? (
        <span className="truncate font-medium tabular-nums text-foreground">{format(new Date(value), 'dd MMM yyyy')}</span>
      ) : (
        <span className="truncate">{placeholder}</span>
      )}
    </Button>
  )

  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', gridCols, className)}>
      {/* Date From */}
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">From</Label>
        <Popover open={openStates.dateFrom} onOpenChange={(val) => handleOpenChange('dateFrom', val)}>
          <PopoverTrigger asChild>{dateButton(dateFrom, 'Select start date')}</PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={handleDateFromChange}
              disabled={disabledFutureDates}
              initialFocus
              className="rounded-lg"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Date To */}
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">To</Label>
        <Popover open={openStates.dateTo} onOpenChange={(val) => handleOpenChange('dateTo', val)}>
          <PopoverTrigger asChild>{dateButton(dateTo, 'Select end date')}</PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={handleDateToChange}
              disabled={disabledFutureDates}
              initialFocus
              className="rounded-lg"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Customer */}
      {showCustomer && (
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Customer</Label>
          <AsyncSelect
            aria-label="Customer"
            value={customer ? {
              value: String(customer.value),
              label: customer.label
            } : null}
            onChange={handleCustomerChange}
            loadOptions={loadCustomerOptions}
            defaultOptions
            cacheOptions
            isClearable
            placeholder="Choose a customer"
            className="text-sm"
            filterOption={(option, inputValue) => {
              // Always show "All Customers" option
              if (option.value === 'all') return true
              // For other options, use default filtering
              if (!inputValue) return true
              return option.label.toLowerCase().includes(inputValue.toLowerCase())
            }}
            menuPortalTarget={typeof window !== 'undefined' ? document.body : null}
            styles={selectStyles(false)}
          />
        </div>
      )}

      {/* Item */}
      {showItem && (
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Item</Label>
          <AsyncSelect
            aria-label="Item"
            value={item ? { value: String(item.value), label: item.label } : null}
            onChange={handleItemChange}
            loadOptions={loadItemOptions}
            defaultOptions
            cacheOptions
            isClearable
            placeholder="All Items"
            className="text-sm"
            filterOption={(option, inputValue) => {
              if (option.value === 'all') return true
              if (!inputValue) return true
              return option.label.toLowerCase().includes(inputValue.toLowerCase())
            }}
            menuPortalTarget={typeof window !== 'undefined' ? document.body : null}
            styles={selectStyles(false)}
          />
        </div>
      )}
    </div>
  )
}

export default GraphFilters

