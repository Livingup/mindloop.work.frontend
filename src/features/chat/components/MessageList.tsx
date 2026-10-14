import { Virtuoso, type ListRange, type SizeRange, type VirtuosoHandle } from "react-virtuoso"
import { ArrowDown, ArrowRight, Check, CheckCircle2, Circle, Copy, FileText, Hourglass, ImageIcon, Loader2, X, XCircle } from "lucide-react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"

import { CopyablePreviewImage } from "@/features/chat/components/CopyablePreviewImage"
import { HtmlDocumentContent, MessageContent } from "@/features/chat/components/MessageContent"
import { createMarkdownRenderCacheKey, retainMarkdownRenderCacheKeys } from "@/features/chat/components/markdownRenderCache"
import { MAX_CONVERSATION_VISIBLE_MESSAGES } from "@/features/chat/runtime/runtimeConfig"
import { fileResourceContentUrl, type UserMessageAttachment } from "@/features/chat/api/fileResourceApi"
import { listSceneChatBubbles } from "@/features/chat/api/agentRuntimeApi"
import { ResourceLocatorPanel, useResourceLocatorDetails } from "@/features/chat/components/ResourceLocatorPanel"
import type { ChatMessage, InteractionSelection, QueuedUserMessage } from "@/features/chat/model/chatTypes"
import { useAgentConversationProjection } from "@/features/chat/hooks/useAgentUiProjection"
import { resolveAgentRuntimeState, useChatStore, chatBubbleToMessage, durableBubbleSortOrder, type AgentHydrationState } from "@/features/chat/model/chatStore"
import { useConversationUiStore } from "@/features/chat/model/conversationUiStore"
import { messageListHydrationPresentation } from "@/features/chat/model/messageListHydration"
import type { InteractionResolution } from "@/features/chat/model/agentUiProjection"
import {
  conversationProjectionMessageIdentity,
  isConversationRenderableMessage,
} from "@/features/chat/model/conversationProjection"
import { useChatPanelUiStore } from "@/features/chat/model/chatPanelUiStore"
import {
  type ExecutionProcessContextCompressionView,
  isContextCompressionMessage,
  isExecutionProcessMessage,
  isTaskBoundaryMessage,
  parseContextCompressionBubble,
  parseExecutionProcessIterations,
  parseTaskBoundary,
} from "@/features/chat/runtime/executionProcess"
import {
  isUserVisibleToolResultMessage,
  parseGeneratedImageResources,
  parseUserVisibleToolResult,
  userVisibleToolResultHtmlContent,
  type GeneratedImageResourcePreview,
  type UserVisibleToolResultImageRequestResourcePreview,
} from "@/features/chat/runtime/userVisibleToolResults"

const BOTTOM_VISIBILITY_THRESHOLD_PX = 96
const USER_UPWARD_INPUT_WINDOW_MS = 650
const VIRTUOSO_INCREASE_VIEWPORT_BY = { top: 900, bottom: 1200 }
const COPY_FEEDBACK_DURATION_MS = 1200
const INITIAL_TOP_INDEX = 100_000
const CHAT_SURFACE_CARD_CLASS = "min-w-0 rounded-2xl border border-slate-200/80 bg-white/[0.88] text-slate-950 shadow-[0_14px_38px_rgba(15,23,42,0.07)] backdrop-blur"
const AGENT_FLAT_BUBBLE_CLASS = "min-w-0 text-slate-950"
const AGENT_MESSAGE_ROW_CLASS = "flex justify-start px-6 py-4"
const AGENT_MESSAGE_GROUP_CLASS = "flex w-full min-w-0 flex-col items-stretch"
const CHAT_META_CLASS = "mb-1.5 flex min-w-0 items-center gap-2 text-[12px] font-medium leading-5 text-slate-600"
const CHAT_META_LABEL_CLASS = "font-semibold text-slate-950"
const CHAT_META_BUTTON_BASE_CLASS = "inline-flex size-6 items-center justify-center rounded-md transition focus:outline-none focus:ring-2"
const CHAT_META_BUTTON_IDLE_CLASS = "text-slate-600 hover:bg-slate-200/70 hover:text-slate-950 focus:ring-[#4f6f96]/30"
type ToolParameterTab = "request" | "response"

type ContextCompressionMarkdownStatus = "idle" | "loading" | "loaded" | "failed"

type ToolCallDisplay = {
  toolCallId: string
  toolName: string
  title: string
  status: "running" | "completed" | "failed" | "cancelled"
  durationMs?: number
  errorMessage?: string
  argumentsPreview?: Record<string, unknown> | null
  resultPreview?: unknown
  uiPreview?: Record<string, unknown> | null
  source?: string | null
}

export type MessageListPresentation = "desktop" | "mobile"

type ConversationHeaderNoticeProps = {
  isLoadingPrevious: boolean
  hasMorePrevious: boolean
  hiddenConversationMessageCount: number
  onLoadMore: () => void
  hiddenNoticeWrapperClassName: string
  hiddenNoticeClassName: string
}

export function resolveNextConversationFirstItemIndex(
  previousFirstItemIndex: number,
  previousMessages: ChatMessage[],
  nextMessages: ChatMessage[],
  isScopeSwitch: boolean,
): number {
  if (isScopeSwitch || nextMessages.length === 0) {
    return INITIAL_TOP_INDEX
  }
  if (previousMessages.length === 0) {
    return previousFirstItemIndex
  }
  const previousFirstIdentity = conversationProjectionMessageIdentity(previousMessages[0])
  const nextFirstIdentity = conversationProjectionMessageIdentity(nextMessages[0])
  if (previousFirstIdentity === nextFirstIdentity) {
    return previousFirstItemIndex
  }
  const prependedCount = nextMessages.findIndex(
    (message) => conversationProjectionMessageIdentity(message) === previousFirstIdentity,
  )
  if (prependedCount > 0) {
    return Math.max(1, previousFirstItemIndex - prependedCount)
  }
  const evictedCount = previousMessages.findIndex(
    (message) => conversationProjectionMessageIdentity(message) === nextFirstIdentity,
  )
  if (evictedCount > 0) {
    return previousFirstItemIndex + evictedCount
  }
  return previousFirstItemIndex
}

export function shouldMaintainConversationBottomLock(params: {
  wasLockedAtBottom: boolean
  reportedAtBottom: boolean
  hasRecentUserUpwardInput: boolean
  isScopeRestoring: boolean
}): {
  nextLockedAtBottom: boolean
  shouldFollowToBottom: boolean
} {
  const {
    wasLockedAtBottom,
    reportedAtBottom,
    hasRecentUserUpwardInput,
    isScopeRestoring,
  } = params
  if (reportedAtBottom) {
    return {
      nextLockedAtBottom: true,
      shouldFollowToBottom: false,
    }
  }
  if (wasLockedAtBottom && !hasRecentUserUpwardInput && !isScopeRestoring) {
    return {
      nextLockedAtBottom: true,
      shouldFollowToBottom: true,
    }
  }
  return {
    nextLockedAtBottom: false,
    shouldFollowToBottom: false,
  }
}

