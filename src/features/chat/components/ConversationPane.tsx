import { memo } from "react"

import { MessageList, type MessageListPresentation } from "@/features/chat/components/MessageList"
import type { InteractionSelection, QueuedUserMessage } from "@/features/chat/model/chatTypes"
import type { UserMessageAttachment } from "@/features/chat/api/fileResourceApi"

export type ConversationPaneProps = {
  sceneId: string
  agentInstanceId: string
  onSubmitUserMessage: (
    text: string,
    attachmentsOrSelection?: UserMessageAttachment[] | InteractionSelection,
    maybeSelection?: InteractionSelection,
  ) => void
  onRecallQueuedUserMessage: (message: QueuedUserMessage) => void
  submitDisabled: boolean
  presentation?: MessageListPresentation
}

/**
 * 独立的左侧会话容器边界。
 *
 * 仅接收原始标识（sceneId、agentInstanceId）与稳定 action 回调，
 * 严禁向其传递共享 runtimeState 对象。配合 React.memo，在父层 control-plane
 * 触发轻量刷新时能够完全 Bailout，隔绝不相关重渲。
 */
export const ConversationPane = memo(function ConversationPane({
  sceneId,
  agentInstanceId,
  onSubmitUserMessage,
  onRecallQueuedUserMessage,
  submitDisabled,
  presentation = "desktop",
}: ConversationPaneProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <MessageList
        sceneId={sceneId}
        agentInstanceId={agentInstanceId}
        onSubmitUserMessage={onSubmitUserMessage}
        onRecallQueuedUserMessage={onRecallQueuedUserMessage}
        submitDisabled={submitDisabled}
        presentation={presentation}
      />
    </div>
  )
})
