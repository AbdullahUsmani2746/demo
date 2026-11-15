import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GRAPH_DEFINITIONS } from '@/components/Graphs/permissions'
import prisma from '@/lib/prisma'
import { guard } from "@/lib/auth/route";

// Convert structured permissions ({ sales: ["quantity", "amount"] }) to array format (["sales:quantity", "sales:amount"])
function convertToAllowedGraphsArray(permissions) {
  const allowedGraphsArray = []
  
  Object.keys(permissions).forEach((category) => {
    const graphIds = permissions[category] || []
    graphIds.forEach((graphId) => {
      allowedGraphsArray.push(`${category}:${graphId}`)
    })
  })
  
  return allowedGraphsArray
}

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

// GET: Fetch all permissions and users
export async function GET(request) {
  try {
    // Allow everyone for testing (remove this check later)
    // const session = await getServerSession(authOptions)
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // }

    // Fetch all employees with their allowedGraphs
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        emailAddress: true,
        allowedGraphs: true,
      },
    })

    // Fetch all users and create an email -> userId map
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
      },
    })
    
    const emailToUserIdMap = new Map()
    users.forEach((user) => {
      emailToUserIdMap.set(user.email, user.id)
    })

    // Convert to the format expected by the frontend (keyed by User.id)
    const permissions = {}
    
    employees.forEach((employee) => {
      if (employee.allowedGraphs && employee.allowedGraphs.length > 0) {
        const userId = emailToUserIdMap.get(employee.emailAddress)
        if (userId) {
          permissions[userId] = parseAllowedGraphs(employee.allowedGraphs)
        }
      }
    })
    
    return NextResponse.json({
      permissions,
      graphDefinitions: GRAPH_DEFINITIONS,
    })
  } catch (error) {
    console.error('❌ Error fetching permissions:', error)
    return NextResponse.json(
      { error: 'Failed to load permissions', message: error.message },
      { status: 500 }
    )
  }
}

// POST: Update permissions for a user
export const POST = guard("permissions.manage", async (request) => {
  try {
    // Allow everyone for testing (remove this check later)
    // const session = await getServerSession(authOptions)
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // }

    const { userId, permissions } = await request.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    // userId is the User.id (cuid string), we need to find the User first to get email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Find employee by email
    const employee = await prisma.employee.findUnique({
      where: { emailAddress: user.email },
      select: { id: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee record not found for this user' },
        { status: 404 }
      )
    }

    // Convert permissions to array format
    const allowedGraphsArray = permissions && Object.keys(permissions).length > 0
      ? convertToAllowedGraphsArray(permissions)
      : []

    // Update employee's allowedGraphs
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        allowedGraphs: allowedGraphsArray,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Permissions updated successfully',
      permissions: permissions || {},
    })
  } catch (error) {
    console.error('❌ Error updating permissions:', error)
    return NextResponse.json(
      { error: 'Failed to update permissions', message: error.message },
      { status: 500 }
    )
  }
});

// DELETE: Remove permissions for a user
export const DELETE = guard("permissions.manage", async (request) => {
  try {
    // Allow everyone for testing (remove this check later)
    // const session = await getServerSession(authOptions)
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    // Find user by id to get email
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Find employee by email
    const employee = await prisma.employee.findUnique({
      where: { emailAddress: user.email },
      select: { id: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee record not found for this user' },
        { status: 404 }
      )
    }

    // Clear allowedGraphs
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        allowedGraphs: [],
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Permissions removed successfully',
    })
  } catch (error) {
    console.error('❌ Error deleting permissions:', error)
    return NextResponse.json(
      { error: 'Failed to delete permissions', message: error.message },
      { status: 500 }
    )
  }
});