export const MessageList = memo(function MessageList({
  sceneId,
  agentInstanceId,
  onSubmitUserMessage,
  onRecallQueuedUserMessage,
  submitDisabled,
  presentation = "desktop",
}: {
  sceneId: string
  agentInstanceId?: string | null
  onSubmitUserMessage: (text: string, interactionSelection?: InteractionSelection) => void
  onRecallQueuedUserMessage: (message: QueuedUserMessage) => void
  submitDisabled: boolean
  presentation?: MessageListPresentation
}) {
  const {
    visibleMessages,
    hiddenConversationMessageCount,
    queuedUserMessages,
    interactionResolutionByIdentity,
    interactionSelectedOptionIdByIdentity,
    visibleIdentityKey,
    hasMorePrevious = true,
    isLoadingPrevious = false,
    scopeId: scrollScopeId,
  } = useAgentConversationProjection(sceneId, agentInstanceId)
  const hydrationState = useChatStore((state) => (
    resolveAgentRuntimeState(state.scenes[sceneId], agentInstanceId)?.hydrationState ?? "ready"
  ))
  const savedScrollState = useChatPanelUiStore((state) => state.conversationScrollStates[scrollScopeId])
  const patchConversationScrollState = useChatPanelUiStore((state) => state.patchConversationScrollState)
  const removeConversationScrollState = useChatPanelUiStore((state) => state.removeConversationScrollState)
  const containerRef = useRef<HTMLDivElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerElementRef = useRef<HTMLElement | null>(null)
  const scrollerCleanupRef = useRef<(() => void) | null>(null)
  const restoreGenerationRef = useRef(0)
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages
  const tailMessageIdentity = visibleMessages.length > 0
    ? conversationProjectionMessageIdentity(visibleMessages[visibleMessages.length - 1])
    : null
  const previousRenderRef = useRef<{
    scrollScopeId: string
    visibleIdentityKey: string
    visibleMessages: ChatMessage[]
    tailMessageIdentity: string | null
  }>({
    scrollScopeId,
    visibleIdentityKey,
    visibleMessages,
    tailMessageIdentity,
  })
  const firstItemIndexRef = useRef(INITIAL_TOP_INDEX)
  const [isAtBottom, setIsAtBottom] = useState(savedScrollState?.isAtBottom ?? true)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [totalListHeight, setTotalListHeight] = useState(0)
  const totalListHeightRef = useRef(0)
  const pendingTotalListHeightRafRef = useRef<number | null>(null)
  const followToBottomRafRef = useRef<number | null>(null)
  const isAtBottomRef = useRef(isAtBottom)
  isAtBottomRef.current = isAtBottom
  const lastScrollTopRef = useRef(0)
  const lastUserUpwardInputAtRef = useRef(0)
  const lastTouchYRef = useRef<number | null>(null)
  const isPointerScrollActiveRef = useRef(false)
  const previousRender = previousRenderRef.current
  const isScrollScopeSwitchRender = previousRender.scrollScopeId !== scrollScopeId
  const firstItemIndex = resolveNextConversationFirstItemIndex(
    firstItemIndexRef.current,
    previousRender.visibleMessages,
    visibleMessages,
    isScrollScopeSwitchRender,
  )
  const hasScrollableMessages = viewportHeight > 0 && totalListHeight > viewportHeight + 1

  const cancelFollowToBottom = useCallback(() => {
    if (followToBottomRafRef.current !== null) {
      cancelAnimationFrame(followToBottomRafRef.current)
      followToBottomRafRef.current = null
    }
  }, [])

  const hasRecentUserUpwardInput = useCallback(() => {
    if (isPointerScrollActiveRef.current) return true
    if (lastUserUpwardInputAtRef.current <= 0) return false
    return performance.now() - lastUserUpwardInputAtRef.current <= USER_UPWARD_INPUT_WINDOW_MS
  }, [])

  const scheduleFollowToBottom = useCallback(() => {
    if (!isAtBottomRef.current || restoreGenerationRef.current > 0) return
    if (followToBottomRafRef.current !== null) {
      cancelAnimationFrame(followToBottomRafRef.current)
    }
    followToBottomRafRef.current = requestAnimationFrame(() => {
      followToBottomRafRef.current = null
      if (!isAtBottomRef.current || restoreGenerationRef.current > 0) return
      const currentVisibleMessages = visibleMessagesRef.current
      if (currentVisibleMessages.length === 0) return
      virtuosoRef.current?.scrollToIndex({
        index: currentVisibleMessages.length - 1,
        align: "end",
        behavior: "auto",
      })
      const scroller = scrollerElementRef.current
      if (scroller) {
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        if (maxScrollTop - scroller.scrollTop > 1) {
          scroller.scrollTop = maxScrollTop
        }
        lastScrollTopRef.current = scroller.scrollTop
      }
    })
  }, [])

  const handleScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    if (scrollerCleanupRef.current) {
      scrollerCleanupRef.current()
      scrollerCleanupRef.current = null
    }
    if (!element || !(element instanceof HTMLElement)) {
      scrollerElementRef.current = null
      return
    }
    scrollerElementRef.current = element
    lastScrollTopRef.current = element.scrollTop

    const markUserUpwardIntent = () => {
      lastUserUpwardInputAtRef.current = performance.now()
      cancelFollowToBottom()
    }

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        markUserUpwardIntent()
      } else if (event.deltaY > 0) {
        const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
        if (distanceFromBottom <= BOTTOM_VISIBILITY_THRESHOLD_PX) {
          lastUserUpwardInputAtRef.current = 0
        }
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        lastTouchYRef.current = event.touches[0].clientY
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 0) return
      const currentY = event.touches[0].clientY
      if (lastTouchYRef.current !== null && currentY > lastTouchYRef.current + 1) {
        // 手指向下滑意味着内容向上滚动（查看更早历史消息）
        markUserUpwardIntent()
      }
      lastTouchYRef.current = currentY
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp"
        || event.key === "PageUp"
        || event.key === "Home"
        || (event.key === " " && event.shiftKey)
      ) {
        markUserUpwardIntent()
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      if (rect.right - event.clientX <= 24) {
        isPointerScrollActiveRef.current = true
        markUserUpwardIntent()
      }
    }

    const onPointerRelease = () => {
      isPointerScrollActiveRef.current = false
    }

    const onScroll = () => {
      const currentScrollTop = element.scrollTop
      const previousScrollTop = lastScrollTopRef.current
      lastScrollTopRef.current = currentScrollTop
      if (restoreGenerationRef.current > 0) return

      const distanceFromBottom = element.scrollHeight - currentScrollTop - element.clientHeight
      const scrolledUpward = currentScrollTop < previousScrollTop - 1
      if (scrolledUpward) {
        lastUserUpwardInputAtRef.current = performance.now()
      }

      if (distanceFromBottom > BOTTOM_VISIBILITY_THRESHOLD_PX && (scrolledUpward || hasRecentUserUpwardInput())) {
        cancelFollowToBottom()
        if (isAtBottomRef.current) {
          isAtBottomRef.current = false
          setIsAtBottom(false)
          patchConversationScrollState(scrollScopeId, {
            isAtBottom: false,
          })
        }
      } else if (distanceFromBottom <= BOTTOM_VISIBILITY_THRESHOLD_PX && !hasRecentUserUpwardInput()) {
        if (!isAtBottomRef.current) {
          isAtBottomRef.current = true
          setIsAtBottom(true)
          patchConversationScrollState(scrollScopeId, {
            isAtBottom: true,
          })
        }
      }
    }

    element.addEventListener("wheel", onWheel, { passive: true })
    element.addEventListener("touchstart", onTouchStart, { passive: true })
    element.addEventListener("touchmove", onTouchMove, { passive: true })
    element.addEventListener("keydown", onKeyDown, { passive: true })
    element.addEventListener("pointerdown", onPointerDown, { passive: true })
    window.addEventListener("pointerup", onPointerRelease, { passive: true })
    window.addEventListener("pointercancel", onPointerRelease, { passive: true })
    element.addEventListener("scroll", onScroll, { passive: true })

    scrollerCleanupRef.current = () => {
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("touchstart", onTouchStart)
      element.removeEventListener("touchmove", onTouchMove)
      element.removeEventListener("keydown", onKeyDown)
      element.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointerup", onPointerRelease)
      window.removeEventListener("pointercancel", onPointerRelease)
      element.removeEventListener("scroll", onScroll)
    }
  }, [cancelFollowToBottom, hasRecentUserUpwardInput, patchConversationScrollState, scrollScopeId])

  const isLoadingPreviousRef = useRef(isLoadingPrevious)
  isLoadingPreviousRef.current = isLoadingPrevious
  const hasMorePreviousRef = useRef(hasMorePrevious)
  hasMorePreviousRef.current = hasMorePrevious

  const loadPreviousMessages = useCallback(async () => {
    if (isLoadingPreviousRef.current || !hasMorePreviousRef.current) return
    const currentMessages = visibleMessagesRef.current
    if (currentMessages.length === 0) return

    let minSortOrder: number | null = null
    for (const msg of currentMessages) {
      const so = durableBubbleSortOrder(msg)
      if (so > 0) {
        if (minSortOrder === null || so < minSortOrder) {
          minSortOrder = so
        }
      }
    }

    if (minSortOrder === null) {
      useConversationUiStore.getState().prependMessages(
        scrollScopeId,
        sceneId,
        agentInstanceId ?? "",
        [],
        false,
      )
      return
    }

    useConversationUiStore.getState().setLoadingPrevious(scrollScopeId, true)
    try {
      let cursorSortOrder: number | null = minSortOrder
      let collectedRenderableMessages: ChatMessage[] = []
      let hasMore = true
      let pageCount = 0

      while (cursorSortOrder !== null && pageCount < 5) {
        pageCount += 1
        const result = await listSceneChatBubbles(sceneId, {
          limit: 30,
          before_sort_order: cursorSortOrder,
          agent_instance_id: agentInstanceId ?? "",
        })
        const olderBubbles = result.messages ?? []
        hasMore = olderBubbles.length >= 30
        if (olderBubbles.length === 0) {
          break
        }
        const mappedMessages = olderBubbles.map(chatBubbleToMessage)
        const renderablePage = mappedMessages.filter(isConversationRenderableMessage)
        if (renderablePage.length > 0) {
          collectedRenderableMessages = renderablePage
          break
        }
        if (!hasMore) {
          break
        }
        let nextCursor: number | null = null
        for (const msg of mappedMessages) {
          const so = durableBubbleSortOrder(msg)
          if (so > 0 && (nextCursor === null || so < nextCursor)) {
            nextCursor = so
          }
        }
        if (nextCursor === null || nextCursor >= cursorSortOrder) {
          break
        }
        cursorSortOrder = nextCursor
      }

      useConversationUiStore.getState().prependMessages(
        scrollScopeId,
        sceneId,
        agentInstanceId ?? "",
        collectedRenderableMessages,
        hasMore,
      )
    } catch (err) {
      console.error("Failed to load previous chat messages", err)
      useConversationUiStore.getState().setLoadingPrevious(scrollScopeId, false)
    }
  }, [agentInstanceId, sceneId, scrollScopeId])

  const handleStartReached = useCallback(() => {
    if (isAtBottomRef.current || restoreGenerationRef.current > 0) return
    loadPreviousMessages()
  }, [loadPreviousMessages])

  const visibleMarkdownRenderCacheKeys = useMemo(() => collectVisibleMarkdownRenderCacheKeys(visibleMessages), [visibleMessages])
  useEffect(() => {
    retainMarkdownRenderCacheKeys(visibleMarkdownRenderCacheKeys)
  }, [visibleMarkdownRenderCacheKeys])

  const userMessageAnchors = useMemo(() => {
    const userMessages = visibleMessages.filter((message) => message.role === "user")
    const userMessageCount = userMessages.length
    if (userMessageCount === 0) return []

    return userMessages.map((message, index) => {
      const positionPercent = userMessageCount <= 1
        ? 50
        : (index / (userMessageCount - 1)) * 100
      const sentAt = new Date(message.createdAt).toLocaleTimeString()
      const textPreview = message.content.text.trim().replace(/\s+/g, " ").slice(0, 80)
      const navigationLabel = `跳转到 ${sentAt} 发送的消息`
      return {
        identity: conversationProjectionMessageIdentity(message),
        positionPercent,
        tooltipTitle: textPreview || `${sentAt} 发送的消息`,
        ariaLabel: textPreview ? `${navigationLabel}：${textPreview}` : navigationLabel,
      }
    })
  }, [visibleMessages])
  const scrollToIndex = useCallback((index: number, align: "center" | "end" = "center") => {
    virtuosoRef.current?.scrollToIndex({ index, align, behavior: "smooth" })
  }, [])
  const scrollToBottom = useCallback(() => {
    const currentVisibleMessages = visibleMessagesRef.current
    if (currentVisibleMessages.length === 0) return
    lastUserUpwardInputAtRef.current = 0
    isPointerScrollActiveRef.current = false
    isAtBottomRef.current = true
    setIsAtBottom(true)
    patchConversationScrollState(scrollScopeId, {
      isAtBottom: true,
    })
    scrollToIndex(currentVisibleMessages.length - 1, "end")
  }, [patchConversationScrollState, scrollScopeId, scrollToIndex])
  const scrollToMessageIdentity = useCallback((identity: string) => {
    const currentVisibleMessages = visibleMessagesRef.current
    const index = currentVisibleMessages.findIndex(
      (message) => conversationProjectionMessageIdentity(message) === identity,
    )
    if (index >= 0) {
      if (index < currentVisibleMessages.length - 1) {
        lastUserUpwardInputAtRef.current = performance.now()
        cancelFollowToBottom()
        isAtBottomRef.current = false
        setIsAtBottom(false)
        patchConversationScrollState(scrollScopeId, {
          isAtBottom: false,
        })
      }
      scrollToIndex(index)
    }
  }, [cancelFollowToBottom, patchConversationScrollState, scrollScopeId, scrollToIndex])
  const followOutput = useCallback((_atBottom: boolean) => {
    // 切 scope 时不自动跟随；当用户处于底部跟随模式时，始终跟随新消息到底部。
    // 以受控的 isAtBottomRef 为准，避免 Virtuoso 重测大高度 Markdown 气泡时瞬时失真。
    if (isScrollScopeSwitchRender) return false
    if (!isAtBottomRef.current) return false
    return "auto"
  }, [isScrollScopeSwitchRender])
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    const decision = shouldMaintainConversationBottomLock({
      wasLockedAtBottom: isAtBottomRef.current,
      reportedAtBottom: atBottom,
      hasRecentUserUpwardInput: hasRecentUserUpwardInput(),
      isScopeRestoring: restoreGenerationRef.current > 0,
    })
    if (decision.shouldFollowToBottom) {
      scheduleFollowToBottom()
      return
    }
    if (isAtBottomRef.current !== decision.nextLockedAtBottom) {
      isAtBottomRef.current = decision.nextLockedAtBottom
      setIsAtBottom(decision.nextLockedAtBottom)
    }
    if (restoreGenerationRef.current > 0) return
    patchConversationScrollState(scrollScopeId, {
      isAtBottom: decision.nextLockedAtBottom,
    })
  }, [hasRecentUserUpwardInput, patchConversationScrollState, scheduleFollowToBottom, scrollScopeId])
  const handleRangeChanged = useCallback((range: ListRange) => {
    const currentVisibleMessages = visibleMessagesRef.current
    const localStartIndex = range.startIndex >= firstItemIndexRef.current
      ? range.startIndex - firstItemIndexRef.current
      : range.startIndex
    const topMessageIdentity = localStartIndex >= 0 && localStartIndex < currentVisibleMessages.length
      ? conversationProjectionMessageIdentity(currentVisibleMessages[localStartIndex])
      : null
    if (restoreGenerationRef.current > 0) return
    patchConversationScrollState(scrollScopeId, {
      isAtBottom: isAtBottomRef.current,
      topMessageIdentity,
    })
  }, [patchConversationScrollState, scrollScopeId])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const updateViewportHeight = () => {
      const nextViewportHeight = element.clientHeight
      setViewportHeight((currentViewportHeight) => currentViewportHeight === nextViewportHeight ? currentViewportHeight : nextViewportHeight)
    }
    updateViewportHeight()
    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  useLayoutEffect(() => {
    const nextIsAtBottom = savedScrollState?.isAtBottom ?? true
    lastUserUpwardInputAtRef.current = 0
    isPointerScrollActiveRef.current = false
    isAtBottomRef.current = nextIsAtBottom
    setIsAtBottom((currentIsAtBottom) => currentIsAtBottom === nextIsAtBottom ? currentIsAtBottom : nextIsAtBottom)
  }, [scrollScopeId])

  useLayoutEffect(() => {
    const previous = previousRenderRef.current
    const didScopeSwitch = previous.scrollScopeId !== scrollScopeId
    const didTailChange = !didScopeSwitch && (
      tailMessageIdentity !== previous.tailMessageIdentity
      || visibleMessages.length > previous.visibleMessages.length
    )
    firstItemIndexRef.current = firstItemIndex
    previousRenderRef.current = {
      scrollScopeId,
      visibleIdentityKey,
      visibleMessages,
      tailMessageIdentity,
    }
    if (didTailChange && isAtBottomRef.current) {
      scheduleFollowToBottom()
    }
  }, [firstItemIndex, scheduleFollowToBottom, scrollScopeId, tailMessageIdentity, visibleIdentityKey, visibleMessages])

  useLayoutEffect(() => {
    if (!isScrollScopeSwitchRender) return
    restoreGenerationRef.current += 1
    const restoreGeneration = restoreGenerationRef.current
    const rafId = requestAnimationFrame(() => {
      const handle = virtuosoRef.current
      const currentVisibleMessages = visibleMessagesRef.current
      if (restoreGenerationRef.current !== restoreGeneration) return
      if (!handle || currentVisibleMessages.length === 0) {
        restoreGenerationRef.current = 0
        return
      }
      const shouldBeAtBottom = savedScrollState?.isAtBottom !== false
      if (!shouldBeAtBottom && savedScrollState?.topMessageIdentity) {
        const idx = currentVisibleMessages.findIndex(
          (message) => conversationProjectionMessageIdentity(message) === savedScrollState.topMessageIdentity,
        )
        if (idx >= 0) {
          handle.scrollToIndex({ index: idx, align: "start", behavior: "auto" })
          requestAnimationFrame(() => {
            if (restoreGenerationRef.current === restoreGeneration) restoreGenerationRef.current = 0
          })
          return
        }
      }
      handle.scrollToIndex({ index: currentVisibleMessages.length - 1, align: "end", behavior: "auto" })
      requestAnimationFrame(() => {
        if (restoreGenerationRef.current === restoreGeneration) restoreGenerationRef.current = 0
      })
    })
    return () => {
      cancelAnimationFrame(rafId)
      if (restoreGenerationRef.current === restoreGeneration) restoreGenerationRef.current = 0
    }
  }, [isScrollScopeSwitchRender, savedScrollState?.isAtBottom, savedScrollState?.topMessageIdentity, scrollScopeId])

  const handleTotalListHeightChanged = useCallback((nextTotalListHeight: number) => {
    const previousHeight = totalListHeightRef.current
    if (previousHeight !== nextTotalListHeight) {
      totalListHeightRef.current = nextTotalListHeight
      if (nextTotalListHeight > previousHeight && isAtBottomRef.current && restoreGenerationRef.current === 0) {
        scheduleFollowToBottom()
      }
      if (pendingTotalListHeightRafRef.current === null) {
        pendingTotalListHeightRafRef.current = requestAnimationFrame(() => {
          pendingTotalListHeightRafRef.current = null
          setTotalListHeight((currentTotalListHeight) => {
            const latestTotalListHeight = totalListHeightRef.current
            return currentTotalListHeight === latestTotalListHeight ? currentTotalListHeight : latestTotalListHeight
          })
        })
      }
    }
  }, [scheduleFollowToBottom])

  useEffect(() => () => {
    if (pendingTotalListHeightRafRef.current !== null) {
      cancelAnimationFrame(pendingTotalListHeightRafRef.current)
      pendingTotalListHeightRafRef.current = null
    }
    cancelFollowToBottom()
    if (scrollerCleanupRef.current) {
      scrollerCleanupRef.current()
      scrollerCleanupRef.current = null
    }
  }, [cancelFollowToBottom])

  useEffect(() => {
    if (visibleMessages.length === 0) {
      removeConversationScrollState(scrollScopeId)
    }
  }, [removeConversationScrollState, scrollScopeId, visibleMessages.length])

  const isMobilePresentation = presentation === "mobile"
  const virtuosoClassName = isMobilePresentation ? "h-full min-h-0 w-full rounded-none" : "h-full min-h-0 w-full rounded-xl"
  const hiddenNoticeWrapperClassName = isMobilePresentation ? "px-3 pb-1 pt-2" : "px-6 pb-1 pt-3"
  const hiddenNoticeClassName = isMobilePresentation
    ? "rounded-full border border-slate-200/70 bg-white/80 px-3 py-1 text-center text-[11px] text-slate-500"
    : "rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-center text-[11px] text-slate-500 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
  const emptyPlaceholderClassName = isMobilePresentation ? "flex h-full items-center justify-center p-6" : "flex h-full items-center justify-center p-8"
  const anchorRailClassName = isMobilePresentation
    ? "pointer-events-none absolute bottom-4 right-1 top-4 z-10 w-3"
    : "pointer-events-none absolute bottom-5 right-2.5 top-5 z-10 w-4"
  const anchorButtonClassName = isMobilePresentation
    ? "group pointer-events-auto absolute right-0 flex size-3 -translate-y-1/2 items-center justify-center rounded-full transition focus:outline-none"
    : "group pointer-events-auto absolute right-0 flex size-4 -translate-y-1/2 items-center justify-center rounded-full transition focus:outline-none"
  const anchorDotClassName = isMobilePresentation
    ? "size-1.5 rounded-full bg-[#8fa0b3]/35 transition group-hover:bg-[#4f6f96]/65 group-focus:bg-[#4f6f96]/65 group-active:bg-[#263a63]/80"
    : "size-2 rounded-full bg-[#8fa0b3]/75 transition group-hover:bg-[#4f6f96] group-focus:bg-[#4f6f96] group-active:bg-[#263a63]"
  const scrollToBottomClassName = isMobilePresentation
    ? "absolute bottom-3 left-1/2 z-20 inline-flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200/80 bg-white/[0.94] text-slate-600 shadow-[0_8px_22px_rgba(15,23,42,0.10)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/30"
    : "absolute bottom-5 left-1/2 z-20 inline-flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200/90 bg-white/[0.92] text-slate-600 shadow-[0_12px_34px_rgba(15,23,42,0.14)] backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/30"
  const virtuosoComponents = useMemo(() => ({
    Header: () => (
      <ConversationHeaderNotice
        isLoadingPrevious={isLoadingPrevious}
        hasMorePrevious={hasMorePrevious}
        hiddenConversationMessageCount={hiddenConversationMessageCount}
        onLoadMore={loadPreviousMessages}
        hiddenNoticeWrapperClassName={hiddenNoticeWrapperClassName}
        hiddenNoticeClassName={hiddenNoticeClassName}
      />
    ),
    EmptyPlaceholder: () => (
      <MessageListEmptyPlaceholder
        className={emptyPlaceholderClassName}
        hydrationState={hydrationState}
      />
    ),
  }), [
    emptyPlaceholderClassName,
    hasMorePrevious,
    hiddenConversationMessageCount,
    hiddenNoticeClassName,
    hiddenNoticeWrapperClassName,
    hydrationState,
    isLoadingPrevious,
    loadPreviousMessages,
  ])
  const itemContent = useCallback((_: number, message: ChatMessage) => (
    <MessageItemView
      message={message}
      interactionResolution={interactionResolutionByIdentity[conversationProjectionMessageIdentity(message)]}
      interactionSelectedOptionId={interactionSelectedOptionIdByIdentity[conversationProjectionMessageIdentity(message)]}
      onSubmitUserMessage={onSubmitUserMessage}
      submitDisabled={submitDisabled}
    />
  ), [interactionResolutionByIdentity, interactionSelectedOptionIdByIdentity, onSubmitUserMessage, submitDisabled])

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {visibleMessages.length > 0 && hydrationState !== "ready" ? (
        <MessageListHydrationNotice hydrationState={hydrationState} compact />
      ) : null}
      <Virtuoso
        key={`${sceneId}:${agentInstanceId ?? "all"}`}
        ref={virtuosoRef}
        scrollerRef={handleScrollerRef}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        startReached={handleStartReached}
        followOutput={followOutput}
        computeItemKey={computeMessageItemKey}
        atBottomThreshold={BOTTOM_VISIBILITY_THRESHOLD_PX}
        increaseViewportBy={VIRTUOSO_INCREASE_VIEWPORT_BY}
        atBottomStateChange={handleAtBottomStateChange}
        rangeChanged={handleRangeChanged}
        totalListHeightChanged={handleTotalListHeightChanged}
        className={virtuosoClassName}
        components={virtuosoComponents}
        itemContent={itemContent}
      />
      {hasScrollableMessages && userMessageAnchors.length > 0 ? (
        <div className={anchorRailClassName}>
          {userMessageAnchors.map((anchor) => (
            <button
              key={anchor.identity}
              type="button"
              onClick={() => scrollToMessageIdentity(anchor.identity)}
              title={anchor.tooltipTitle}
              aria-label={anchor.ariaLabel}
              className={anchorButtonClassName}
              style={{ top: `${anchor.positionPercent}%` }}
            >
              <span className={anchorDotClassName} />
            </button>
          ))}
        </div>
      ) : null}
      {!isAtBottom && visibleMessages.length > 0 ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className={scrollToBottomClassName}
          title="快速滑到最底部"
          aria-label="快速滑到最底部"
        >
          <ArrowDown size={18} />
        </button>
      ) : null}
      <QueuedUserMessagePanel messages={queuedUserMessages} onRecall={onRecallQueuedUserMessage} />
    </div>
  )
})

