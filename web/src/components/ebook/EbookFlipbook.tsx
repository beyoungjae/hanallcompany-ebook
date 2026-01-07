'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import HTMLFlipBook from 'react-pageflip'
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PdfDocument = {
   numPages: number
   getPage: (pageNumber: number) => Promise<{
      getViewport: (options: { scale: number }) => { width: number; height: number }
      render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void }
   }>
}

type PageFlipApi = {
   pageFlip: () => {
      flipNext: () => void
      flipPrev: () => void
      turnToPage: (pageIndex: number) => void
      getCurrentPageIndex: () => number
   }
}

function useElementSize<T extends HTMLElement>() {
   const ref = useRef<T | null>(null)
   const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

   useEffect(() => {
      const el = ref.current
      if (!el) return

      const ro = new ResizeObserver((entries) => {
         const cr = entries[0]?.contentRect
         setSize({ width: cr?.width ?? 0, height: cr?.height ?? 0 })
      })
      ro.observe(el)
      return () => ro.disconnect()
   }, [])

   return { ref, ...size }
}

export type EbookFlipbookProps = {
   pdfUrl: string
   className?: string
}

export function EbookFlipbook({ pdfUrl, className }: EbookFlipbookProps) {
   const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize<HTMLDivElement>()

   const flipbookRef = useRef<PageFlipApi | null>(null)
   const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([])
   const renderedPagesRef = useRef<Set<number>>(new Set())
   const inflightPagesRef = useRef<Set<number>>(new Set())
   const renderLoopIdRef = useRef(0)
   const lastSizeKeyRef = useRef<string | null>(null)
   const autoFlipTimerRef = useRef<number | null>(null)
   const scheduleTimerRef = useRef<number | null>(null)
   const scheduleRenderRef = useRef<(() => void) | null>(null)
   const pageIndexRef = useRef(0)
   const scrollRef = useRef<HTMLDivElement | null>(null)
   const dragScrollRef = useRef<{ active: boolean; x: number; y: number; left: number; top: number }>({
      active: false,
      x: 0,
      y: 0,
      left: 0,
      top: 0,
   })

   const [reloadNonce, setReloadNonce] = useState(0)
   const [doc, setDoc] = useState<PdfDocument | null>(null)
   const [numPages, setNumPages] = useState(0)
   const [pageIndex, setPageIndex] = useState(0)
   const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null)
   const [pageRatio, setPageRatio] = useState<number | null>(null) // height / width
   const [viewZoom, setViewZoom] = useState(1.0)
   const [panBySpace, setPanBySpace] = useState(false)
   const [isPanning, setIsPanning] = useState(false)

   const [status, setStatus] = useState<{ state: 'idle' } | { state: 'loading' } | { state: 'rendering'; rendered: number; total: number } | { state: 'ready' } | { state: 'error'; message: string }>({ state: 'idle' })

   const isNarrow = containerWidth > 0 && containerWidth < 768
   const controlsH = 84

   const targetPageSize = useMemo(() => {
      if (!pageRatio) return null

      const padX = 24
      const padY = 16
      const availableW = Math.max(0, containerWidth - padX * 2)
      const availableH = Math.max(0, containerHeight - controlsH - padY * 2)
      if (availableW <= 0 || availableH <= 0) return null

      // PC(스프레드=2페이지) 기준: "가장 크게" 맞추기
      // 제약: spread면 2*w <= availableW, h=w*ratio <= availableH
      const maxWByWidth = isNarrow ? availableW : availableW / 2
      const maxWByHeight = pageRatio > 0 ? availableH / pageRatio : maxWByWidth
      const baseW = Math.max(0, Math.min(maxWByWidth, maxWByHeight))

      // 줌은 페이지 자체 크기를 키우고, 이동은 스크롤(스크롤바 숨김 + 드래그)
      const w = baseW * viewZoom
      const h = w * pageRatio

      return { w, h }
   }, [containerWidth, containerHeight, controlsH, isNarrow, pageRatio, viewZoom])

   useEffect(() => {
      let cancelled = false

      async function load() {
         setStatus({ state: 'loading' })
         setDoc(null)
         setNumPages(0)
         setPageIndex(0)
         setPageSize(null)
         setPageRatio(null)

         try {
            // Webpack 번들링을 피하기 위해(해당 경로에서 runtime 에러 발생) public 에서 네이티브 import로 로드
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore - webpackIgnore 주석은 번들러 힌트이며 TS 타입은 d.ts로 보강
            const pdfjs = (await import(/* webpackIgnore: true */ '/pdfjs/pdf.mjs')) as unknown as {
               getDocument: typeof import('pdfjs-dist').getDocument
               GlobalWorkerOptions: { workerSrc: string }
            }

            pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'

            const task = pdfjs.getDocument({ url: pdfUrl })
            const loaded = (await task.promise) as unknown as PdfDocument
            if (cancelled) return

            setDoc(loaded)
            setNumPages(loaded.numPages)

            const first = await loaded.getPage(1)
            if (cancelled) return
            const vp = first.getViewport({ scale: 1 })
            const ratio = vp.width > 0 ? vp.height / vp.width : null
            setPageRatio(ratio)
            setStatus({ state: 'ready' })
         } catch (e) {
            if (cancelled) return
            // 원인 추적을 위해 브라우저 콘솔에 원본 에러(스택 포함)를 남김
            // eslint-disable-next-line no-console
            console.error('[EbookFlipbook] pdf.js load error:', e)
            const message = e instanceof Error ? e.message : 'PDF를 불러오지 못했습니다.'
            setStatus({ state: 'error', message })
         }
      }

      load()
      return () => {
         cancelled = true
      }
   }, [pdfUrl, reloadNonce])

   useEffect(() => {
      if (!targetPageSize) return
      setPageSize(targetPageSize)
   }, [targetPageSize])

   useEffect(() => {
      // 줌/사이즈 변경 시 스크롤을 가운데로(스크롤바는 숨김)
      const el = scrollRef.current
      if (!el) return
      // 다음 프레임에 측정값이 확정되므로 rAF로 한 번 미룸
      requestAnimationFrame(() => {
         el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
         el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
      })
   }, [viewZoom])

   useEffect(() => {
      pageIndexRef.current = pageIndex
   }, [pageIndex])

   useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
         if (e.code === 'Space') {
            setPanBySpace(true)
            // 스페이스 누른 채 스크롤 이동 시 페이지 점프를 막음
            e.preventDefault()
         }
      }
      const handleKeyUp = (e: KeyboardEvent) => {
         if (e.code === 'Space') setPanBySpace(false)
      }
      window.addEventListener('keydown', handleKeyDown, { passive: false })
      window.addEventListener('keyup', handleKeyUp, { passive: false })
      return () => {
         window.removeEventListener('keydown', handleKeyDown)
         window.removeEventListener('keyup', handleKeyUp)
      }
   }, [])

   // 모바일 터치 제어: 뷰포트 반절로 페이지 이동 + 두 손가락 줌 허용
   useEffect(() => {
      const scrollEl = scrollRef.current
      if (!scrollEl) return

      let touchStartX = 0
      let touchStartY = 0
      let isMultiTouch = false

      const handleTouchStart = (e: TouchEvent) => {
         const touchCount = e.touches.length
         isMultiTouch = touchCount >= 2

         // 두 손가락 터치일 때는 브라우저 기본 줌 동작 허용
         if (isMultiTouch) {
            return
         }

         // 한 손가락 터치 시작 위치 기록
         const touch = e.touches[0]
         touchStartX = touch.clientX
         touchStartY = touch.clientY

         // 한 손가락 터치의 모든 기본 동작 방지 (드래그, 스크롤 등)
         e.preventDefault()
         e.stopPropagation()
      }

      const handleTouchMove = (e: TouchEvent) => {
         // 두 손가락 터치일 때는 브라우저 기본 줌 동작 허용
         if (e.touches.length >= 2) {
            return
         }
         // 한 손가락 드래그 방지
         e.preventDefault()
         e.stopPropagation()
      }

      const handleTouchEnd = (e: TouchEvent) => {
         // 두 손가락 터치 후 끝났을 때는 무시
         if (isMultiTouch) {
            isMultiTouch = false
            return
         }

         const touch = e.changedTouches[0]
         const endX = touch.clientX
         const endY = touch.clientY

         // 터치 이동 거리가 너무 작으면 클릭으로 간주하고 무시 (10px 이하)
         const deltaX = Math.abs(endX - touchStartX)
         const deltaY = Math.abs(endY - touchStartY)
         if (deltaX < 10 && deltaY < 10) {
            return
         }

         // 뷰포트 너비의 반을 기준으로 왼쪽/오른쪽 판단
         const viewportWidth = window.innerWidth
         const isLeftSide = touchStartX < viewportWidth / 2

         if (isLeftSide) {
            // 왼쪽 반절 터치: 이전 페이지
            flipbookRef.current?.pageFlip().flipPrev()
         } else {
            // 오른쪽 반절 터치: 다음 페이지
            flipbookRef.current?.pageFlip().flipNext()
         }

         e.preventDefault()
         e.stopPropagation()
      }

      const handleTouchCancel = (e: TouchEvent) => {
         // 터치 취소 시 플래그 리셋
         isMultiTouch = false
         e.preventDefault()
         e.stopPropagation()
      }

      // 터치 이벤트 리스너 추가 (passive: false로 preventDefault 허용, capture: true로 먼저 처리)
      scrollEl.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true })
      scrollEl.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
      scrollEl.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true })
      scrollEl.addEventListener('touchcancel', handleTouchCancel, { passive: false, capture: true })

      return () => {
         scrollEl.removeEventListener('touchstart', handleTouchStart, true)
         scrollEl.removeEventListener('touchmove', handleTouchMove, true)
         scrollEl.removeEventListener('touchend', handleTouchEnd, true)
         scrollEl.removeEventListener('touchcancel', handleTouchCancel, true)
      }
   }, [])

   const sizeKey = useMemo(() => {
      if (!pageSize) return null
      return `${Math.round(pageSize.w)}x${Math.round(pageSize.h)}`
   }, [pageSize])

   useEffect(() => {
      if (!doc) return
      if (!pageSize) return
      if (numPages <= 0) return

      const pdfDoc = doc
      const size = pageSize
      const loopId = ++renderLoopIdRef.current
      const renderTasks: Array<{ cancel: () => void } | null> = new Array(numPages).fill(null)
      let cancelled = false

      const currentSizeKey = `${Math.round(size.w)}x${Math.round(size.h)}@${viewZoom.toFixed(2)}`
      if (lastSizeKeyRef.current !== currentSizeKey) {
         // 줌/리사이즈로 페이지 크기가 바뀌면: 캐시 초기화 + 캔버스 깨끗이
         renderedPagesRef.current.clear()
         inflightPagesRef.current.clear()
         lastSizeKeyRef.current = currentSizeKey

         for (const c of canvasRefs.current) {
            if (!c) continue
            c.dataset.sizeKey = currentSizeKey
            const ctx = c.getContext('2d')
            if (ctx) ctx.clearRect(0, 0, c.width, c.height)
         }
      }

      const waitForCanvas = async (index: number, maxFrames = 180) => {
         // react-pageflip이 DOM을 늦게 구성하는 경우가 있어, ref가 붙을 때까지 잠시 대기
         for (let i = 0; i < maxFrames; i++) {
            if (cancelled) return null
            if (renderLoopIdRef.current !== loopId) return null
            const c = canvasRefs.current[index]
            if (c) return c
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
         }
         return null
      }

      const renderOne = async (pageNo: number) => {
         if (cancelled) return
         if (pageNo < 1 || pageNo > numPages) return
         if (renderLoopIdRef.current !== loopId) return

         const renderedPages = renderedPagesRef.current
         const inflightPages = inflightPagesRef.current
         if (renderedPages.has(pageNo) || inflightPages.has(pageNo)) return
         inflightPages.add(pageNo)

         // 줌 시 글자가 뭉개지지 않게 DPR을 줌에 맞춰 올리되, 상한을 둠(메모리 폭주 방지)
         const baseDpr = Math.max(1, window.devicePixelRatio || 1)
         const dpr = Math.min(3, baseDpr * Math.min(1.6, viewZoom))

         const canvas = await waitForCanvas(pageNo - 1)
         if (!canvas) {
            inflightPages.delete(pageNo)
            return
         }

         const page = await pdfDoc.getPage(pageNo)
         if (cancelled) {
            inflightPages.delete(pageNo)
            return
         }

         const vp1 = page.getViewport({ scale: 1 })
         const scale = size.w / vp1.width
         const viewport = page.getViewport({ scale: scale * dpr })

         // 같은 사이즈키로 이미 그렸으면(애니메이션 중 깜빡임 방지) 건드리지 않음
         if (canvas.dataset.sizeKey !== currentSizeKey) {
            canvas.dataset.sizeKey = currentSizeKey
         }

         const nextW = Math.floor(viewport.width)
         const nextH = Math.floor(viewport.height)
         if (canvas.width !== nextW) canvas.width = nextW
         if (canvas.height !== nextH) canvas.height = nextH
         if (canvas.style.width !== `${size.w}px`) canvas.style.width = `${size.w}px`
         if (canvas.style.height !== `${size.h}px`) canvas.style.height = `${size.h}px`

         const ctx = canvas.getContext('2d', { alpha: false })
         if (!ctx) {
            inflightPages.delete(pageNo)
            return
         }

         try {
            const task = page.render({ canvasContext: ctx, viewport })
            renderTasks[pageNo - 1] = task
            await task.promise
            renderedPages.add(pageNo)
         } catch (e) {
            // 빠른 넘김/리렌더 과정에서 발생하는 취소는 정상 케이스라 조용히 무시
            const name = (e as any)?.name
            const msg = (e as any)?.message
            if (name === 'RenderingCancelledException' || (typeof msg === 'string' && msg.includes('Rendering cancelled'))) {
               // noop
            } else {
               // eslint-disable-next-line no-console
               console.error(`[EbookFlipbook] render error (page ${pageNo}):`, e)
            }
         } finally {
            inflightPages.delete(pageNo)
         }
      }

      const renderWindow = async () => {
         // 두 페이지 스프레드 기준으로 현재/주변만 선렌더링 (답답함 방지)
         const current = Math.max(0, Math.min(numPages - 1, pageIndexRef.current))
         const currentPageNo = current + 1
         const want = new Set<number>()

         // 현재 스프레드(2장) + 앞뒤 버퍼
         const start = Math.max(1, currentPageNo - (isNarrow ? 2 : 4))
         const end = Math.min(numPages, currentPageNo + (isNarrow ? 4 : 10))
         for (let p = start; p <= end; p++) want.add(p)

         const renderedPages = renderedPagesRef.current
         setStatus({ state: 'rendering', rendered: renderedPages.size, total: numPages })
         for (const p of want) {
            if (cancelled) return
            // eslint-disable-next-line no-await-in-loop
            await renderOne(p)
            setStatus({ state: 'rendering', rendered: renderedPages.size, total: numPages })
         }

         // 최소한 현재 페이지가 렌더되면 ready로 전환
         if (renderedPages.has(currentPageNo) || renderedPages.has(currentPageNo + 1) || renderedPages.has(currentPageNo - 1)) {
            setStatus({ state: 'ready' })
         }
      }

      const schedule = () => {
         if (cancelled) return
         if (scheduleTimerRef.current) window.clearTimeout(scheduleTimerRef.current)
         // 다다다닥 넘길 때 렌더를 모아서(애니메이션 이후) 한 번만 수행
         scheduleTimerRef.current = window.setTimeout(() => {
            void renderWindow()
         }, 160)
      }
      scheduleRenderRef.current = schedule

      // 최초 1회 + zoom 변경 시 보충 렌더
      schedule()

      return () => {
         cancelled = true
         scheduleRenderRef.current = null
         if (scheduleTimerRef.current) window.clearTimeout(scheduleTimerRef.current)
         for (const t of renderTasks) t?.cancel?.()
      }
   }, [doc, numPages, pageSize, isNarrow, viewZoom])

   const canUseFlipbook = status.state !== 'error' && numPages > 0 && pageSize && pageSize.w > 10 && pageSize.h > 10

   const currentPageLabel = useMemo(() => {
      // react-pageflip은 내부적으로 0-based page index
      const total = Math.max(1, numPages)
      const left = Math.min(total, Math.max(1, pageIndex + 1))
      if (isNarrow) return `${left} / ${total}`
      const right = Math.min(total, left + 1)
      return right === left ? `${left} / ${total}` : `${left}-${right} / ${total}`
   }, [isNarrow, pageIndex, numPages])

   const zoomLabel = `${Math.round(viewZoom * 100)}%`
   const canZoomOut = viewZoom > 0.7
   const canZoomIn = viewZoom < 2.5

   const startAutoFlip = (dir: 'next' | 'prev') => {
      if (!canUseFlipbook) return
      // 길게 누르면 여러 장이 부드럽게 "촤르륵" 넘어가게
      if (autoFlipTimerRef.current) window.clearInterval(autoFlipTimerRef.current)
      autoFlipTimerRef.current = window.setInterval(() => {
         if (dir === 'next') flipbookRef.current?.pageFlip().flipNext()
         else flipbookRef.current?.pageFlip().flipPrev()
      }, 180)
   }

   const stopAutoFlip = () => {
      if (!autoFlipTimerRef.current) return
      window.clearInterval(autoFlipTimerRef.current)
      autoFlipTimerRef.current = null
   }

   return (
      <section ref={containerRef} className={cn('flex h-dvh w-dvw flex-col bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50', className)}>
         {/* 컨트롤 바(항상 상단 고정 - 줌 영향 받지 않음) */}
         <div className="fixed top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 md:gap-3 md:px-3 md:py-3 md:px-5">
            <div className="flex items-center gap-1 md:gap-2">
               <Button
                  variant="secondary"
                  className="h-9 px-3 text-sm md:h-12 md:px-4 md:text-base"
                  onClick={() => flipbookRef.current?.pageFlip().flipPrev()}
                  onPointerDown={() => startAutoFlip('prev')}
                  onPointerUp={stopAutoFlip}
                  onPointerCancel={stopAutoFlip}
                  onPointerLeave={stopAutoFlip}
                  disabled={!canUseFlipbook}
               >
                  <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="hidden sm:inline">이전</span>
               </Button>
               <Button
                  variant="secondary"
                  className="h-9 px-3 text-sm md:h-12 md:px-4 md:text-base"
                  onClick={() => flipbookRef.current?.pageFlip().flipNext()}
                  onPointerDown={() => startAutoFlip('next')}
                  onPointerUp={stopAutoFlip}
                  onPointerCancel={stopAutoFlip}
                  onPointerLeave={stopAutoFlip}
                  disabled={!canUseFlipbook}
               >
                  <span className="hidden sm:inline">다음</span>
                  <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
               </Button>
            </div>

            <div className="flex items-center gap-1 md:gap-3">
               <div className="text-sm font-semibold tabular-nums md:text-base">{currentPageLabel}</div>

               <div className="flex items-center gap-1 md:gap-2">
                  <Button variant="outline" className="h-8 w-8 p-0 md:h-12 md:w-12" onClick={() => setViewZoom((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))} disabled={!canUseFlipbook || !canZoomOut} aria-label="축소">
                     <Minus className="h-3 w-3 md:h-4 md:w-4" />
                  </Button>
                  <div className="min-w-12 text-center text-xs font-semibold tabular-nums md:min-w-20 md:text-base">{zoomLabel}</div>
                  <Button variant="outline" className="h-8 w-8 p-0 md:h-12 md:w-12" onClick={() => setViewZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))} disabled={!canUseFlipbook || !canZoomIn} aria-label="확대">
                     <Plus className="h-3 w-3 md:h-4 md:w-4" />
                  </Button>
               </div>
            </div>
         </div>

         {status.state === 'error' ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">{status.message}</div> : null}

         {status.state === 'loading' ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-base text-zinc-700 dark:text-zinc-200">
               <Loader2 className="animate-spin" />
               PDF 불러오는 중…
            </div>
         ) : null}

         {canUseFlipbook ? (
            <div
               ref={scrollRef}
               className="no-scrollbar relative flex flex-1 items-center justify-center overflow-auto pt-[84px] p-3 md:p-6"
               style={{
                  cursor: viewZoom > 1 ? (isPanning ? 'grabbing' : panBySpace ? 'grab' : 'default') : 'default',
               }}
               onPointerDown={(e) => {
                  if (viewZoom <= 1) return
                  const el = scrollRef.current
                  if (!el) return
                  const targetEl = e.target as HTMLElement | null
                  const insideFlipbook = !!targetEl?.closest('.flipbook')
                  // 기본은 페이지 드래그(넘김)를 우선, 스페이스를 누르거나 책 밖에서만 패닝
                  const shouldPan = panBySpace || !insideFlipbook
                  if (!shouldPan) return
                  dragScrollRef.current.active = true
                  dragScrollRef.current.x = e.clientX
                  dragScrollRef.current.y = e.clientY
                  dragScrollRef.current.left = el.scrollLeft
                  dragScrollRef.current.top = el.scrollTop
                  setIsPanning(true)
                  ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
                  e.preventDefault()
                  e.stopPropagation()
               }}
               onPointerMove={(e) => {
                  if (!dragScrollRef.current.active) return
                  const el = scrollRef.current
                  if (!el) return
                  const dx = e.clientX - dragScrollRef.current.x
                  const dy = e.clientY - dragScrollRef.current.y
                  el.scrollLeft = dragScrollRef.current.left - dx
                  el.scrollTop = dragScrollRef.current.top - dy
                  e.preventDefault()
                  e.stopPropagation()
               }}
               onPointerUp={() => {
                  dragScrollRef.current.active = false
                  setIsPanning(false)
               }}
               onPointerCancel={() => {
                  dragScrollRef.current.active = false
                  setIsPanning(false)
               }}
            >
               <div className="flex items-center justify-center">
                  <HTMLFlipBook
                     key={`${sizeKey ?? 'no-size'}-${isNarrow ? 'single' : 'spread'}`}
                     ref={flipbookRef as unknown as React.Ref<unknown>}
                     width={Math.round(pageSize.w)}
                     height={Math.round(pageSize.h)}
                     startPage={pageIndex}
                     showCover={false}
                     usePortrait={isNarrow}
                     mobileScrollSupport={false}
                     disableFlipByClick={true}
                     maxShadowOpacity={0.22}
                     className="flipbook"
                     onFlip={(e: { data: number }) => {
                        setPageIndex(e.data)
                        pageIndexRef.current = e.data
                        scheduleRenderRef.current?.()
                     }}
                  >
                     {Array.from({ length: numPages }).map((_, idx) => (
                        <div key={idx} className="page flex h-full w-full items-center justify-center bg-white dark:bg-zinc-950">
                           <canvas
                              ref={(el) => {
                                 canvasRefs.current[idx] = el
                              }}
                              className="block h-full w-full rounded-sm"
                           />
                        </div>
                     ))}
                  </HTMLFlipBook>
               </div>
            </div>
         ) : null}

         {/* 렌더링 진행은 어르신 UI에서 방해되지 않게 숨김(콘솔로만) */}
      </section>
   )
}
