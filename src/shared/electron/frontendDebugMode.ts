type SpreadDesktopBridge = {
  isElectron?: boolean
  isDebugMode?: boolean
}

type DebugWindow = Window & {
  spreadDesktop?: SpreadDesktopBridge
  __spreadElectronFrontendDebugInstalled?: boolean
}

type ToolbarState = "idle" | "selecting" | "copying"

type ToolbarDragState = {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
  moved: boolean
}

type DebugElementInfo = {
  page_url: string
  document_title: string
  selector: string
  xpath: string
  tag_name: string
  id: string | null
  class_name: string | null
  text: string
  outer_html: string
  attributes: Record<string, string>
  bounding_rect: {
    x: number
    y: number
    width: number
    height: number
    top: number
    left: number
    bottom: number
    right: number
  }
  viewport: { width: number; height: number }
}

type DebugElementSnapshot = {
  source: "web-frontend.electron-debug"
  captured_at: string
  page: {
    url: string
    title: string
    viewport: { width: number; height: number }
  }
  element: DebugElementInfo
}

const DEBUG_UI_ATTRIBUTE = "data-spread-electron-debug-ui"
const DEBUG_UI_SELECTOR = `[${DEBUG_UI_ATTRIBUTE}]`
const TOOLBAR_DRAG_THRESHOLD_PX = 3
const TOOLBAR_VIEWPORT_MARGIN_PX = 8