function computeMessageItemKey(_: number, message: ChatMessage) {
  return conversationProjectionMessageIdentity(message)
}

export function buildConversationItemScrollMapPositions(
  itemCount: number,
  sizeRanges: SizeRange[],
  totalListHeight: number,
  viewportHeight: number,
): number[] {
  if (itemCount === 0 || sizeRanges.length === 0 || totalListHeight <= 0 || viewportHeight <= 0) return []
  const itemSizes: number[] = []
  let rangeIndex = 0
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    while (rangeIndex < sizeRanges.length - 1 && sizeRanges[rangeIndex].endIndex < itemIndex) {
      rangeIndex += 1
    }
    const range = sizeRanges[rangeIndex]
    if (!range || range.startIndex > itemIndex || range.endIndex < itemIndex || range.size <= 0) return []
    itemSizes.push(range.size)
  }

  const itemContentHeight = itemSizes.reduce((sum, size) => sum + size, 0)
  const nonItemHeight = Math.max(0, totalListHeight - itemContentHeight)
  const maxScrollTop = Math.max(0, totalListHeight - viewportHeight)
  let itemTop = nonItemHeight
  return itemSizes.map((itemSize) => {
    const itemCenter = itemTop + itemSize / 2
    itemTop += itemSize
    if (maxScrollTop === 0) return 0
    const centeredScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, itemCenter - viewportHeight / 2),
    )
    return (centeredScrollTop / maxScrollTop) * 100
  })
}

