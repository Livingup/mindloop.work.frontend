import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PropsWithChildren,
} from "react"
import { createPortal } from "react-dom"

import { cn, themeClassNames } from "@/shared/theme/classes"

export type AppConfirmTone = "primary" | "warning" | "danger"
export type AppNotificationTone = "info" | "success" | "warning" | "error"

export type AppConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: AppConfirmTone
  dismissOnBackdrop?: boolean
  focusFallback?: () => HTMLElement | null
  preferFocusFallback?: boolean
}

export type AppNotificationOptions = {
  title?: string
  message: string
  tone?: AppNotificationTone
}

type ConfirmRequest = {
  id: number
  options: AppConfirmOptions
  origin: HTMLElement | null
  resolve: (confirmed: boolean) => void
  settled: boolean
  resolved: boolean
}

type ConfirmSettlement = {
  request: ConfirmRequest
  confirmed: boolean
}

type AppNotification = Required<Pick<AppNotificationOptions, "message" | "tone">> & {
  id: string
  title?: string
  repeatCount: number
}

type AppNotificationOverflow = AppNotification & {
  overflowCount: number
  latestSignature: string
}

type AppNotificationQueueState = {
  visible: AppNotification[]
  pending: AppNotification[]
  overflow: AppNotificationOverflow | null
}

type AppInteractionApi = {
  confirm: (options: AppConfirmOptions) => Promise<boolean>
  notify: (options: AppNotificationOptions) => string
  dismissNotification: (notificationId: string) => void
}

const MAX_CONFIRM_QUEUE_LENGTH = 16
const MAX_NOTIFICATION_COUNT = 6
const MAX_PENDING_NOTIFICATION_COUNT = 24
const MAX_REGULAR_NOTIFICATION_COUNT = MAX_NOTIFICATION_COUNT - 1 + MAX_PENDING_NOTIFICATION_COUNT
const MAX_NOTIFICATION_TOTAL_COUNT = MAX_REGULAR_NOTIFICATION_COUNT + 1
const NOTIFICATION_OVERFLOW_ID = "app-notification-overflow"
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

const missingProviderApi: AppInteractionApi = {
  confirm: async () => {
    console.error("[interaction] AppInteractionProvider is missing; confirmation cancelled safely.")
    return false
  },
  notify: (options) => {
    console.error("[interaction] AppInteractionProvider is missing; notification could not be displayed.", options)
    return ""
  },
  dismissNotification: () => undefined,
}

const AppInteractionContext = createContext<AppInteractionApi | null>(null)

