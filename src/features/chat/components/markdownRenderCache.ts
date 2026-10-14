const MARKDOWN_RENDER_CACHE_TTL_MS = 30 * 60 * 1000

type MarkdownRenderCacheEntry = {
  html: string
  timeoutId: number | null
}

const markdownRenderCache = new Map<string, MarkdownRenderCacheEntry>()

export function createMarkdownRenderCacheKey({
  ownerId,
  slot,
  text,
  inverted = false,
}: {
  ownerId: string
  slot: string
  text: string
  inverted?: boolean
}): string {
  return [
    "markdown",
    encodeCacheSegment(ownerId),
    encodeCacheSegment(slot),
    inverted ? "inverted" : "normal",
    text.length.toString(36),
    hashText(text),
  ].join(":")
}

export function getOrCreateMarkdownRenderCacheHtml(cacheKey: string, renderHtml: () => string): string {
  const existing = markdownRenderCache.get(cacheKey)
  if (existing) return existing.html

  const html = renderHtml()
  const timeoutId = typeof window === "undefined"
    ? null
    : window.setTimeout(() => {
      markdownRenderCache.delete(cacheKey)
    }, MARKDOWN_RENDER_CACHE_TTL_MS)

  markdownRenderCache.set(cacheKey, {
    html,
    timeoutId,
  })
  return html
}

export function retainMarkdownRenderCacheKeys(activeCacheKeys: Iterable<string>): void {
  const activeCacheKeySet = new Set(activeCacheKeys)
  markdownRenderCache.forEach((entry, cacheKey) => {
    if (activeCacheKeySet.has(cacheKey)) return
    clearMarkdownRenderCacheEntry(entry)
    markdownRenderCache.delete(cacheKey)
  })
}

export function clearMarkdownRenderCache(): void {
  markdownRenderCache.forEach(clearMarkdownRenderCacheEntry)
  markdownRenderCache.clear()
}

function clearMarkdownRenderCacheEntry(entry: MarkdownRenderCacheEntry): void {
  if (entry.timeoutId !== null && typeof window !== "undefined") {
    window.clearTimeout(entry.timeoutId)
  }
}

function encodeCacheSegment(value: string): string {
  return encodeURIComponent(value)
}

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