function sizeRangesEqual(left: SizeRange[], right: SizeRange[]): boolean {
  if (left.length !== right.length) return false
  return left.every((range, index) => {
    const candidate = right[index]
    return (
      candidate !== undefined &&
      range.startIndex === candidate.startIndex &&
      range.endIndex === candidate.endIndex &&
      range.size === candidate.size
    )
  })
}

function collectVisibleMarkdownRenderCacheKeys(messages: ChatMessage[]): string[] {
  return messages.flatMap((message) => {
    if (isExecutionProcessMessage(message)) return []
    if (isContextCompressionMessage(message) || isTaskBoundaryMessage(message) || message.content.metadata?.bubble_kind === "tool_call" || isUserVisibleToolResultMessage(message)) {
      return []
    }
    if (isLocalAgentMessage(message)) {
      const metadata = message.content.metadata ?? {}
      const displayText = textMetadata(metadata.display_text) ?? message.content.text
      const cacheKey = messageContentMarkdownRenderCacheKey(message, "local-agent-content", displayText)
      return cacheKey ? [cacheKey] : []
    }
    if (isRemoteAgentMessage(message)) {
      const metadata = message.content.metadata ?? {}
      const displayText = textMetadata(metadata.display_text) ?? message.content.text
      const cacheKey = messageContentMarkdownRenderCacheKey(message, "remote-agent-content", displayText)
      return cacheKey ? [cacheKey] : []
    }
    const cacheKey = messageContentMarkdownRenderCacheKey(message, "chat-content", message.content.text, message.role === "user")
    return cacheKey ? [cacheKey] : []
  })
}

function messageContentMarkdownRenderCacheKey(message: ChatMessage, slot: string, text: string, inverted = false): string | null {
  if (message.content.text_format !== "markdown" || text.length === 0) return null
  return createMarkdownRenderCacheKey({ ownerId: message.id, slot, text, inverted })
}

const ConversationHeaderNotice = memo(function ConversationHeaderNotice({
  isLoadingPrevious,
  hasMorePrevious,
  hiddenConversationMessageCount,
  onLoadMore,
  hiddenNoticeWrapperClassName,
  hiddenNoticeClassName,
}: ConversationHeaderNoticeProps) {
  if (isLoadingPrevious) {
    return (
      <div className={hiddenNoticeWrapperClassName}>
        <div className={`${hiddenNoticeClassName} inline-flex items-center justify-center gap-2`}>
          <Loader2 size={13} className="animate-spin text-[#4f6f96]" />
          <span>正在加载更早历史消息...</span>
        </div>
      </div>
    )
  }

  if (!hasMorePrevious) {
    return (
      <div className={hiddenNoticeWrapperClassName}>
        <div className={hiddenNoticeClassName}>
          已加载全部历史消息
        </div>
      </div>
    )
  }

  return (
    <div className={hiddenNoticeWrapperClassName}>
      <button
        type="button"
        onClick={onLoadMore}
        className={`${hiddenNoticeClassName} cursor-pointer transition hover:bg-white/90 hover:text-slate-700`}
      >
        {hiddenConversationMessageCount > 0
          ? `向上滚动加载更早 ${hiddenConversationMessageCount} 条消息`
          : "向上滚动加载更早历史消息"}
      </button>
    </div>
  )
})

const MessageListEmptyPlaceholder = memo(function MessageListEmptyPlaceholder({
  className,
  hydrationState,
}: {
  className: string
  hydrationState: AgentHydrationState
}) {
  const presentation = messageListHydrationPresentation(hydrationState)
  if (hydrationState !== "ready") {
    return (
      <div className={className}>
        <MessageListHydrationNotice hydrationState={hydrationState} />
      </div>
    )
  }
  return (
    <div className={className}>
      <div className="max-w-md text-center">
        <div className="text-lg font-semibold text-slate-950">{presentation.title}</div>
        <div className="mt-2 text-sm text-slate-500">{presentation.detail}</div>
      </div>
    </div>
  )
})

const MessageListHydrationNotice = memo(function MessageListHydrationNotice({
  hydrationState,
  compact = false,
}: {
  hydrationState: Exclude<AgentHydrationState, "ready">
  compact?: boolean
}) {
  const presentation = messageListHydrationPresentation(hydrationState)
  return (
    <div
      role="status"
      className={compact
        ? "absolute left-1/2 top-3 z-20 flex max-w-[min(90%,38rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow-sm backdrop-blur"
        : "max-w-md rounded-2xl border border-slate-200/90 bg-white/90 px-5 py-4 text-center shadow-sm"}
    >
      {presentation.isFailure
        ? <XCircle size={compact ? 14 : 18} className="shrink-0 text-amber-600" />
        : <Loader2 size={compact ? 14 : 18} className="shrink-0 animate-spin text-[#4f6f96]" />}
      <div className={compact ? "truncate" : ""}>
        <div className={compact ? "font-medium" : "font-semibold text-slate-950"}>
          {presentation.title}
        </div>
        {!compact ? (
          <div className="mt-1 text-sm text-slate-500">
            {presentation.detail}
          </div>
        ) : null}
      </div>
    </div>
  )
})

