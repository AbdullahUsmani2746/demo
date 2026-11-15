'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const GraphPage = ({ params }) => {
  const router = useRouter()

  useEffect(() => {
    // Redirect to main graphs page
    router.replace('/accounting/graphs')
  }, [router])
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex h-64 max-w-[1600px] items-center justify-center px-3 py-5 sm:px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
          <p className="text-sm text-muted-foreground">Redirecting to graphs page...</p>
        </div>
      </div>
    </div>
  )
}

export default GraphPage
