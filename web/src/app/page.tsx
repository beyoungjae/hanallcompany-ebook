'use client'

import { useEffect, useState } from 'react'
import { EbookClient } from '@/app/_components/EbookClient'
import EbookFlipbookMobile from '@/components/ebook/EbookFlipbookMobile'

export default function Home() {
   const [isMobile, setIsMobile] = useState(false)

   useEffect(() => {
      const checkDevice = () => {
         const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window || window.innerWidth < 768
         setIsMobile(mobile)
      }

      checkDevice()
      window.addEventListener('resize', checkDevice)
      return () => window.removeEventListener('resize', checkDevice)
   }, [])

   return <div className="h-dvh w-dvw overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">{isMobile ? <EbookFlipbookMobile pdfUrl="/book.pdf" /> : <EbookClient />}</div>
}