function QueuedUserMessagePanel({ messages, onRecall }: { messages: QueuedUserMessage[]; onRecall: (message: QueuedUserMessage) => void }) {
  if (messages.length === 0) return null
  return (
    <aside className="absolute bottom-4 right-4 z-20 flex max-h-[min(28rem,calc(100%-2rem))] w-[25rem] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg border-t-2 border-t-app-warning bg-app-warning-surface shadow-[0_18px_48px_rgb(15_23_42_/_0.16)]">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-app-primary">
          <Hourglass size={18} className="shrink-0 text-app-warning" />
          <span className="shrink-0 text-base font-semibold">待发送队列</span>
          <span className="truncate text-xs font-normal text-app-secondary">当前LLM请求结束后发送</span>
        </div>
        <span className="shrink-0 rounded-full border border-app-warning-border bg-app-warning-surface px-3 py-1 text-sm text-app-secondary shadow-sm">
          {messages.length} 条
        </span>
      </div>
      <div className="h-px shrink-0 bg-app-warning-border/70" />
      <div className="min-h-0 overflow-y-auto">
        {messages.map((message, index) => (
          <div key={message.id} className={`px-4 py-3 ${index > 0 ? "border-t border-app-border/75" : ""}`}>
            <div className="flex items-start gap-2">
              {message.status === "queued" ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-app-warning" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-app-danger" />}
              <div className="min-w-0 flex-1">
                {message.status !== "queued" ? <div className="mb-1 text-sm text-app-danger">发送失败</div> : null}
                <div className="line-clamp-2 text-sm leading-5 text-app-primary">{message.text}</div>
              </div>
            </div>
            {message.attachments && message.attachments.length > 0 ? (
              <div>
                <AttachmentGrid attachments={message.attachments} compact />
              </div>
            ) : null}
            {message.errorMessage ? <div className="mt-1.5 line-clamp-2 text-xs text-app-danger">{message.errorMessage}</div> : null}
            {message.status === "queued" ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onRecall(message)}
                  className="inline-flex items-center rounded-full border border-app-warning-border bg-app-warning-border/35 px-3 py-1.5 text-sm font-medium text-app-secondary shadow-sm transition hover:border-app-warning hover:bg-app-warning-border/55 hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-warning/20"
                  title="从等待发送队列撤回这条消息"
                  aria-label="从等待发送队列撤回这条消息"
                >
                  撤回
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  )
}

const MessageItemView = memo(function MessageItemView({
  message,
  interactionResolution,
  interactionSelectedOptionId,
  onSubmitUserMessage,
  submitDisabled,
}: {
  message: ChatMessage
  interactionResolution?: InteractionResolution
  interactionSelectedOptionId?: string
  onSubmitUserMessage: (text: string, interactionSelection?: InteractionSelection) => void
  submitDisabled: boolean
}) {
  if (isTaskBoundaryMessage(message)) {
    return <TaskBoundaryBubble message={message} />
  }
  if (isContextCompressionMessage(message)) {
    return <ContextCompressionBubble message={message} />
  }
  // execution_process belongs to the right timeline projection only. The left
  // conversation/result projection must not use it to carry user-visible web/image results.
  if (isExecutionProcessMessage(message)) {
    return null
  }
  if (isUserVisibleToolResultMessage(message)) {
    return <UserVisibleToolResultBubble message={message} />
  }
  if (message.content.metadata?.bubble_kind === "tool_call") {
    return <ToolCallBubble message={message} />
  }
  if (isLocalAgentMessage(message)) {
    return <LocalAgentBubble message={message} />
  }
  if (isRemoteAgentMessage(message)) {
    return <RemoteAgentBubble message={message} />
  }
  return (
    <ChatBubble
      message={message}
      interactionResolution={interactionResolution}
      interactionSelectedOptionId={interactionSelectedOptionId}
      onSubmitUserMessage={onSubmitUserMessage}
      submitDisabled={submitDisabled}
    />
  )
})

function UserVisibleToolResultBubble({ message }: { message: ChatMessage }) {
  const result = parseUserVisibleToolResult(message)
  if (!result) return null
  const isImageGeneration = result.resultKind === "image_generation"
  const htmlContent = typeof result.htmlContent === "string" && result.htmlContent.trim().length > 0 ? result.htmlContent : null
  const imageRequestPrompt = typeof result.imageRequestPrompt === "string" && result.imageRequestPrompt.trim().length > 0 ? result.imageRequestPrompt : null
  const hasImages = result.generatedImages.length > 0
  const hasHtml = !!htmlContent
  const hasImageRequestPrompt = !!imageRequestPrompt
  const hasImageRequestResources = result.imageRequestResources.length > 0
  const hasImageResultText = isImageGeneration && !hasImageRequestPrompt && !!result.generatedImageResultText
  if (!hasImages && !hasHtml && !hasImageRequestPrompt && !hasImageRequestResources && !hasImageResultText) return null
  const title = isImageGeneration ? "图片生成结果" : "网页结果"
  const icon = isImageGeneration ? <ImageIcon size={14} className="shrink-0 text-slate-500" /> : <FileText size={14} className="shrink-0 text-slate-500" />
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className={CHAT_META_LABEL_CLASS}>Agent</span>
          <span>{new Date(result.createdAt).toLocaleTimeString()}</span>
        </div>
        <article className={AGENT_FLAT_BUBBLE_CLASS}>
          <div className="mb-3 flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
            {icon}
            <span>{title}</span>
            <span className="min-w-0 truncate font-mono text-xs font-normal text-slate-500">{result.toolName}</span>
          </div>
          <div className="min-w-0 space-y-4">
            {isImageGeneration ? (
              <>
                {hasImageRequestPrompt ? (
                  <UserVisibleToolResultSection title="请求提示词">
                    <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{imageRequestPrompt}</div>
                  </UserVisibleToolResultSection>
                ) : null}
                {hasImageRequestResources ? (
                  <UserVisibleToolResultSection title="请求资源">
                    <UserVisibleToolResultImageRequestResources resources={result.imageRequestResources} />
                  </UserVisibleToolResultSection>
                ) : null}
                {hasImages ? (
                  <UserVisibleToolResultSection title="生成结果">
                    <GeneratedImageGrid images={result.generatedImages} />
                  </UserVisibleToolResultSection>
                ) : null}
                {hasImageResultText ? (
                  <UserVisibleToolResultSection title="结果文本">
                    <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.generatedImageResultText}</div>
                  </UserVisibleToolResultSection>
                ) : null}
              </>
            ) : (
              <>
                {hasHtml ? <HtmlDocumentResult htmlContent={htmlContent} /> : null}
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}

function UserVisibleToolResultSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function UserVisibleToolResultImageRequestResources({ resources }: { resources: UserVisibleToolResultImageRequestResourcePreview[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource, index) => (
        <UserVisibleToolResultImageRequestResourceCard key={`${resource.field}:${index}:${resource.value}`} resource={resource} />
      ))}
    </div>
  )
}

function UserVisibleToolResultImageRequestResourceCard({ resource }: { resource: UserVisibleToolResultImageRequestResourcePreview }) {
  const hasPreviewImage = !!resource.displayUrl
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {hasPreviewImage ? (
        <CopyablePreviewImage src={resource.displayUrl ?? resource.value} alt={resource.label} className="h-40 w-full object-cover" />
      ) : (
        <div className="flex h-40 items-center justify-center bg-slate-50 text-slate-400">
          <FileText size={18} />
        </div>
      )}
      <div className="space-y-1 border-t border-slate-200 px-3 py-2">
        <div className="truncate text-xs font-medium text-slate-800">{resource.label}</div>
        <div className="truncate font-mono text-[11px] text-slate-500" title={resource.value}>{resource.value}</div>
      </div>
    </article>
  )
}

function TaskBoundaryBubble({ message }: { message: ChatMessage }) {
  const boundary = parseTaskBoundary(message.content.metadata ?? {})
  if (!boundary) return null
  const failed = boundary.status === "failed"
  const cancelled = boundary.status === "cancelled"
  const boundaryTone = failed
    ? "danger"
    : cancelled
      ? "cancelled"
      : "success"
  return (
    <div className="px-6 py-3" role="separator" aria-label={boundary.label}>
      <div className="flex items-center gap-3 text-xs text-app-muted">
        <div className={`h-px flex-1 ${boundaryTone === "danger" ? "bg-app-danger-border" : boundaryTone === "cancelled" ? "bg-app-border" : "bg-app-success-border"}`} />
        <div className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm ${
          boundaryTone === "danger"
            ? "border-app-danger-border bg-app-danger-surface text-app-danger"
            : boundaryTone === "cancelled"
              ? "border-app-border bg-app-surface text-app-muted"
              : "border-app-success-border bg-app-success-surface text-app-success"
        }`}>
          {failed ? <XCircle size={14} className="shrink-0" /> : cancelled ? <XCircle size={14} className="shrink-0" /> : <CheckCircle2 size={14} className="shrink-0" />}
          <span className="font-medium">{boundary.label}</span>
          <span className="text-app-subtle">{new Date(boundary.completedAt).toLocaleTimeString()}</span>
          {boundary.taskId ? <span className="hidden font-mono text-[11px] text-app-subtle sm:inline">{shortRequestId(boundary.taskId)}</span> : null}
        </div>
        <div className={`h-px flex-1 ${failed ? "bg-app-danger-border" : "bg-app-success-border"}`} />
      </div>
      {boundary.failureMessage ? (
        <div className="mx-auto mt-1 max-w-2xl rounded-lg border border-app-danger-border bg-app-danger-surface px-3 py-2 text-center text-xs text-app-danger">
          {boundary.failureMessage}
        </div>
      ) : null}
    </div>
  )
}

function hasToolConversationContent(tool: ToolCallDisplay): boolean {
  const generatedImages = getGeneratedImageResources(tool.uiPreview)
  return generatedImages.length > 0 || !!getToolHtmlContent(tool)
}

function ToolContentProjection({ tool }: { tool: ToolCallDisplay }) {
  const generatedImages = getGeneratedImageResources(tool.uiPreview)
  const generatedImageResultText = generatedImages.length > 0 ? getGeneratedImageResultText(tool.resultPreview) : null
  const htmlDocument = getToolHtmlContent(tool)
  if (!generatedImageResultText && generatedImages.length === 0 && !htmlDocument) return null
  return (
    <div className="min-w-0">
      {generatedImageResultText ? <div className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{generatedImageResultText}</div> : null}
      {generatedImages.length > 0 ? <GeneratedImageGrid images={generatedImages} /> : null}
      {htmlDocument ? <HtmlDocumentResult htmlContent={htmlDocument} /> : null}
    </div>
  )
}

function ExecutionProcessBubble({ message }: { message: ChatMessage }) {
  const iterations = parseExecutionProcessIterations(message.content.metadata ?? {})
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className={CHAT_META_LABEL_CLASS}>Agent</span>
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        </div>
        <article className={AGENT_FLAT_BUBBLE_CLASS}>
          <div className="space-y-4">
            {iterations.length > 0 ? iterations.map((iteration, index) => (
              <section key={iteration.id} className={`space-y-2 ${index > 0 ? "border-t border-slate-200/80 pt-4" : ""}`}>
                {iteration.llm ? (
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                    {iteration.llm.status === "waiting" || iteration.llm.status === "thinking" ? <Loader2 size={14} className="shrink-0 animate-spin text-slate-500" /> : null}
                    {iteration.llm.status === "completed" ? <CheckCircle2 size={14} className="shrink-0 text-teal-600" /> : null}
                    {iteration.llm.status === "cancelled" ? <XCircle size={14} className="shrink-0 text-slate-500" /> : null}
                    {iteration.llm.status === "failed" ? <XCircle size={14} className="shrink-0 text-red-600" /> : null}
                    {iteration.llm.attemptLabel ? <span className="shrink-0 text-slate-700">{iteration.llm.attemptLabel}</span> : null}
                    {iteration.llm.modelAlias ? (
                      <>
                        <span className="shrink-0 truncate text-[11px] font-normal text-slate-400">{iteration.llm.modelAlias}</span>
                        <span className="text-xs font-normal text-slate-400">·</span>
                      </>
                    ) : null}
                    <span>{iteration.llm.label}</span>
                    {iteration.llm.durationMs !== undefined ? <span className="text-xs font-normal text-slate-500">{formatThinkingDuration(iteration.llm.durationMs)}</span> : null}
                    {iteration.llm.llmRequestId ? (
                      <>
                        <span className="text-xs font-normal text-slate-400">·</span>
                        <LlmRequestIdChip requestId={iteration.llm.llmRequestId} />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {iteration.llm?.errorMessage ? <div className="text-xs text-red-600">{iteration.llm.errorMessage}</div> : null}
                {iteration.tools.length > 0 ? (
                  <div className="space-y-1 pl-6">
                    {iteration.tools.map((tool) => (
                      <ToolCallRow key={tool.toolCallId} tool={tool} />
                    ))}
                  </div>
                ) : null}
              </section>
            )) : null}
            {iterations.length === 0 ? (
              <div className="text-sm text-slate-600">{message.content.text}</div>
            ) : null}
          </div>
        </article>
      </div>
    </div>
  )
}

/**
 * 上下文压缩独立气泡。
 *
 * 该气泡 bubble_kind=context_compression，与用户消息、Agent 普通对话消息一样是聊天流中的独立隔断点：
 * 不与前后的 execution_process 气泡合并。压缩成功后产生的新 LLM/tool 事件会路由到下一个 execution_process
 * 气泡中，在压缩气泡的下方出现；不会出现在压缩气泡上方。
 */
function ContextCompressionBubble({ message }: { message: ChatMessage }) {
  const compression = parseContextCompressionBubble(message.content.metadata ?? {})
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className={CHAT_META_LABEL_CLASS}>Agent</span>
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        </div>
        {compression ? (
          <ContextCompressionStageBubble compression={compression} />
        ) : (
          <article className={`${CHAT_SURFACE_CARD_CLASS} p-4`}>
            <div className="text-sm text-slate-600">{message.content.text}</div>
          </article>
        )}
      </div>
    </div>
  )
}

function ContextCompressionStageBubble({ compression }: { compression: ExecutionProcessContextCompressionView }) {
  const [markdown, setMarkdown] = useState<string | null>(compression.finalMarkdown ?? null)
  const [loadStatus, setLoadStatus] = useState<ContextCompressionMarkdownStatus>(
    compression.finalMarkdown ? "loaded" : compression.finalMarkdownStatus,
  )
  const [loadError, setLoadError] = useState<string | null>(compression.finalMarkdownError ?? null)
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false)
  const workerSummary = contextCompressionWorkerSummary(compression.workers)
  const canOpenSummary = !!markdown || loadStatus === "failed"
  const summaryStatusText = contextCompressionSummaryStatusText({
    status: loadStatus,
    hasMarkdownReference: false,
    hasMarkdown: !!markdown,
  })

  useEffect(() => {
    if (compression.finalMarkdown) {
      setMarkdown(compression.finalMarkdown)
      setLoadStatus("loaded")
      setLoadError(null)
      return
    }
    setMarkdown(null)
    setLoadStatus(compression.finalMarkdownStatus)
    setLoadError(compression.finalMarkdownError ?? null)
  }, [
    compression.finalMarkdown,
    compression.finalMarkdownError,
    compression.finalMarkdownStatus,
    compression.jobId,
  ])

  return (
    <section className="rounded-xl border border-context-compression-border bg-context-compression-bg p-3 shadow-card-soft">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-context-compression-accent">
            {contextCompressionStatusIcon(compression.status)}
            <span>{compression.label}</span>
            <span className="rounded-full border border-context-compression-border bg-summary-panel-body-bg px-2 py-0.5 text-[11px] font-medium text-summary-panel-header-text">
              {compression.stageLabel}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-app-muted">
            {compression.sourceMessageCount !== null && compression.sourceMessageCount !== undefined ? <span>源消息 {compression.sourceMessageCount} 条</span> : null}
            {compression.inputMode ? <span>{compression.inputMode}</span> : null}
            {compression.compressedRangeStart !== null && compression.compressedRangeStart !== undefined && compression.compressedRangeEnd !== null && compression.compressedRangeEnd !== undefined ? <span>压缩范围 {compression.compressedRangeStart}-{compression.compressedRangeEnd}</span> : null}
            {compression.retainedTailMessageCount !== null && compression.retainedTailMessageCount !== undefined ? <span>保留尾部 {compression.retainedTailMessageCount} 条</span> : null}
            {workerSummary ? <span>{workerSummary}</span> : null}
            {compression.durationMs !== undefined ? <span>{formatDuration(compression.durationMs)}</span> : null}
          </div>
          {compression.jobId ? <ContextCompressionJobIdChip jobId={compression.jobId} /> : null}
        </div>
        {compression.compressionIndex !== null && compression.compressionIndex !== undefined ? (
          <span className="shrink-0 rounded-full border border-context-compression-border bg-summary-panel-body-bg px-2 py-0.5 text-xs font-medium text-context-compression-accent">
            #{compression.compressionIndex}
          </span>
        ) : null}
      </div>
      {compression.workers.length > 0 ? (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {compression.workers.map((worker) => (
            <ContextCompressionWorkerRow
              key={worker.id}
              worker={worker}
            />
          ))}
        </div>
      ) : null}
      {compression.assemblyStatus || compression.verificationStatus || compression.rebindCompleted ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {compression.assemblyStatus ? <ContextCompressionStagePill label="组装" active={compression.assemblyStatus === "running"} completed={compression.assemblyStatus === "completed"} /> : null}
          {compression.verificationStatus ? <ContextCompressionStagePill label="校验" active={compression.verificationStatus === "running"} completed={compression.verificationStatus === "completed"} /> : null}
          {compression.rebindCompleted ? <ContextCompressionStagePill label="会话切换" completed={compression.rebindCompleted} /> : null}
        </div>
      ) : null}
      {compression.errorMessage ? <div className="mt-3 text-xs text-app-danger">{compression.errorMessage}</div> : null}
      {summaryDialogOpen ? (
        <ContextCompressionSummaryDialog
          markdown={markdown}
          status={loadStatus}
          errorMessage={loadError}
          onClose={() => setSummaryDialogOpen(false)}
        />
      ) : null}
      {compression.status === "completed" ? (
        <button
          type="button"
          onClick={() => setSummaryDialogOpen(true)}
          disabled={!canOpenSummary}
          className={`mt-3 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-context-compression-accent/25 ${
            canOpenSummary
              ? "border-context-compression-border bg-summary-panel-body-bg text-app-primary hover:border-context-compression-accent/55 hover:bg-context-compression-bg/55"
              : "cursor-not-allowed border-app-border/70 bg-app-surface-muted/70 text-app-muted"
          }`}
          title={summaryStatusText}
        >
          <span className="min-w-0 truncate text-sm font-medium">压缩结果已生成</span>
          <span className={`inline-flex shrink-0 items-center gap-2 text-sm font-semibold ${canOpenSummary ? "text-context-compression-accent" : "text-app-muted"}`}>
            查看详情
            <ArrowRight size={16} />
          </span>
        </button>
      ) : null}
    </section>
  )
}

function ContextCompressionWorkerRow({
  worker,
}: {
  worker: ExecutionProcessContextCompressionView["workers"][number]
}) {
  const statusParts = [contextCompressionWorkerStatusText(worker.status)]
  if (worker.durationMs !== undefined) statusParts.push(formatDuration(worker.durationMs))
  const secondaryText = worker.status === "running"
    ? worker.activityText ?? (worker.waitedMs !== undefined && worker.waitedMs > 0 ? `等待 ${formatDuration(worker.waitedMs)}` : null)
    : worker.status === "failed"
      ? worker.errorMessage
      : worker.status === "queued"
        ? (worker.reason ? contextCompressionWorkerReasonText(worker.reason) : "等待并发槽位")
        : null
  return (
    <div className="min-w-0 rounded-lg border border-context-compression-border bg-summary-panel-body-bg px-2.5 py-2 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-app-primary">
          {contextCompressionWorkerStatusIcon(worker.status)}
          <span className="truncate">{worker.name}</span>
        </div>
        <span className="shrink-0 text-app-muted">{statusParts.join(" · ")}</span>
      </div>
      {secondaryText ? <div className={`mt-1 truncate ${worker.status === "failed" ? "text-app-danger" : "text-app-muted"}`}>{secondaryText}</div> : null}
    </div>
  )
}

function ContextCompressionSummaryDialog({
  markdown,
  status,
  errorMessage,
  onClose,
}: {
  markdown: string | null
  status: ContextCompressionMarkdownStatus
  errorMessage: string | null
  onClose: () => void
}) {
  const trimmedMarkdown = markdown?.trim() ?? ""

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="压缩后的完整 Markdown 摘要"
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border/80 bg-app-surface text-app-primary shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-app-border/80 bg-app-bg px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-app-primary">压缩后的完整 Markdown 摘要</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-context-compression-accent/25"
            aria-label="关闭压缩摘要"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {status === "loading" || status === "idle" ? (
            <div className="flex items-center gap-2 text-sm text-app-secondary">
              <Loader2 size={14} className="animate-spin text-context-compression-accent" />
              正在读取压缩摘要...
            </div>
          ) : status === "failed" ? (
            <div className="rounded-xl border border-app-danger-border bg-app-danger-surface px-3 py-2 text-sm text-app-danger">
              {errorMessage ?? "读取压缩摘要失败"}
            </div>
          ) : trimmedMarkdown ? (
            <MessageContent text={trimmedMarkdown} format="markdown" />
          ) : (
            <div className="rounded-xl border border-app-border/80 bg-app-surface-muted/90 px-3 py-2 text-sm text-app-secondary">
              本次压缩暂无可展示的 Markdown 摘要。
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function ContextCompressionStagePill({ label, active = false, completed = false }: { label: string; active?: boolean; completed?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
      completed
        ? "bg-app-success-surface text-app-success"
        : active
          ? "bg-app-warning-surface text-app-warning"
          : "bg-summary-panel-body-bg text-app-muted"
    }`}>
      {completed ? <Check size={11} /> : active ? <Loader2 size={11} className="animate-spin" /> : <Circle size={8} />}
      {label}
    </span>
  )
}

