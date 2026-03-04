import React from "react";
import { Box, Text, Static } from "ink";

interface ToolCall {
  tool: string;
  status: "running" | "complete" | "error";
  result?: string;
  detail?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

interface MessageListProps {
  messages: Message[];
}

export const MessageList = React.memo(function MessageList({ messages }: MessageListProps): React.ReactElement {
  if (messages.length === 0) {
    return (
      <Box marginY={1}>
        <Text color="gray">Start a conversation by typing below...</Text>
      </Box>
    );
  }

  // Continue-style: completed messages → <Static> (rendered once, never re-rendered by Ink)
  // Only the last message stays in the dynamic area (can update for streaming/tool calls)
  const stableCount = Math.max(0, messages.length - 1);
  const stableMessages = messages.slice(0, stableCount);
  const pendingMessages = messages.slice(stableCount);

  return (
    <Box flexDirection="column">
      <Static items={stableMessages}>
        {(message) => (
          <MessageItem key={message.id} message={message} />
        )}
      </Static>
      {pendingMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </Box>
  );
});

const MessageItem = React.memo(function MessageItem({ message }: { message: Message }): React.ReactElement {
  const isUser = message.role === "user";

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={isUser ? "green" : "cyan"} bold>
          {isUser ? "You" : "ACTIVO"}
        </Text>
      </Box>

      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginY={1}>
          {message.toolCalls.map((tc, idx) => (
            <Box key={idx}>
              <Text color="gray">
                {tc.status === "running" ? "○" : tc.status === "complete" ? "●" : "✗"}{" "}
              </Text>
              <Text color={tc.status === "error" ? "red" : "yellow"}>{tc.tool}</Text>
              {tc.detail && (
                <Text color="gray"> ({tc.detail})</Text>
              )}
              {tc.status === "complete" && tc.result && (
                <Text color="gray"> - {truncate(tc.result, 50)}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {message.content && (
        <Box marginLeft={2}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      )}
    </Box>
  );
});

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
