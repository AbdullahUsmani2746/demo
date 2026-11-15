import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GRAPH_DEFINITIONS } from '@/components/Graphs/permissions'
import prisma from '@/lib/prisma'

// Convert allowedGraphs array (["sales:quantity", "sales:amount"]) to structured format
function parseAllowedGraphs(allowedGraphsArray) {
  const permissions = {}
  
  allowedGraphsArray.forEach((graphKey) => {
    const [category, graphId] = graphKey.split(':')
    if (category && graphId) {
      if (!permissions[category]) {
        permissions[category] = []
      }
      permissions[category].push(graphId)
    }
  })
  
  return permissions
}

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userEmail = session.user.email
    // Roles that see the whole menu (Super Admin, management — Admin → Roles) see every graph
    if (session.user.navMode === 'all') {
      return NextResponse.json({
        allowedGraphs: GRAPH_DEFINITIONS,
        allAllowed: true,
      })
    }

    // For other roles, check permissions from Employee model
    const employee = await prisma.employee.findUnique({
      where: { emailAddress: userEmail },
      select: { allowedGraphs: true },
    })

    const allowedGraphsArray = employee?.allowedGraphs || []
    const userPermissions = parseAllowedGraphs(allowedGraphsArray)

    // Build allowed graphs structure from permissions
    const allowedGraphs = {}
    
    Object.keys(userPermissions).forEach((category) => {
      const allowedGraphIds = userPermissions[category] || []
      
      if (allowedGraphIds.length > 0 && GRAPH_DEFINITIONS[category]) {
        allowedGraphs[category] = {
          id: category,
          name: GRAPH_DEFINITIONS[category].name,
          graphs: GRAPH_DEFINITIONS[category].graphs.filter((g) =>
            allowedGraphIds.includes(g.id)
          ),
        }
      }
    })

    return NextResponse.json({
      allowedGraphs,
      allAllowed: false,
    })
  } catch (error) {
    console.error('❌ Error fetching graph permissions:', error)
    return NextResponse.json(
      { error: 'Failed to load graph permissions', message: error.message },
      { status: 500 }
    )
  }
}

