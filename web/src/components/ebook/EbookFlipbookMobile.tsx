'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HTMLFlipBook from 'react-pageflip'
import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { MobileControls } from './MobileControls'

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

export default function EbookFlipbookMobile({ pdfUrl, className }: EbookFlipbookProps) {
   const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize<HTMLDivElement>()

   const flipbookRef = useRef<PageFlipApi | null>(null)
   const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([])
   const renderedPagesRef = useRef<Set<number>>(new Set())
   const inflightPagesRef = useRef<Set<number>>(new Set())
   const renderLoopIdRef = useRef(0)
   const lastSizeKeyRef = useRef<string | null>(null)
   const scheduleTimerRef = useRef<number | null>(null)
   const scheduleRenderRef = useRef<(() => void) | null>(null)
   const pageIndexRef = useRef(0)
   const scrollContainerRef = useRef<HTMLDivElement | null>(null)
   const lastNavAtRef = useRef(0)

   const [reloadNonce, setReloadNonce] = useState(0)
   const [doc, setDoc] = useState<PdfDocument | null>(null)
   const [numPages, setNumPages] = useState(0)
   const [pageIndex, setPageIndex] = useState(0)
   const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null)
   const [pageRatio, setPageRatio] = useState<number | null>(null)
   const [viewZoom, setViewZoom] = useState(1.0)

   const [status, setStatus] = useState<{ state: 'idle' } | { state: 'loading' } | { state: 'rendering'; rendered: number; total: number } | { state: 'ready' } | { state: 'error'; message: string }>({ state: 'idle' })

   const controlsH = 60

   const targetPageSize = useMemo(() => {
      if (!pageRatio) return null

      const padX = 8
      const padY = 8
      const availableW = Math.max(0, containerWidth - padX * 2)
      const availableH = Math.max(0, containerHeight - controlsH - padY * 2)
      if (availableW <= 0 || availableH <= 0) return null

      const maxWByWidth = availableW
      const maxWByHeight = pageRatio > 0 ? availableH / pageRatio : maxWByWidth
      const baseW = Math.max(0, Math.min(maxWByWidth, maxWByHeight))

      const w = baseW * viewZoom
      const h = w * pageRatio

      return { w, h }
   }, [containerWidth, containerHeight, controlsH, pageRatio, viewZoom])

   const sizeKey = useMemo(() => {
      if (!pageSize) return null
      return `${Math.round(pageSize.w)}x${Math.round(pageSize.h)}`
   }, [pageSize])

   useEffect(() => {
      if (!targetPageSize) return
      setPageSize(targetPageSize)
   }, [targetPageSize])

   useEffect(() => {
      pageIndexRef.current = pageIndex
   }, [pageIndex])

   const getFlipbookPageIndex = useCallback(() => {
      try {
         const api = flipbookRef.current?.pageFlip?.()
         const idx = api?.getCurrentPageIndex?.()
         return typeof idx === 'number' && Number.isFinite(idx) ? idx : null
      } catch {
         return null
      }
   }, [])

   const syncPageIndexFromFlipbook = useCallback(() => {
      const idx = getFlipbookPageIndex()
      if (idx == null) return
      setPageIndex((prev) => (prev === idx ? prev : idx))
      pageIndexRef.current = idx
   }, [getFlipbookPageIndex])

   const syncAfterFlip = useCallback(() => {
      // react-pageflip이 programmatic flip에서 onFlip 이벤트를 누락하는 환경이 있어
      // 애니메이션 전/후로 한 번씩 현재 페이지 인덱스를 강제 동기화
      requestAnimationFrame(() => syncPageIndexFromFlipbook())
      window.setTimeout(() => syncPageIndexFromFlipbook(), 220)
   }, [syncPageIndexFromFlipbook])

   const navTo = useCallback(
      (dir: 'prev' | 'next') => {
         const api = flipbookRef.current?.pageFlip?.()
         if (!api) return

         // 모바일에서 pointerup/click 등 중복 트리거로 2번 실행되는 케이스 방지
         const now = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) as number
         if (now - lastNavAtRef.current < 240) return
         lastNavAtRef.current = now

         const current = api.getCurrentPageIndex?.()
         const curIdx = typeof current === 'number' && Number.isFinite(current) ? current : pageIndexRef.current
         const targetRaw = dir === 'next' ? curIdx + 1 : curIdx - 1
         const target = Math.max(0, Math.min(Math.max(0, numPages - 1), targetRaw))

         if (target === curIdx) return
         api.turnToPage(target)
         syncAfterFlip()
         scheduleRenderRef.current?.()
      },
      [numPages, syncAfterFlip]
   )

   const flipPrev = useCallback(() => navTo('prev'), [navTo])
   const flipNext = useCallback(() => navTo('next'), [navTo])

   useEffect(() => {
      const el = scrollContainerRef.current
      if (!el || !pageSize) return
      requestAnimationFrame(() => {
         if (viewZoom > 1) {
            el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
            el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
         } else {
            el.scrollTop = 0
            el.scrollLeft = 0
         }
      })
   }, [viewZoom, pageSize])

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
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
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
         const current = Math.max(0, Math.min(numPages - 1, pageIndexRef.current))
         const currentPageNo = current + 1
         const want = new Set<number>()

         const start = Math.max(1, currentPageNo - 2)
         const end = Math.min(numPages, currentPageNo + 4)
         for (let p = start; p <= end; p++) want.add(p)

         const renderedPages = renderedPagesRef.current
         // 진행률 UI를 표시하지 않으므로(현재는 로딩/에러만 노출), 과도한 setState를 줄여 모바일 성능 최적화
         setStatus({ state: 'rendering', rendered: renderedPages.size, total: numPages })
         for (const p of want) {
            if (cancelled) return
            // eslint-disable-next-line no-await-in-loop
            await renderOne(p)
         }

         if (renderedPages.has(currentPageNo) || renderedPages.has(currentPageNo + 1) || renderedPages.has(currentPageNo - 1)) {
            setStatus({ state: 'ready' })
         }
      }

      const schedule = () => {
         if (cancelled) return
         if (scheduleTimerRef.current) window.clearTimeout(scheduleTimerRef.current)
         scheduleTimerRef.current = window.setTimeout(() => {
            void renderWindow()
         }, 160)
      }
      scheduleRenderRef.current = schedule

      schedule()

      return () => {
         cancelled = true
         scheduleRenderRef.current = null
         if (scheduleTimerRef.current) window.clearTimeout(scheduleTimerRef.current)
         for (const t of renderTasks) t?.cancel?.()
      }
   }, [doc, numPages, pageSize, viewZoom])

   const canUseFlipbook = status.state !== 'error' && numPages > 0 && pageSize && pageSize.w > 10 && pageSize.h > 10

   useEffect(() => {
      if (!canUseFlipbook) return
      // 최초 1회 동기화(버튼 disabled 상태가 실제 페이지와 어긋나는 문제 방지)
      requestAnimationFrame(() => syncPageIndexFromFlipbook())
   }, [canUseFlipbook, syncPageIndexFromFlipbook])

   const currentPageLabel = useMemo(() => {
      const total = Math.max(1, numPages)
      const current = Math.min(total, Math.max(1, pageIndex + 1))
      return `${current} / ${total}`
   }, [pageIndex, numPages])

   const zoomLabel = `${Math.round(viewZoom * 100)}%`
   const canZoomOut = viewZoom > 0.7
   const canZoomIn = viewZoom < 2.5

   // 모바일 입력 제어: globals.css에서 `.flipbook { pointer-events: none }` 처리되어 있어
   // 실제 입력은 `.flipbook-overlay`에서 받아 좌/우 탭(마우스 클릭 포함)으로 페이지를 넘긴다.
   const handleOverlayClick = useCallback(
      (clientX: number) => {
         if (!canUseFlipbook) return
         // 확대 상태에서는 탭 넘김 비활성(패닝/스크롤 우선)
         if (viewZoom > 1) return
         const viewportWidth = window.innerWidth || 1
         const isLeftSide = clientX < viewportWidth / 2
         if (isLeftSide) flipPrev()
         else flipNext()
      },
      [canUseFlipbook, flipNext, flipPrev, viewZoom]
   )

   return (
      <section ref={containerRef} className={cn('relative flex h-dvh w-dvw flex-col overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50', className)}>
         <div data-controls className="relative z-20">
            <MobileControls
               currentPageLabel={currentPageLabel}
               zoomLabel={zoomLabel}
               canZoomOut={canZoomOut}
               canZoomIn={canZoomIn}
               canPrevPage={!!canUseFlipbook && pageIndex > 0}
               canNextPage={!!canUseFlipbook && pageIndex < numPages - 1}
               onPrevPage={flipPrev}
               onNextPage={flipNext}
               onZoomOut={() => setViewZoom((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10))}
               onZoomIn={() => setViewZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}
            />
         </div>

         {status.state === 'error' ? (
            <div className="flex flex-1 items-center justify-center p-4">
               <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">{status.message}</div>
            </div>
         ) : null}

         {status.state === 'loading' ? (
            <div className="flex flex-1 items-center justify-center gap-3 text-base text-zinc-700 dark:text-zinc-200">
               <Loader2 className="animate-spin" />
               PDF 불러오는 중…
            </div>
         ) : null}

         {canUseFlipbook ? (
            <div
               ref={scrollContainerRef}
               className="no-scrollbar relative flex-1 overflow-auto"
               style={{
                  touchAction: viewZoom > 1 ? 'pan-x pan-y' : 'manipulation',
               }}
            >
               <div className="relative flex min-h-full items-center justify-center p-2">
                  {/* 모바일 입력 오버레이: CSS(.flipbook-overlay)와 짝이 맞아야 함 */}
                  <div
                     className="flipbook-overlay"
                     aria-hidden="true"
                     onPointerUp={(e) => {
                        // 모바일/데스크톱 모두 안정적으로 받기 위해 pointer도 처리
                        if (e.pointerType === 'touch' || e.pointerType === 'mouse' || e.pointerType === 'pen') {
                           e.preventDefault()
                           e.stopPropagation()
                           handleOverlayClick(e.clientX)
                        }
                     }}
                  />

                  <HTMLFlipBook
                     key={`${sizeKey ?? 'no-size'}-mobile-${viewZoom.toFixed(2)}`}
                     ref={flipbookRef as unknown as React.Ref<unknown>}
                     width={Math.round(pageSize.w)}
                     height={Math.round(pageSize.h)}
                     startPage={pageIndex}
                     showCover={false}
                     usePortrait={true}
                     mobileScrollSupport={false}
                     disableFlipByClick={true}
                     maxShadowOpacity={0.0}
                     className="flipbook"
                     onFlip={(e: { data: number }) => {
                        setPageIndex(e.data)
                        pageIndexRef.current = e.data
                        scheduleRenderRef.current?.()
                        syncAfterFlip()
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
      </section>
   )
}