export function installElectronFrontendDebugMode() {
  const debugWindow = window as DebugWindow
  if (debugWindow.__spreadElectronFrontendDebugInstalled) return
  if (!debugWindow.spreadDesktop?.isElectron || !debugWindow.spreadDesktop.isDebugMode) return
  debugWindow.__spreadElectronFrontendDebugInstalled = true

  let selecting = false
  let selectedElement: Element | null = null
  let lastHoveredElement: Element | null = null
  let toolbarDragState: ToolbarDragState | null = null
  let suppressNextToolbarClick = false

  const overlay = document.createElement("div")
  overlay.setAttribute(DEBUG_UI_ATTRIBUTE, "overlay")
  applyStyles(overlay, {
    position: "fixed",
    zIndex: "2147483646",
    pointerEvents: "none",
    border: "2px solid #2563eb",
    background: "rgba(37, 99, 235, 0.12)",
    borderRadius: "3px",
    display: "none",
    boxSizing: "border-box",
  })
  document.documentElement.appendChild(overlay)

  const toolbar = document.createElement("div")
  toolbar.setAttribute(DEBUG_UI_ATTRIBUTE, "toolbar")
  applyStyles(toolbar, {
    position: "fixed",
    top: "48px",
    right: "12px",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px",
    borderRadius: "10px",
    border: "1px solid rgba(15, 23, 42, 0.18)",
    background: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: "12px",
    color: "#0f172a",
    cursor: "move",
    userSelect: "none",
    touchAction: "none",
  })

  const chooseButton = createButton("选择元素")
  const statusText = document.createElement("span")
  applyStyles(statusText, {
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  })
  toolbar.append(chooseButton, statusText)
  document.documentElement.appendChild(toolbar)
  renderToolbarState("idle")

  chooseButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (selecting || selectedElement) {
      cancelSelection()
    } else {
      startSelecting()
    }
  })

  toolbar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    if (event.target instanceof Node && chooseButton.contains(event.target)) {
      suppressNextToolbarClick = false
      return
    }
    const rect = toolbar.getBoundingClientRect()
    toolbarDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    }
    toolbar.setPointerCapture(event.pointerId)
  })

  toolbar.addEventListener("pointermove", (event) => {
    if (!toolbarDragState || toolbarDragState.pointerId !== event.pointerId) return
    const deltaX = event.clientX - toolbarDragState.startX
    const deltaY = event.clientY - toolbarDragState.startY
    if (!toolbarDragState.moved && Math.hypot(deltaX, deltaY) < TOOLBAR_DRAG_THRESHOLD_PX) return
    toolbarDragState.moved = true
    suppressNextToolbarClick = true
    placeToolbar(
      toolbar,
      toolbarDragState.startLeft + deltaX,
      toolbarDragState.startTop + deltaY,
    )
  })

  toolbar.addEventListener("pointerup", finishToolbarDrag)
  toolbar.addEventListener("pointercancel", finishToolbarDrag)
  toolbar.addEventListener("click", (event) => {
    if (!suppressNextToolbarClick) return
    suppressNextToolbarClick = false
    event.preventDefault()
    event.stopPropagation()
  }, true)

  function renderToolbarState(state: ToolbarState, message?: string) {
    const hasMessage = Boolean(message)
    chooseButton.textContent = state === "idle" ? "选择元素" : "取消选择"
    chooseButton.disabled = state === "copying"
    statusText.style.display = hasMessage ? "inline" : "none"
    statusText.textContent = hasMessage ? message ?? "" : ""
  }

  function resetSelection() {
    selecting = false
    selectedElement = null
    lastHoveredElement = null
    document.removeEventListener("mousemove", handleMouseMove, true)
    document.removeEventListener("click", handleElementClick, true)
    document.removeEventListener("keydown", handleKeyDown, true)
    hideOverlay()
    renderToolbarState("idle")
  }

  function cancelSelection() {
    resetSelection()
  }

  function startSelecting() {
    selecting = true
    selectedElement = null
    lastHoveredElement = null
    hideOverlay()
    renderToolbarState("selecting", "移动鼠标选择元素")
    document.addEventListener("mousemove", handleMouseMove, true)
    document.addEventListener("click", handleElementClick, true)
    document.addEventListener("keydown", handleKeyDown, true)
  }

  function stopSelecting() {
    selecting = false
    document.removeEventListener("mousemove", handleMouseMove, true)
    document.removeEventListener("click", handleElementClick, true)
    document.removeEventListener("keydown", handleKeyDown, true)
  }

  function handleMouseMove(event: MouseEvent) {
    if (!selecting) return
    const element = findSelectableElement(event.target)
    if (!element || element === lastHoveredElement) return
    lastHoveredElement = element
    showOverlay(element)
    renderToolbarState("selecting", describeElement(element))
  }

  function handleElementClick(event: MouseEvent) {
    if (!selecting) return
    const element = findSelectableElement(event.target)
    if (!element) return
    event.preventDefault()
    event.stopPropagation()
    selectedElement = element
    showOverlay(element)
    stopSelecting()
    void copySelectedElement()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    cancelSelection()
  }

  async function copySelectedElement() {
    if (!selectedElement) return
    renderToolbarState("copying", "正在复制到剪切板...")
    const snapshot = buildElementSnapshot(selectedElement)
    try {
      await writeClipboardText(formatElementClipboardText(snapshot))
      resetSelection()
      renderToolbarState("idle", "已复制元素信息")
    } catch (error) {
      console.error("[electron-frontend-debug] copy selected element failed", error)
      resetSelection()
      renderToolbarState("idle", "复制失败，查看控制台")
    }
  }

  function findSelectableElement(candidate: EventTarget | null): Element | null {
    if (!(candidate instanceof Element)) return null
    if (candidate.closest(DEBUG_UI_SELECTOR)) return null
    return candidate
  }

  function showOverlay(element: Element) {
    const rect = element.getBoundingClientRect()
    applyStyles(overlay, {
      display: "block",
      left: `${Math.max(rect.left, 0)}px`,
      top: `${Math.max(rect.top, 0)}px`,
      width: `${Math.max(rect.width, 0)}px`,
      height: `${Math.max(rect.height, 0)}px`,
    })
  }

  function hideOverlay() {
    overlay.style.display = "none"
  }

  function finishToolbarDrag(event: PointerEvent) {
    if (!toolbarDragState || toolbarDragState.pointerId !== event.pointerId) return
    if (toolbar.hasPointerCapture(event.pointerId)) {
      toolbar.releasePointerCapture(event.pointerId)
    }
    toolbarDragState = null
  }
}

function buildElementSnapshot(element: Element): DebugElementSnapshot {
  return {
    source: "web-frontend.electron-debug",
    captured_at: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    element: serializeElement(element),
  }
}

