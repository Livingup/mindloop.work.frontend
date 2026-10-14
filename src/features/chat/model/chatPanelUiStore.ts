import { create } from "zustand"

export type ConversationScrollState = {
  isAtBottom: boolean
  topMessageIdentity: string | null
}

type ChatPanelUiStore = {
  conversationScrollStates: Record<string, ConversationScrollState>
  patchConversationScrollState: (scopeId: string, patch: Partial<ConversationScrollState>) => void
  removeConversationScrollState: (scopeId: string) => void
}

export const useChatPanelUiStore = create<ChatPanelUiStore>((set) => ({
  conversationScrollStates: {},
  patchConversationScrollState: (scopeId, patch) =>
    set((state) => {
      const existing = state.conversationScrollStates[scopeId]
      const nextState: ConversationScrollState = {
        isAtBottom: patch.isAtBottom ?? existing?.isAtBottom ?? true,
        topMessageIdentity: patch.topMessageIdentity !== undefined
          ? patch.topMessageIdentity
          : existing?.topMessageIdentity ?? null,
      }
      if (
        existing?.isAtBottom === nextState.isAtBottom &&
        existing.topMessageIdentity === nextState.topMessageIdentity
      ) {
        return state
      }
      return {
        conversationScrollStates: {
          ...state.conversationScrollStates,
          [scopeId]: nextState,
        },
      }
    }),
  removeConversationScrollState: (scopeId) =>
    set((state) => {
      if (!state.conversationScrollStates[scopeId]) return state
      const { [scopeId]: _removed, ...rest } = state.conversationScrollStates
      return { conversationScrollStates: rest }
    }),
}))