export function AppInteractionProvider({ children }: PropsWithChildren) {
  const [activeConfirm, setActiveConfirm] = useState<ConfirmRequest | null>(null)
  const [notificationQueue, setNotificationQueue] = useState<AppNotificationQueueState>(createEmptyNotificationQueue)
  const notificationQueueRef = useRef(notificationQueue)
  const activeConfirmRef = useRef<ConfirmRequest | null>(null)
  const confirmQueueRef = useRef<ConfirmRequest[]>([])
  const pendingSettlementRef = useRef<ConfirmSettlement | null>(null)
  const unmountedRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const notificationSequenceRef = useRef(0)

  const activateConfirm = useCallback((request: ConfirmRequest) => {
    activeConfirmRef.current = request
    setActiveConfirm(request)
  }, [])

  const confirm = useCallback((options: AppConfirmOptions) => new Promise<boolean>((resolve) => {
    if (unmountedRef.current) {
      console.error("[interaction] confirmation requested after provider unmount; cancelled safely.")
      resolve(false)
      return
    }
    const request: ConfirmRequest = {
      id: ++requestSequenceRef.current,
      options,
      origin: readFocusableActiveElement(),
      resolve,
      settled: false,
      resolved: false,
    }
    if (!activeConfirmRef.current && !pendingSettlementRef.current) {
      activateConfirm(request)
      return
    }
    if (confirmQueueRef.current.length >= MAX_CONFIRM_QUEUE_LENGTH) {
      console.error("[interaction] confirmation queue limit reached; request cancelled safely.", options.title)
      request.resolved = true
      resolve(false)
      return
    }
    confirmQueueRef.current.push(request)
  }), [activateConfirm])

  const notify = useCallback((options: AppNotificationOptions) => {
    if (unmountedRef.current) {
      console.error("[interaction] notification requested after provider unmount.", options)
      return ""
    }
    const id = `app-notification-${Date.now()}-${++notificationSequenceRef.current}`
    const notification: AppNotification = {
      id,
      title: options.title,
      message: options.message,
      tone: options.tone ?? "info",
      repeatCount: 1,
    }
    const result = enqueueNotification(notificationQueueRef.current, notification)
    notificationQueueRef.current = result.queue
    setNotificationQueue(result.queue)
    return result.notificationId
  }, [])

  const dismissNotification = useCallback((notificationId: string) => {
    const next = dismissQueuedNotification(notificationQueueRef.current, notificationId)
    notificationQueueRef.current = next
    setNotificationQueue(next)
  }, [])

  const settleActiveConfirm = useCallback((confirmed: boolean) => {
    const request = activeConfirmRef.current
    if (!request || request.settled || request.resolved) return
    request.settled = true
    activeConfirmRef.current = null
    pendingSettlementRef.current = { request, confirmed }
    setActiveConfirm(null)
  }, [])

  useLayoutEffect(() => {
    if (activeConfirm !== null) return
    const settlement = pendingSettlementRef.current
    if (!settlement) return
    pendingSettlementRef.current = null
    restoreRequestFocus(settlement.request)
    resolveConfirmRequest(settlement.request, settlement.confirmed)
    const next = confirmQueueRef.current.shift() ?? null
    if (next) activateConfirm(next)
  }, [activeConfirm, activateConfirm])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      const unresolved = [
        activeConfirmRef.current,
        pendingSettlementRef.current?.request ?? null,
        ...confirmQueueRef.current,
      ]
      activeConfirmRef.current = null
      pendingSettlementRef.current = null
      confirmQueueRef.current = []
      notificationQueueRef.current = createEmptyNotificationQueue()
      for (const request of unresolved) {
        if (request) resolveConfirmRequest(request, false)
      }
    }
  }, [])

  const api = useMemo<AppInteractionApi>(() => ({
    confirm,
    notify,
    dismissNotification,
  }), [confirm, dismissNotification, notify])

  const portal = typeof document === "undefined"
    ? null
    : createPortal(
        <>
          {activeConfirm ? (
            <AppConfirmDialog
              request={activeConfirm}
              onConfirm={() => settleActiveConfirm(true)}
              onCancel={() => settleActiveConfirm(false)}
            />
          ) : null}
          {activeConfirm ? null : (
            <AppNotificationRegion queue={notificationQueue} onDismiss={dismissNotification} />
          )}
        </>,
        document.body,
      )

  return (
    <AppInteractionContext.Provider value={api}>
      {children}
      {portal}
    </AppInteractionContext.Provider>
  )
}

export function useAppInteraction() {
  return useContext(AppInteractionContext) ?? missingProviderApi
}

export function useAppConfirm() {
  return useAppInteraction().confirm
}

export function useAppNotification() {
  const { notify, dismissNotification } = useAppInteraction()
  return { notify, dismissNotification }
}

function AppConfirmDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const tone = request.options.tone ?? "primary"
  const dismissOnBackdrop = request.options.dismissOnBackdrop ?? true

  useLayoutEffect(() => {
    const root = document.getElementById("root") as (HTMLElement & { inert: boolean }) | null
    const previousRootInert = root?.inert ?? false
    const previousAriaHidden = root?.getAttribute("aria-hidden") ?? null
    if (root) {
      root.inert = true
      root.setAttribute("aria-hidden", "true")
    }
    const initialTarget = cancelButtonRef.current ?? panelRef.current
    initialTarget?.focus({ preventScroll: true })
    return () => {
      if (!root) return
      root.inert = previousRootInert
      if (previousAriaHidden === null) root.removeAttribute("aria-hidden")
      else root.setAttribute("aria-hidden", previousAriaHidden)
    }
  }, [request.id])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== "Tab") return
    const focusable = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusableElement)
      : []
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current?.focus({ preventScroll: true })
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeElement = document.activeElement
    if (event.shiftKey && activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  return (
    <div
      className={cn("fixed inset-0 z-[80] flex items-center justify-center px-4 py-6", themeClassNames.layout.modalOverlay)}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={panelRef}
        role={tone === "danger" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-lg rounded-2xl border border-app-border/80 bg-app-surface p-5 text-app-primary shadow-2xl shadow-app-overlay/20 outline-none sm:p-6"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭对话框"
          className={cn("absolute right-3 top-3 size-8", themeClassNames.button.icon)}
        >
          <X size={16} />
        </button>
        <div className="pr-8">
          <h2 id={titleId} className="text-base font-semibold text-app-primary">
            {request.options.title}
          </h2>
          <p id={descriptionId} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-app-secondary">
            {request.options.description}
          </p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className={cn("min-h-10 px-4", themeClassNames.button.secondary)}
          >
            {request.options.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn("min-h-10 px-4", confirmButtonClassName(tone))}
          >
            {request.options.confirmLabel ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  )
}

function AppNotificationRegion({
  queue,
  onDismiss,
}: {
  queue: AppNotificationQueueState
  onDismiss: (notificationId: string) => void
}) {
  const notifications = queue.overflow ? [...queue.visible, queue.overflow] : queue.visible
  if (notifications.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-12 z-[90] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-[min(26rem,calc(100vw-2rem))]"
      aria-label="应用通知"
    >
      {notifications.map((notification) => (
        <article
          key={notification.id}
          role={notification.tone === "error" || notification.tone === "warning" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto w-full rounded-xl border bg-app-surface/95 p-3 text-app-primary shadow-xl shadow-app-overlay/12 backdrop-blur",
            notificationClassName(notification.tone),
          )}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {notificationIcon(notification.tone)}
            </span>
            <div className="min-w-0 flex-1">
              {notification.title ? <h2 className="text-sm font-semibold">{notification.title}</h2> : null}
              <p className={cn("whitespace-pre-wrap text-sm leading-5", notification.title ? "mt-1" : "")}>
                {notification.message}
              </p>
              {notification.repeatCount > 1 ? (
                <p className="mt-1 text-xs opacity-80">同源通知已合并 {notification.repeatCount} 次。</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(notification.id)}
              aria-label="关闭通知"
              className={cn("size-7 shrink-0", themeClassNames.button.icon)}
            >
              <X size={14} />
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function createEmptyNotificationQueue(): AppNotificationQueueState {
  return { visible: [], pending: [], overflow: null }
}

function enqueueNotification(
  current: AppNotificationQueueState,
  incoming: AppNotification,
 ): { queue: AppNotificationQueueState; notificationId: string } {
  const regular = [...current.visible, ...current.pending]
  const incomingSignature = notificationSignature(incoming)
  const duplicateIndex = regular.findIndex((notification) => notificationSignature(notification) === incomingSignature)
  if (duplicateIndex >= 0) {
    const duplicate = regular[duplicateIndex]
    regular[duplicateIndex] = { ...duplicate, repeatCount: duplicate.repeatCount + 1 }
    let overflow = current.overflow
    if (regular.length >= MAX_REGULAR_NOTIFICATION_COUNT) {
      overflow = mergeNotificationOverflow(overflow, incoming)
      console.warn("[interaction] notification queue full; same-source notification merged.", {
        title: incoming.title,
        tone: incoming.tone,
        overflowCount: overflow.overflowCount,
        totalCapacity: MAX_NOTIFICATION_TOTAL_COUNT,
      })
    }
    return {
      queue: partitionNotificationQueue(regular, overflow),
      notificationId: duplicate.id,
    }
  }

  if (current.overflow?.latestSignature === incomingSignature) {
    const overflow = mergeNotificationOverflow(current.overflow, incoming)
    console.warn("[interaction] notification queue full; repeated overflow notification merged.", {
      title: incoming.title,
      tone: incoming.tone,
      overflowCount: overflow.overflowCount,
      totalCapacity: MAX_NOTIFICATION_TOTAL_COUNT,
    })
    return { queue: partitionNotificationQueue(regular, overflow), notificationId: overflow.id }
  }

  if (regular.length < MAX_REGULAR_NOTIFICATION_COUNT) {
    regular.push(incoming)
    return { queue: partitionNotificationQueue(regular, current.overflow), notificationId: incoming.id }
  }

  if (isPersistentNotificationTone(incoming.tone)) {
    const replaceableIndex = regular.findIndex((notification) => !isPersistentNotificationTone(notification.tone))
    if (replaceableIndex >= 0) {
      const displaced = regular[replaceableIndex]
      regular[replaceableIndex] = incoming
      const overflow = mergeNotificationOverflow(current.overflow, displaced)
      console.warn("[interaction] notification queue full; transient notification summarized to retain persistent alert.", {
        displacedTitle: displaced.title,
        incomingTitle: incoming.title,
        overflowCount: overflow.overflowCount,
        totalCapacity: MAX_NOTIFICATION_TOTAL_COUNT,
      })
      return { queue: partitionNotificationQueue(regular, overflow), notificationId: incoming.id }
    }
  }

  const overflow = mergeNotificationOverflow(current.overflow, incoming)
  const diagnostic = {
    title: incoming.title,
    tone: incoming.tone,
    overflowCount: overflow.overflowCount,
    totalCapacity: MAX_NOTIFICATION_TOTAL_COUNT,
  }
  if (isPersistentNotificationTone(incoming.tone)) {
    console.error("[interaction] notification queue capacity reached; persistent alert summarized in overflow notice.", diagnostic)
  } else {
    console.warn("[interaction] notification queue capacity reached; notification summarized in overflow notice.", diagnostic)
  }
  return { queue: partitionNotificationQueue(regular, overflow), notificationId: overflow.id }
}

function dismissQueuedNotification(
  current: AppNotificationQueueState,
  notificationId: string,
 ): AppNotificationQueueState {
  const regular = [...current.visible, ...current.pending].filter((notification) => notification.id !== notificationId)
  const overflow = current.overflow?.id === notificationId ? null : current.overflow
  return partitionNotificationQueue(regular, overflow)
}

function partitionNotificationQueue(
  regular: AppNotification[],
  overflow: AppNotificationOverflow | null,
 ): AppNotificationQueueState {
  const visibleLimit = overflow ? MAX_NOTIFICATION_COUNT - 1 : MAX_NOTIFICATION_COUNT
  return {
    visible: regular.slice(0, visibleLimit),
    pending: regular.slice(visibleLimit, visibleLimit + MAX_PENDING_NOTIFICATION_COUNT),
    overflow,
  }
}

function mergeNotificationOverflow(
  current: AppNotificationOverflow | null,
  notification: AppNotification,
 ): AppNotificationOverflow {
  const overflowCount = (current?.overflowCount ?? 0) + 1
  const latestTitle = notification.title?.trim()
  const latestLabel = latestTitle ? `${latestTitle}：${notification.message}` : notification.message
  return {
    id: NOTIFICATION_OVERFLOW_ID,
    title: "通知队列已达上限",
    message: `另有 ${overflowCount} 条通知被合并/未展示。最新一条：${latestLabel}`,
    tone: current?.tone === "error" || notification.tone === "error" ? "error" : "warning",
    repeatCount: 1,
    overflowCount,
    latestSignature: notificationSignature(notification),
  }
}

function notificationSignature(notification: Pick<AppNotification, "message" | "tone" | "title">) {
  return JSON.stringify([notification.tone, notification.title ?? "", notification.message])
}

function isPersistentNotificationTone(tone: AppNotificationTone) {
  return tone === "warning" || tone === "error"
}

function confirmButtonClassName(tone: AppConfirmTone) {
  if (tone === "danger") return themeClassNames.button.danger
  if (tone === "warning") {
    return "inline-flex items-center justify-center rounded-lg border border-app-warning-border bg-app-warning-surface px-3 py-1.5 text-sm font-medium text-app-warning transition hover:border-app-warning disabled:cursor-not-allowed disabled:opacity-50"
  }
  return themeClassNames.button.primary
}

function notificationClassName(tone: AppNotificationTone) {
  if (tone === "error") return "border-app-danger-border bg-app-danger-surface/95 text-app-danger"
  if (tone === "warning") return "border-app-warning-border bg-app-warning-surface/95 text-app-warning"
  if (tone === "success") return "border-app-success-border bg-app-success-surface/95 text-app-success"
  return "border-app-border/80 text-app-secondary"
}

function notificationIcon(tone: AppNotificationTone) {
  if (tone === "error") return <XCircle size={17} />
  if (tone === "warning") return <AlertTriangle size={17} />
  if (tone === "success") return <CheckCircle2 size={17} />
  return <Info size={17} />
}

function readFocusableActiveElement(): HTMLElement | null {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement && isFocusableElement(activeElement) ? activeElement : null
}

function restoreRequestFocus(request: ConfirmRequest) {
  const fallback = request.options.focusFallback?.() ?? null
  if (request.options.preferFocusFallback && fallback && isFocusableElement(fallback)) {
    fallback.focus({ preventScroll: true })
    return
  }
  const origin = request.origin
  if (origin && isFocusableElement(origin)) {
    origin.focus({ preventScroll: true })
    return
  }
  if (fallback && isFocusableElement(fallback)) fallback.focus({ preventScroll: true })
}

function resolveConfirmRequest(request: ConfirmRequest, confirmed: boolean) {
  if (request.resolved) return
  request.resolved = true
  request.resolve(confirmed)
}

function isFocusableElement(element: HTMLElement) {
  if (!element.matches(FOCUSABLE_SELECTOR)) return false
  if (!element.isConnected || element.hidden || element.getClientRects().length === 0) return false
  if ("disabled" in element && Boolean((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)) {
    return false
  }
  return element.getAttribute("aria-disabled") !== "true"
}