function serializeElement(element: Element): DebugElementInfo {
  const rect = element.getBoundingClientRect()
  const attributes: Record<string, string> = {}
  for (const attr of Array.from(element.attributes || []).slice(0, 30)) {
    attributes[attr.name] = limit(attr.value, 1000)
  }
  return {
    page_url: location.href,
    document_title: document.title,
    selector: buildCssSelector(element),
    xpath: buildXPath(element),
    tag_name: element.tagName.toLowerCase(),
    id: element.id || null,
    class_name: elementClassName(element),
    text: limit(elementText(element).trim(), 2000),
    outer_html: limit(element.outerHTML || "", 8000),
    attributes,
    bounding_rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

function formatElementClipboardText(snapshot: DebugElementSnapshot): string {
  const element = snapshot.element
  const rect = element.bounding_rect
  const lines = [
    "前端页面元素信息：",
    "",
    `- 来源：${snapshot.source}`,
    `- 采集时间：${snapshot.captured_at}`,
    `- 页面 URL：${snapshot.page.url}`,
    `- 文档标题：${snapshot.page.title || "未知"}`,
    `- 元素标签：${element.tag_name || "未知"}`,
    `- CSS Selector：${element.selector || "未知"}`,
    `- XPath：${element.xpath || "未知"}`,
    `- 元素 ID：${element.id || "无"}`,
    `- 元素 class：${element.class_name || "无"}`,
    `- 元素位置：x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}`,
    `- 视口尺寸：width=${element.viewport.width}, height=${element.viewport.height}`,
    "",
    "元素文本：",
    "```text",
    element.text || "<empty>",
    "```",
    "",
    "元素属性：",
    "```json",
    JSON.stringify(element.attributes, null, 2),
    "```",
    "",
    "元素 HTML：",
    "```html",
    element.outer_html || "<empty>",
    "```",
  ]
  return lines.join("\n")
}

function createButton(text: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = text
  applyStyles(button, {
    border: "1px solid #cbd5e1",
    borderRadius: "7px",
    padding: "5px 9px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: "12px",
    lineHeight: "16px",
  })
  button.addEventListener("mouseenter", () => {
    if (!button.disabled) button.style.background = "#f1f5f9"
  })
  button.addEventListener("mouseleave", () => {
    button.style.background = "#ffffff"
  })
  return button
}

function applyStyles<TElement extends HTMLElement>(element: TElement, styles: Partial<CSSStyleDeclaration>): TElement {
  Object.assign(element.style, styles)
  return element
}

function placeToolbar(toolbar: HTMLElement, left: number, top: number) {
  const rect = toolbar.getBoundingClientRect()
  const maxLeft = Math.max(TOOLBAR_VIEWPORT_MARGIN_PX, window.innerWidth - rect.width - TOOLBAR_VIEWPORT_MARGIN_PX)
  const maxTop = Math.max(TOOLBAR_VIEWPORT_MARGIN_PX, window.innerHeight - rect.height - TOOLBAR_VIEWPORT_MARGIN_PX)
  toolbar.style.left = `${clamp(left, TOOLBAR_VIEWPORT_MARGIN_PX, maxLeft)}px`
  toolbar.style.top = `${clamp(top, TOOLBAR_VIEWPORT_MARGIN_PX, maxTop)}px`
  toolbar.style.right = "auto"
  toolbar.style.bottom = "auto"
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function elementText(element: Element): string {
  if (element instanceof HTMLElement) return element.innerText || element.textContent || ""
  return element.textContent || ""
}

function elementClassName(element: Element): string | null {
  return typeof element.className === "string" && element.className ? element.className : null
}

function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : ""
  const className = elementClassName(element)
  const cls = className?.trim()
    ? `.${className.trim().split(/\s+/).slice(0, 3).join(".")}`
    : ""
  return `${element.tagName.toLowerCase()}${id}${cls}`
}

function buildCssSelector(element: Element): string {
  const escapeCss = (value: string) =>
    window.CSS && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
  if (element.id) return `#${escapeCss(element.id)}`
  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    let part = current.tagName.toLowerCase()
    const classList = Array.from(current.classList || []).slice(0, 3)
    if (classList.length) part += `.${classList.map((item) => escapeCss(item)).join(".")}`
    const parent: Element | null = current.parentElement
    if (parent) {
      const currentTagName = current.tagName
      const sameTagSiblings: Element[] = []
      for (const child of Array.from(parent.children) as Element[]) {
        if (child.tagName === currentTagName) sameTagSiblings.push(child)
      }
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    current = parent
    if (parts.length >= 6) break
  }
  return parts.join(" > ")
}

function buildXPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1
    let sibling = current.previousElementSibling
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1
      sibling = sibling.previousElementSibling
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`)
    current = current.parentElement
  }
  return `/${parts.join("/")}`
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  applyStyles(textarea, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    opacity: "0",
  })
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("document.execCommand copy failed")
}

function limit(value: string | null | undefined, maxLength: number): string {
  const text = value || ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...<truncated ${text.length - maxLength} chars>`
}
