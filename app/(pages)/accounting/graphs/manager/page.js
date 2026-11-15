'use client'
import { roleLabel } from "@/lib/auth/roleNames";
// Accounting → Graphs → Permissions manager. One card per user: role, how many
// charts they may see, Expand to tick modules / charts, Save writes that user's
// set. Search filters by name or email.

import { useState, useEffect } from 'react'
import axios from 'axios'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown, Loader2Icon, Save, Search, Users, CheckCircle2, BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Chip, LabCard, LabEmpty, LabHeader } from '@/components/Material/shared/LabUI'

const PAGE = 'min-h-screen bg-muted/40'
const FRAME = 'mx-auto max-w-[1600px] px-3 py-5 sm:px-6'

const GraphPermissionsManager = () => {
  const [users, setUsers] = useState([])
  const [graphDefinitions, setGraphDefinitions] = useState({})
  const [permissions, setPermissions] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedUsers, setExpandedUsers] = useState(new Set())

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [usersRes, permissionsRes] = await Promise.all([
        axios.get('/api/users', { params: { limit: 1000 } }),
        axios.get('/api/graphs/permissions/manage'),
      ])

      setUsers(usersRes.data.users || [])
      setGraphDefinitions(permissionsRes.data.graphDefinitions || {})
      setPermissions(permissionsRes.data.permissions || {})
    } catch (error) {
      console.error('Error fetching data:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const toggleUserExpanded = (userId) => {
    setExpandedUsers((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(userId)) {
        newSet.delete(userId)
      } else {
        newSet.add(userId)
      }
      return newSet
    })
  }

  const toggleGraphPermission = (userId, category, graphId, checked) => {
    setPermissions((prev) => {
      const newPermissions = { ...prev }
      if (!newPermissions[userId]) {
        newPermissions[userId] = {}
      }
      if (!newPermissions[userId][category]) {
        newPermissions[userId][category] = []
      }

      if (checked) {
        // Add graph if not already in array
        if (!newPermissions[userId][category].includes(graphId)) {
          newPermissions[userId][category] = [...newPermissions[userId][category], graphId]
        }
      } else {
        // Remove graph from array
        newPermissions[userId][category] = newPermissions[userId][category].filter(
          (id) => id !== graphId
        )
        if (newPermissions[userId][category].length === 0) {
          delete newPermissions[userId][category]
        }
        if (Object.keys(newPermissions[userId]).length === 0) {
          delete newPermissions[userId]
        }
      }

      return newPermissions
    })
  }

  const toggleCategoryPermission = (userId, category, checked) => {
    const categoryGraphs = graphDefinitions[category]?.graphs || []

    setPermissions((prev) => {
      const newPermissions = { ...prev }
      if (!newPermissions[userId]) {
        newPermissions[userId] = {}
      }

      if (checked) {
        // Select all
        newPermissions[userId][category] = categoryGraphs.map((g) => g.id)
      } else {
        // Deselect all
        delete newPermissions[userId][category]
        if (Object.keys(newPermissions[userId]).length === 0) {
          delete newPermissions[userId]
        }
      }

      return newPermissions
    })
  }

  const savePermissions = async (userId) => {
    try {
      setSaving((prev) => ({ ...prev, [userId]: true }))
      const userPermissions = permissions[userId] || {}

      await axios.post('/api/graphs/permissions/manage', {
        userId,
        permissions: userPermissions,
      })

      toast.success('Permissions saved successfully')
    } catch (error) {
      console.error('Error saving permissions:', error)
      toast.error('Failed to save permissions')
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const isGraphSelected = (userId, category, graphId) => {
    return permissions[userId]?.[category]?.includes(graphId) || false
  }

  const isCategoryFullySelected = (userId, category) => {
    const categoryGraphs = graphDefinitions[category]?.graphs || []
    if (categoryGraphs.length === 0) return false
    const userCategoryPerms = permissions[userId]?.[category] || []
    return categoryGraphs.every((g) => userCategoryPerms.includes(g.id))
  }

  const isCategoryPartiallySelected = (userId, category) => {
    const categoryGraphs = graphDefinitions[category]?.graphs || []
    const userCategoryPerms = permissions[userId]?.[category] || []
    const selectedCount = categoryGraphs.filter((g) => userCategoryPerms.includes(g.id)).length
    return selectedCount > 0 && selectedCount < categoryGraphs.length
  }

  const filteredUsers = users.filter(
    (user) =>
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const header = (
    <LabHeader
      icon={Users}
      breadcrumb="Accounting · Graphs"
      title="Graph Permissions"
      subtitle="Assign graph viewing permissions to employees"
      badge={loading ? undefined : `${users.length} users`}
      className="mb-4"
    />
  )

  if (loading) {
    return (
      <div className={PAGE}>
        <div className={FRAME} aria-busy="true">
          {header}
          <div className="mb-4 h-16 animate-pulse rounded-xl border border-border bg-background" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4">
                <div className="h-10 w-10 animate-pulse rounded-full bg-primary/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-56 animate-pulse rounded bg-muted" />
                </div>
                <div className="hidden h-8 w-24 animate-pulse rounded-lg bg-muted sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <div className={`${FRAME} pb-16`}>
        {header}

        {/* Search */}
        <div className="mb-4 rounded-xl border border-border bg-background p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 pl-9"
            />
          </div>
        </div>

        {/* Users List */}
        <div className="space-y-3">
          {filteredUsers.map((user) => {
            const userPermissions = permissions[user.id] || {}
            const hasAnyPermissions = Object.keys(userPermissions).length > 0
            const isExpanded = expandedUsers.has(user.id)
            const grantedCount = Object.values(userPermissions).reduce(
              (n, ids) => n + (Array.isArray(ids) ? ids.length : 0),
              0
            )

            return (
              <section key={user.id} className="overflow-clip rounded-xl border border-border bg-background">
                <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => toggleUserExpanded(user.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-expanded={isExpanded}
                  >
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold uppercase text-primary">
                      {(user.name || user.email || '?').slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-foreground">{user.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Chip tone="muted">{roleLabel(user.role)}</Chip>
                        {hasAnyPermissions && (
                          <Chip tone="ok">
                            <CheckCircle2 className="h-3 w-3" />
                            Has Permissions · {grantedCount}
                          </Chip>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 max-sm:[&>*]:flex-1">
                    <Button variant="outline" size="sm" onClick={() => toggleUserExpanded(user.id)}>
                      <ChevronDown className={cn('mr-1.5 h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </Button>
                    <Button onClick={() => savePermissions(user.id)} disabled={saving[user.id]} size="sm">
                      {saving[user.id] ? (
                        <>
                          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="grid gap-3 border-t border-border bg-muted/30 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
                    {Object.keys(graphDefinitions).map((categoryKey) => {
                      const category = graphDefinitions[categoryKey]
                      const isCategoryFull = isCategoryFullySelected(user.id, categoryKey)
                      const isCategoryPartial = isCategoryPartiallySelected(user.id, categoryKey)
                      const catId = `${user.id}-${categoryKey}`

                      return (
                        <div
                          key={categoryKey}
                          className={cn(
                            'rounded-lg border bg-background',
                            isCategoryFull || isCategoryPartial ? 'border-primary/40' : 'border-border'
                          )}
                        >
                          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                            <Checkbox
                              id={catId}
                              checked={isCategoryFull || isCategoryPartial}
                              onCheckedChange={(checked) => toggleCategoryPermission(user.id, categoryKey, checked)}
                            />
                            <Label htmlFor={catId} className="flex-1 cursor-pointer text-sm font-semibold">
                              {category.name}
                            </Label>
                            {isCategoryPartial && <Chip tone="warn">Partial</Chip>}
                          </div>
                          <div className="space-y-1 px-3 py-2">
                            {category.graphs.map((graph) => (
                              <div key={graph.id} className="flex items-center gap-2 py-1">
                                <Checkbox
                                  id={`${user.id}-${categoryKey}-${graph.id}`}
                                  checked={isGraphSelected(user.id, categoryKey, graph.id)}
                                  onCheckedChange={(checked) =>
                                    toggleGraphPermission(user.id, categoryKey, graph.id, checked)
                                  }
                                />
                                <Label
                                  htmlFor={`${user.id}-${categoryKey}-${graph.id}`}
                                  className="cursor-pointer text-sm font-normal"
                                >
                                  {graph.name}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {filteredUsers.length === 0 && (
          <LabCard>
            <LabEmpty
              icon={searchTerm ? Search : BarChart3}
              title="No users found"
              hint={searchTerm ? 'Try another name or email.' : undefined}
            />
          </LabCard>
        )}
      </div>
    </div>
  )
}

export default GraphPermissionsManager
