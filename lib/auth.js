import { PrismaAdapter } from "@auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import prisma from "@/lib/prisma"
import bcrypt from "bcryptjs"
import {
  evaluateAccess,
  REVALIDATE_AFTER_MS,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/sessionGuard"

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email or Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        

        if (!credentials?.email || !credentials?.password) {
          
          return null
        }

        // ✅ Detect whether input is email or username
        const isEmail = credentials.email.includes("@") && credentials.email.includes(".")
        
        
        
        

        // ✅ Find user by email or username
        const user = await prisma.user.findUnique({
          where: isEmail
            ? { email: credentials.email }
            : { username: credentials.email }
        })
        
        
        if (!user) {
          
          return null
        }

        if (!user.password) {
          
          return null
        }

        const passwordMatch = await bcrypt.compare(credentials.password, user.password)
        if (!passwordMatch) {
          
          return null
        }

        // One gate for sign-in AND for the periodic re-check in the jwt
        // callback, so a rule can never apply at login but not afterwards.
        const access = await evaluateAccess(user.id)
        if (!access.ok) {
          throw new Error(access.reason)
        }

        return access.user
      }
    }),
  ],

  session: {
    strategy: "jwt",
    // Sliding: the clock resets on activity, so an active user is never
    // interrupted, but an abandoned session dies after this long.
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 15 * 60, // rewrite the cookie at most every 15 minutes
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  callbacks: {
    // Re-reads the user from the database at most once every
    // REVALIDATE_AFTER_MS. Without this, isActive and role were captured at
    // sign-in and never looked at again: deactivating someone, or changing
    // their role, had no effect until their token expired.
    async jwt({ token, user, trigger }) {
      const now = Date.now()

      if (user) {
        token.role = user.role
        token.roles = user.roles ?? [user.role]
        token.navMode = user.navMode ?? "assigned"
        token.areas = user.areas ?? []
        token.employeeId = user.employeeId ?? null
        token.checkedAt = now
        token.blocked = null
        return token
      }

      const stale = !token.checkedAt || now - token.checkedAt > REVALIDATE_AFTER_MS
      if (!stale && trigger !== "update") return token

      const access = await evaluateAccess(token.sub)
      token.checkedAt = now
      if (!access.ok) {
        // Kept rather than thrown so the session callback can surface the
        // reason and the client can sign the user out cleanly.
        token.blocked = access.reason
        return token
      }

      token.blocked = null
      token.role = access.user.role
      token.roles = access.user.roles
      token.navMode = access.user.navMode
      token.areas = access.user.areas
      token.employeeId = access.user.employeeId ?? null
      token.name = access.user.name
      token.email = access.user.email
      return token
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub
        session.user.role = token.role
        // Every role (primary first), Super Admin flag, sidebar mode and the
        // areas middleware gates — lib/auth/roles.js, lib/auth/sessionGuard.js.
        session.user.roles = token.roles ?? (token.role ? [token.role] : [])
        session.user.superAdmin = session.user.roles.includes("ADMIN")
        session.user.navMode = token.navMode ?? "assigned"
        session.user.areas = token.areas ?? []
        session.user.employeeId = token.employeeId ?? null
        // The client checks this and signs out; middleware blocks the
        // request regardless, so a stale tab cannot keep working.
        session.blocked = token.blocked ?? null
      }
      return session
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
}