function contextCompressionStatusIcon(status: ExecutionProcessContextCompressionView["status"]) {
  if (status === "running") return <Loader2 size={14} className="shrink-0 animate-spin text-context-compression-accent" />
  if (status === "completed") return <CheckCircle2 size={14} className="shrink-0 text-context-compression-accent" />
  if (status === "failed") return <XCircle size={14} className="shrink-0 text-app-danger" />
  return <XCircle size={14} className="shrink-0 text-app-muted" />
}

function contextCompressionWorkerStatusIcon(status: ExecutionProcessContextCompressionView["workers"][number]["status"]) {
  if (status === "running") return <Loader2 size={12} className="shrink-0 animate-spin text-context-compression-accent" />
  if (status === "completed") return <Check size={12} className="shrink-0 text-app-success" />
  if (status === "failed") return <XCircle size={12} className="shrink-0 text-app-danger" />
  if (status === "cancelled") return <X size={12} className="shrink-0 text-app-muted" />
  return <Circle size={8} className="shrink-0 text-app-subtle" />
}

function contextCompressionWorkerStatusText(status: ExecutionProcessContextCompressionView["workers"][number]["status"]) {
  if (status === "running") return "运行中"
  if (status === "completed") return "完成"
  if (status === "failed") return "失败"
  if (status === "cancelled") return "已取消"
  return "排队"
}

function contextCompressionWorkerSummary(workers: ExecutionProcessContextCompressionView["workers"]) {
  if (workers.length === 0) return null
  const running = workers.filter((worker) => worker.status === "running").length
  const completed = workers.filter((worker) => worker.status === "completed").length
  const failed = workers.filter((worker) => worker.status === "failed").length
  const cancelled = workers.filter((worker) => worker.status === "cancelled").length
  const parts = [`分工 ${completed}/${workers.length} 完成`]
  if (running > 0) parts.push(`${running} 个运行中`)
  if (failed > 0) parts.push(`${failed} 失败`)
  if (cancelled > 0) parts.push(`${cancelled} 已取消`)
  return parts.join(" · ")
}

function contextCompressionWorkerReasonText(reason: string) {
  if (reason === "sibling_worker_failed") return "因其他 Worker 失败而取消"
  if (reason === "context_compression_cancelled") return "压缩任务已取消"
  if (reason === "interrupted") return "用户中断"
  if (reason === "waiting_for_concurrent_start") return "等待并发启动"
  return reason
}

function contextCompressionSummaryStatusText({
  status,
  hasMarkdownReference,
  hasMarkdown,
}: {
  status: ContextCompressionMarkdownStatus
  hasMarkdownReference: boolean
  hasMarkdown: boolean
}) {
  if (hasMarkdown || status === "loaded") return "点击查看完整摘要"
  if (status === "loading") return "点击后正在读取完整摘要"
  if (status === "failed") return "摘要读取失败，可点击查看错误"
  return hasMarkdownReference ? "点击后读取完整摘要" : "本次完成事件未提供压缩摘要引用"
}

/**
 * 展示上下文压缩主 Job ID。
 *
 * 这里必须使用 compression.jobId（同 job 事件聚合主键），不能展示 archiveJobId 或 compressionIndex。
 * 完整 ID 可断行，避免窄屏横向溢出；复制按钮写入完整 jobId。
 */
