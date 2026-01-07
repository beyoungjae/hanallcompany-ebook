import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MobileControlsProps {
   currentPageLabel: string
   zoomLabel: string
   canZoomOut: boolean
   canZoomIn: boolean
   canPrevPage: boolean
   canNextPage: boolean
   onPrevPage: () => void
   onNextPage: () => void
   onZoomOut: () => void
   onZoomIn: () => void
}

export function MobileControls({ currentPageLabel, zoomLabel, canZoomOut, canZoomIn, canPrevPage, canNextPage, onPrevPage, onNextPage, onZoomOut, onZoomIn }: MobileControlsProps) {
   return (
      <div className="sticky top-0 z-30 flex h-[60px] items-center justify-between gap-2 border-b border-zinc-200 bg-white/95 px-2 py-2 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95 md:gap-3 md:px-3 md:py-3">
         <div className="flex items-center gap-1 md:gap-2">
            <Button variant="secondary" className="h-9 px-3 text-sm md:h-12 md:px-4 md:text-base" onClick={onPrevPage} disabled={!canPrevPage}>
               <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
               <span className="hidden sm:inline">이전</span>
            </Button>
            <Button variant="secondary" className="h-9 px-3 text-sm md:h-12 md:px-4 md:text-base" onClick={onNextPage} disabled={!canNextPage}>
               <span className="hidden sm:inline">다음</span>
               <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
         </div>

         <div className="flex items-center gap-1 md:gap-3">
            <div className="text-sm font-semibold tabular-nums md:text-base">{currentPageLabel}</div>

            <div className="flex items-center gap-1 md:gap-2">
               <Button variant="outline" className="h-8 w-8 p-0 md:h-12 md:w-12" onClick={onZoomOut} disabled={!canZoomOut} aria-label="축소">
                  <Minus className="h-3 w-3 md:h-4 md:w-4" />
               </Button>
               <div className="min-w-12 text-center text-xs font-semibold tabular-nums md:min-w-20 md:text-base">{zoomLabel}</div>
               <Button variant="outline" className="h-8 w-8 p-0 md:h-12 md:w-12" onClick={onZoomIn} disabled={!canZoomIn} aria-label="확대">
                  <Plus className="h-3 w-3 md:h-4 md:w-4" />
               </Button>
            </div>
         </div>
      </div>
   )
}
