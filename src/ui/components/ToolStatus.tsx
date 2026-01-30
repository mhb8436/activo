import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface ToolStatusProps {
  tool: string;
  status: "running" | "complete" | "error";
}

export function ToolStatus({ tool, status }: ToolStatusProps): React.ReactElement {
  return (
    <Box marginY={1} paddingX={1}>
      {status === "running" ? (
        <>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text color="cyan"> Using tool: </Text>
          <Text color="yellow" bold>
            {tool}
          </Text>
        </>
      ) : status === "complete" ? (
        <>
          <Text color="green">✓ </Text>
          <Text color="gray">Tool completed: </Text>
          <Text color="white">{tool}</Text>
        </>
      ) : (
        <>
          <Text color="red">✗ </Text>
          <Text color="gray">Tool failed: </Text>
          <Text color="red">{tool}</Text>
        </>
      )}
    </Box>
  );
}