function ContextCompressionJobIdChip({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopy = () => {
    void writeClipboardText(jobId)
      .then(() => {
        setCopied(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy context compression job id failed:", error)
      })
  }
  return (
    <div className="mt-2 flex min-w-0 items-start gap-2 text-[11px] leading-5">
      <span className="shrink-0 font-medium text-app-secondary">Job ID</span>
      <code
        className="min-w-0 flex-1 break-all font-mono text-app-muted"
        title={jobId}
      >
        {jobId}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition focus:outline-none focus:ring-2 focus:ring-context-compression-accent/25 ${
          copied
            ? "bg-app-success-surface text-app-success hover:bg-app-success-surface"
            : "text-app-muted hover:bg-context-compression-bg hover:text-context-compression-accent"
        }`}
        title={copied ? "已复制 Job ID" : "复制 Job ID"}
        aria-label={copied ? "已复制上下文压缩 Job ID" : "复制上下文压缩 Job ID"}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )
}

function LlmRequestIdChip({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopy = () => {
    void writeClipboardText(requestId).then(() => {
      setCopied(true)
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS)
    })
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-normal">
      <Link
        to={`/logs/llm-http?id=${encodeURIComponent(requestId)}`}
        className="max-w-[20rem] truncate font-mono text-slate-500 transition hover:text-slate-900 hover:underline"
        title={requestId}
      >
        id:{shortRequestId(requestId)}
      </Link>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200 hover:text-slate-800"
        title="复制 LLM Request ID"
        aria-label="复制 LLM Request ID"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  )
}

function RemoteAgentBubble({ message }: { message: ChatMessage }) {
  const metadata = message.content.metadata ?? {}
  const remoteAgent = recordMetadata(metadata.remote_agent) ?? {}
  const name = textMetadata(remoteAgent.name) ?? "Remote Agent"
  const instanceId = textMetadata(remoteAgent.instance_id) ?? textMetadata(remoteAgent.id)
  const workspace = textMetadata(remoteAgent.workspace)
  const displayText = textMetadata(metadata.display_text) ?? message.content.text
  const [copySucceeded, setCopySucceeded] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopyMessage = () => {
    void writeClipboardText(displayText)
      .then(() => {
        setCopySucceeded(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySucceeded(false)
          copyFeedbackTimeoutRef.current = null
        }, COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy message failed:", error)
      })
  }
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className="rounded-full bg-[#e5eef5] px-2 py-0.5 font-semibold text-[#263a63]">Remote Agent</span>
          <span className="max-w-40 truncate font-semibold text-slate-900" title={name}>{name}</span>
          {instanceId ? <span className="max-w-36 truncate text-slate-600" title={instanceId}>{instanceId}</span> : null}
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          {message.status === "accepted" ? <span>已接收</span> : null}
          <button
            type="button"
            onClick={handleCopyMessage}
            className={`${CHAT_META_BUTTON_BASE_CLASS} ${
              copySucceeded
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 focus:ring-emerald-400"
                : CHAT_META_BUTTON_IDLE_CLASS
            }`}
            title={copySucceeded ? "已复制" : "复制消息内容"}
            aria-label={copySucceeded ? "已复制消息内容" : "复制消息内容"}
          >
            {copySucceeded ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <article className={`${AGENT_FLAT_BUBBLE_CLASS} max-w-full`}>
          {workspace ? <div className="mb-2 max-w-full truncate text-xs font-medium text-slate-600" title={workspace}>工作区 {workspace}</div> : null}
          <MessageContent
            text={displayText}
            format={message.content.text_format}
            markdownCacheKey={messageContentMarkdownRenderCacheKey(message, "remote-agent-content", displayText)}
          />
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentGrid attachments={message.attachments} />
          ) : null}
        </article>
      </div>
    </div>
  )
}

function LocalAgentBubble({ message }: { message: ChatMessage }) {
  const metadata = message.content.metadata ?? {}
  const localAgent = recordMetadata(metadata.local_agent) ?? {}
  const name = textMetadata(localAgent.name) ?? textMetadata(localAgent.agent_definition_id) ?? "本地 Agent"
  const agentDefinitionId = textMetadata(localAgent.agent_definition_id)
  const instanceId = textMetadata(localAgent.instance_id)
  const displayText = textMetadata(metadata.display_text) ?? message.content.text
  const [copySucceeded, setCopySucceeded] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopyMessage = () => {
    void writeClipboardText(displayText)
      .then(() => {
        setCopySucceeded(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySucceeded(false)
          copyFeedbackTimeoutRef.current = null
        }, COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy message failed:", error)
      })
  }
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">本地 Agent</span>
          <span className="max-w-40 truncate font-semibold text-slate-900" title={name}>{name}</span>
          {agentDefinitionId ? <span className="max-w-36 truncate text-slate-600" title={agentDefinitionId}>{agentDefinitionId}</span> : null}
          {instanceId ? <span className="max-w-36 truncate text-slate-600" title={instanceId}>{instanceId}</span> : null}
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          {message.status === "accepted" ? <span>已接收</span> : null}
          <button
            type="button"
            onClick={handleCopyMessage}
            className={`${CHAT_META_BUTTON_BASE_CLASS} ${
              copySucceeded
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 focus:ring-emerald-400"
                : CHAT_META_BUTTON_IDLE_CLASS
            }`}
            title={copySucceeded ? "已复制" : "复制消息内容"}
            aria-label={copySucceeded ? "已复制消息内容" : "复制消息内容"}
          >
            {copySucceeded ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <article className={`${AGENT_FLAT_BUBBLE_CLASS} max-w-full`}>
          <MessageContent
            text={displayText}
            format={message.content.text_format}
            markdownCacheKey={messageContentMarkdownRenderCacheKey(message, "local-agent-content", displayText)}
          />
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentGrid attachments={message.attachments} />
          ) : null}
        </article>
      </div>
    </div>
  )
}

function ChatBubble({
  message,
  interactionResolution,
  interactionSelectedOptionId,
  onSubmitUserMessage,
  submitDisabled,
}: {
  message: ChatMessage
  interactionResolution?: InteractionResolution
  interactionSelectedOptionId?: string
  onSubmitUserMessage: (text: string, interactionSelection?: InteractionSelection) => void
  submitDisabled: boolean
}) {
  const isUser = message.role === "user"
  const options = !isUser ? message.interactionOptions ?? [] : []
  const selectedOptionId = interactionSelectedOptionId ?? message.selectedOptionId
  const resolvedInteraction = interactionResolution ?? (selectedOptionId ? "selected" : "active")
  const isInteractionActive = resolvedInteraction === "active"
  const buttonsDisabled = !isInteractionActive || submitDisabled
  const processedLabel = resolvedInteraction === "selected"
    ? "已选择"
    : resolvedInteraction === "custom_reply" ? "已自定义回复" : null
  const [copySucceeded, setCopySucceeded] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopyMessage = () => {
    void writeClipboardText(message.content.text)
      .then(() => {
        setCopySucceeded(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySucceeded(false)
          copyFeedbackTimeoutRef.current = null
        }, COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy message failed:", error)
      })
  }
  const bubbleContainerClassName = isUser
    ? "flex max-w-[72%] min-w-0 flex-col items-end"
    : AGENT_MESSAGE_GROUP_CLASS
  const bubbleClassName = isUser
    ? "min-w-0 w-fit max-w-full rounded-2xl border border-[#304875] bg-[#304875] p-4 text-white shadow-[0_12px_28px_rgba(48,72,117,0.18)]"
    : AGENT_FLAT_BUBBLE_CLASS
  const messageRowClassName = isUser ? "flex justify-end px-6 py-3" : AGENT_MESSAGE_ROW_CLASS
  return (
    <div className={messageRowClassName}>
      <div className={bubbleContainerClassName}>
        <div className={CHAT_META_CLASS}>
          {!isUser ? <span className={CHAT_META_LABEL_CLASS}>Agent</span> : null}
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          {message.status === "sending" ? <span>发送中</span> : null}
          {message.status === "accepted" ? <span>已接收</span> : null}
          <button
            type="button"
            onClick={handleCopyMessage}
            className={`${CHAT_META_BUTTON_BASE_CLASS} ${
              copySucceeded
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 focus:ring-emerald-400"
                : CHAT_META_BUTTON_IDLE_CLASS
            }`}
            title={copySucceeded ? "已复制" : "复制消息内容"}
            aria-label={copySucceeded ? "已复制消息内容" : "复制消息内容"}
          >
            {copySucceeded ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <article className={bubbleClassName}>
          <MessageContent
            text={message.content.text}
            format={message.content.text_format}
            inverted={isUser}
            markdownCacheKey={messageContentMarkdownRenderCacheKey(message, "chat-content", message.content.text, isUser)}
          />
          {message.attachments && message.attachments.length > 0 ? (
            <AttachmentGrid attachments={message.attachments} inverted={isUser} />
          ) : null}
          {options.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-3.5">
              {options.map((option) => {
                const isSelected = selectedOptionId === option.id
                const className = isInteractionActive
                  ? "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-950 shadow-sm transition hover:border-[#4f6f96]/55 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  : isSelected
                    ? "cursor-not-allowed rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-left text-sm text-emerald-800 shadow-sm"
                    : "cursor-not-allowed rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-left text-sm text-slate-500"
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={buttonsDisabled}
                    onClick={() => onSubmitUserMessage(option.label, { interactionMessageId: message.id, optionId: option.id })}
                    className={className}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {isSelected && resolvedInteraction === "selected" ? <CheckCircle2 size={14} className="text-emerald-600" /> : null}
                      <span>{option.label}</span>
                    </span>
                    {option.description ? (
                      <span
                        className={`mt-0.5 block text-xs ${
                          isInteractionActive ? "text-slate-600" : isSelected ? "text-emerald-700" : "text-slate-500"
                        }`}
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {processedLabel ? (
                <span
                  className={`ml-auto text-xs ${selectedOptionId ? "text-emerald-700" : "text-slate-500"}`}
                >
                  {processedLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  )
}

function AttachmentGrid({
  attachments,
  inverted = false,
  compact = false,
}: {
  attachments: UserMessageAttachment[]
  inverted?: boolean
  compact?: boolean
}) {
  return (
    <div className={`mt-3 flex max-w-full flex-wrap gap-2 ${compact ? "flex-col" : inverted ? "justify-end" : "justify-start"}`}>
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.resourceId}
          attachment={attachment}
          inverted={inverted}
          compact={compact}
        />
      ))}
    </div>
  )
}

function AttachmentCard({
  attachment,
  inverted,
  compact,
}: {
  attachment: UserMessageAttachment
  inverted: boolean
  compact: boolean
}) {
  const title = attachment.name ?? (attachment.kind === "pdf" ? "PDF 文件" : "图片")
  const meta = attachmentMeta(attachment)
  const [previewOpen, setPreviewOpen] = useState(false)
  const openPdf = () => {
    if (attachment.kind !== "pdf") return
    const url = `/pdf-viewer?resourceId=${encodeURIComponent(attachment.resourceId)}&name=${encodeURIComponent(title)}`
    const bridge = (window as Window & { spreadDesktop?: { openPdfWindow?: (targetUrl: string) => Promise<unknown>; openNewWindow?: () => Promise<unknown> } }).spreadDesktop
    if (bridge?.openPdfWindow) {
      void bridge.openPdfWindow(url)
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }
  if (attachment.kind === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className={`block overflow-hidden rounded-xl border text-left transition ${inverted ? "border-white/20 bg-[#1d3158]/35 hover:bg-[#1d3158]/45" : "border-slate-200 bg-white/80 hover:border-slate-300 hover:bg-slate-50"} ${compact ? "w-full" : "w-[23rem] max-w-full"}`}
        >
          <img
            src={fileResourceContentUrl(attachment.resourceId)}
            alt={title}
            className={compact ? "h-24 w-full object-cover" : "max-h-72 w-full object-cover"}
          />
          <div className={`flex items-center gap-2 px-3 py-2 text-xs ${inverted ? "text-slate-50/90" : "text-slate-700"}`}>
            <ImageIcon size={14} />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <span className="shrink-0 opacity-75">{meta}</span>
          </div>
        </button>
        {previewOpen ? (
          <ImagePreviewDialog
            title={title}
            meta={meta}
            resourceId={attachment.resourceId}
            preferredMimeType={attachment.mimeType}
            onClose={() => setPreviewOpen(false)}
          />
        ) : null}
      </>
    )
  }
  return (
    <button
      type="button"
      onClick={openPdf}
      className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${compact ? "w-full" : "w-[23rem] max-w-full"} ${
        inverted
          ? "border-white/20 bg-[#1d3158]/35 text-slate-50 hover:bg-[#1d3158]/45"
          : "border-slate-200 bg-white/80 text-slate-900 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${inverted ? "bg-white/15" : "bg-red-50 text-red-700"}`}>
        <FileText size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className={`block truncate text-xs ${inverted ? "text-slate-100/75" : "text-slate-500"}`}>{meta} · 点击阅读</span>
      </span>
    </button>
  )
}

function attachmentMeta(attachment: UserMessageAttachment): string {
  const size = formatBytes(attachment.sizeInBytes)
  if (attachment.kind === "pdf" && attachment.pageCount) return `${attachment.pageCount} 页 · ${size}`
  if (attachment.kind === "image" && attachment.width && attachment.height) return `${attachment.width}×${attachment.height} · ${size}`
  return size
}

function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return "附件"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function ImagePreviewDialog({
  title,
  meta,
  resourceId,
  preferredMimeType,
  onClose,
}: {
  title: string
  meta: string
  resourceId: string
  preferredMimeType?: string | null
  onClose: () => void
}) {
  const locatorDetails = useResourceLocatorDetails(resourceId)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/75 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`预览图片 ${title}`}>
      <button type="button" aria-label="关闭图片预览" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="text-xs text-slate-400">{meta}</div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white" aria-label="关闭图片预览">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black">
          <div className="p-3 sm:p-4">
            <CopyablePreviewImage
              src={fileResourceContentUrl(resourceId)}
              alt={title}
              preferredMimeType={preferredMimeType}
              className="mx-auto max-h-[52dvh] max-w-full object-contain sm:max-h-[calc(100vh-13rem)]"
            />
          </div>
          <ResourceLocatorPanel details={locatorDetails} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ToolCallBubble({ message }: { message: ChatMessage }) {
  const tool = buildLegacyToolDisplay(message)
  if (!hasToolConversationContent(tool)) return null
  return (
    <div className={AGENT_MESSAGE_ROW_CLASS}>
      <div className={AGENT_MESSAGE_GROUP_CLASS}>
        <div className={CHAT_META_CLASS}>
          <span className={CHAT_META_LABEL_CLASS}>Tool</span>
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        </div>
        <article className={AGENT_FLAT_BUBBLE_CLASS}>
          <ToolContentProjection tool={tool} />
        </article>
      </div>
    </div>
  )
}

function buildLegacyToolDisplay(message: ChatMessage): ToolCallDisplay {
  const metadata = message.content.metadata ?? {}
  const toolName = textMetadata(metadata.tool_name) ?? textMetadata(metadata.title) ?? message.content.text
  const title = textMetadata(metadata.title) ?? toolName
  const rawStatus = textMetadata(metadata.tool_status) ?? message.status
  const status = rawStatus === "cancelled" ? "cancelled" : rawStatus === "failed" ? "failed" : rawStatus === "running" || rawStatus === "streaming" ? "running" : "completed"
  const durationMs = numberMetadata(metadata.duration_ms)
  const errorMessage = textMetadata(metadata.error_message)
  return {
    toolCallId: textMetadata(metadata.tool_call_id) ?? message.id,
    toolName,
    title,
    status,
    durationMs,
    errorMessage: errorMessage ?? undefined,
    argumentsPreview: recordMetadata(metadata.arguments_preview) ?? null,
    resultPreview: metadata.result_preview ?? null,
    uiPreview: recordMetadata(metadata.ui_preview) ?? null,
    source: textMetadata(metadata.source),
  }
}

function ToolCallRow({ tool }: { tool: ToolCallDisplay }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ToolParameterTab>("request")
  const generatedImages = getGeneratedImageResources(tool.uiPreview)
  const generatedImageResultText = generatedImages.length > 0 ? getGeneratedImageResultText(tool.resultPreview) : null
  const htmlDocument = getToolHtmlContent(tool)
  return (
    <div className="relative min-w-0 px-3 py-1 text-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {tool.status === "running" ? <Circle size={10} className="shrink-0 text-[#4f6f96]" /> : null}
          {tool.status === "completed" ? <Check size={12} className="shrink-0 text-teal-600" /> : null}
          {tool.status === "cancelled" ? <X size={12} className="shrink-0 text-slate-400" /> : null}
          {tool.status === "failed" ? <X size={12} className="shrink-0 text-red-500" /> : null}
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="block max-w-full truncate rounded font-mono text-[13px] text-slate-900 underline-offset-2 transition hover:text-[#263a63] hover:underline focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/30"
              title="查看工具请求和响应参数"
              aria-expanded={detailsOpen}
            >
              {tool.toolName}
            </button>
            {tool.title !== tool.toolName ? <div className="truncate text-xs text-slate-600">{tool.title}</div> : null}
            {tool.errorMessage ? <div className="truncate text-xs text-red-600">{tool.errorMessage}</div> : null}
          </div>
        </div>
        <div className="shrink-0 text-xs text-slate-600">{toolDurationLabel(tool)}</div>
      </div>
      {generatedImageResultText ? <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{generatedImageResultText}</div> : null}
      {generatedImages.length > 0 ? <GeneratedImageGrid images={generatedImages} /> : null}
      {htmlDocument ? <HtmlDocumentResult htmlContent={htmlDocument} /> : null}
      {detailsOpen ? (
        <ToolParametersPopover
          tool={tool}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
    </div>
  )
}

function HtmlDocumentResult({ htmlContent }: { htmlContent: string }) {
  return <HtmlDocumentContent html={htmlContent} className="html-document mt-3 min-w-0 overflow-auto" />
}

function GeneratedImageGrid({ images }: { images: GeneratedImageResourcePreview[] }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((image, index) => (
        <GeneratedImageCard key={`${image.resourceId}:${index}`} image={image} index={index} />
      ))}
    </div>
  )
}

function GeneratedImageCard({ image, index }: { image: GeneratedImageResourcePreview; index: number }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const title = `生成图片 ${index + 1}`
  const meta = image.mimeType ?? "image"
  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-slate-300 hover:bg-slate-50"
      >
        <img src={fileResourceContentUrl(image.resourceId)} alt={title} className="h-40 w-full object-cover" />
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700">
          <ImageIcon size={14} />
          <span className="min-w-0 flex-1 truncate">{image.revisedPrompt || title}</span>
          <span className="shrink-0 opacity-75">{meta}</span>
        </div>
      </button>
      {previewOpen ? (
        <ImagePreviewDialog title={title} meta={meta} resourceId={image.resourceId} preferredMimeType={image.mimeType} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </>
  )
}

function ToolParametersPopover({
  tool,
  activeTab,
  onActiveTabChange,
  onClose,
}: {
  tool: ToolCallDisplay
  activeTab: ToolParameterTab
  onActiveTabChange: (tab: ToolParameterTab) => void
  onClose: () => void
}) {
  const value = activeTab === "request" ? tool.argumentsPreview : tool.resultPreview
  const formattedParameters = formatToolParameters(value, activeTab)
  const [copySucceeded, setCopySucceeded] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  useEffect(() => {
    setCopySucceeded(false)
  }, [activeTab])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])
  const handleCopyParameters = () => {
    void writeClipboardText(formattedParameters)
      .then(() => {
        setCopySucceeded(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySucceeded(false)
          copyFeedbackTimeoutRef.current = null
        }, COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy tool parameters failed:", error)
      })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`查看工具参数 ${tool.toolName}`}>
      <button type="button" aria-label="关闭工具参数浮层" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-medium text-slate-800">{tool.toolName}</div>
            {tool.title !== tool.toolName ? <div className="truncate text-xs text-slate-500">{tool.title}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/30"
          >
            关闭
          </button>
        </div>
        <div className="flex shrink-0 items-end gap-3 border-b border-slate-200 px-3 pt-2">
          <div className="flex min-w-0">
            <ToolParameterTabButton active={activeTab === "request"} onClick={() => onActiveTabChange("request")}>
              请求
            </ToolParameterTabButton>
            <ToolParameterTabButton active={activeTab === "response"} onClick={() => onActiveTabChange("response")}>
              响应
            </ToolParameterTabButton>
          </div>
          <button
            type="button"
            onClick={handleCopyParameters}
            title={copySucceeded ? "已复制" : activeTab === "request" ? "复制请求 JSON" : "复制响应 JSON"}
            aria-label={copySucceeded ? "已复制" : activeTab === "request" ? "复制请求 JSON" : "复制响应 JSON"}
            className={`mb-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-xs transition focus:outline-none focus:ring-2 ${
              copySucceeded
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 focus:ring-emerald-400"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:ring-[#4f6f96]/30"
            }`}
          >
            {copySucceeded ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-white p-4 font-mono text-xs leading-relaxed text-slate-800">
          {formattedParameters}
        </pre>
      </div>
    </div>,
    document.body,
  )
}

function ToolParameterTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-lg px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/30 ${
        active
          ? "border border-b-white border-slate-200 bg-white text-slate-900"
          : "border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  )
}

function isRemoteAgentMessage(message: ChatMessage): boolean {
  if (message.role === "remote_agent") return true
  const metadata = message.content.metadata ?? {}
  return metadata.source_type === "remote_agent" || metadata.transport === "lacp" || message.content.channel === "lacp"
}

function isLocalAgentMessage(message: ChatMessage): boolean {
  if (message.role === "local_agent") return true
  const metadata = message.content.metadata ?? {}
  return metadata.source_type === "local_agent" || metadata.transport === "subagent" || message.content.channel === "subagent"
}

function textMetadata(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function getGeneratedImageResources(uiPreview: Record<string, unknown> | null | undefined): GeneratedImageResourcePreview[] {
  return parseGeneratedImageResources(uiPreview)
}

function getToolHtmlContent(tool: ToolCallDisplay): string | null {
  return userVisibleToolResultHtmlContent(tool.uiPreview, tool.resultPreview)
}

function getGeneratedImageResultText(resultPreview: unknown): string | null {
  if (typeof resultPreview === "string") return resultPreview.trim() || null
  if (Array.isArray(resultPreview)) {
    const texts = resultPreview.flatMap((item) => {
      const record = recordMetadata(item)
      if (!record) return []
      const kind = textMetadata(record.kind) ?? textMetadata(record.type)
      const text = textMetadata(record.text)
      if (!text || (kind && kind !== "text")) return []
      return [text]
    })
    return texts.join("\n\n").trim() || null
  }
  const record = recordMetadata(resultPreview)
  if (!record) return null
  const kind = textMetadata(record.kind) ?? textMetadata(record.type)
  const text = textMetadata(record.text) ?? textMetadata(record.message)
  if (!text || (kind && kind !== "text")) return null
  return text.trim() || null
}

function toolDurationLabel(tool: Pick<ToolCallDisplay, "status" | "durationMs" | "source">): string {
  if (tool.status === "running") return tool.source === "llm_generated" ? "生成中..." : "执行中..."
  if (tool.status === "cancelled") return "已取消"
  if (tool.status === "failed") return "失败"
  return tool.durationMs !== undefined ? formatDuration(tool.durationMs) : "完成"
}

function formatToolParameters(value: unknown, tab: ToolParameterTab) {
  if (value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return tab === "request" ? "暂无请求参数" : "暂无响应参数"
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatThinkingDuration(durationMs: number) {
  return `${Math.max(0, Math.round(durationMs / 1000))}s`
}

function shortRequestId(requestId: string) {
  if (requestId.length <= 32) return requestId
  return `${requestId.slice(0, 18)}…${requestId.slice(-10)}`
}

function formatDuration(durationMs: number) {
  if (durationMs >= 1000) {
    const seconds = durationMs / 1000
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  }
  return `${durationMs}ms`
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("document.execCommand copy failed")
}



