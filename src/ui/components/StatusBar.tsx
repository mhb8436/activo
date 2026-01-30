import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  model: string;
  isProcessing: boolean;
  messageCount: number;
}

export function StatusBar({
  model,
  isProcessing,
  messageCount,
}: StatusBarProps): React.ReactElement {
  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={1}>
      <Box>
        <Text color="gray">Model: </Text>
        <Text color="cyan">{model}</Text>
      </Box>

      <Box>
        <Text color="gray">Messages: </Text>
        <Text color="white">{messageCount}</Text>
      </Box>

      <Box>
        {isProcessing ? (
          <Text color="yellow">● Processing</Text>
        ) : (
          <Text color="green">● Ready</Text>
        )}
      </Box>
    </Box>
  );
}
