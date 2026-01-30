import React from "react";
import { Box, Text } from "ink";

interface ToolCall {
  tool: string;
  status: "running" | "complete" | "error";
  result?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  if (messages.length === 0) {
    return (
      <Box marginY={1}>
        <Text color="gray">Start a conversation by typing below...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <MessageItem key={index} message={message} />
      ))}
    </Box>
  );
}

function MessageItem({ message }: { message: Message }): React.ReactElement {
  const isUser = message.role === "user";

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Role indicator */}
      <Box>
        <Text color={isUser ? "green" : "cyan"} bold>
          {isUser ? "You" : "ACTIVO"}
        </Text>
      </Box>

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginY={1}>
          {message.toolCalls.map((tc, idx) => (
            <Box key={idx}>
              <Text color="gray">
                {tc.status === "running" ? "🔄" : tc.status === "complete" ? "✓" : "✗"}{" "}
              </Text>
              <Text color={tc.status === "error" ? "red" : "yellow"}>{tc.tool}</Text>
              {tc.status === "complete" && tc.result && (
                <Text color="gray"> - {truncate(tc.result, 50)}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Content */}
      {message.content && (
        <Box marginLeft={2}>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      )}
    </Box>
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
