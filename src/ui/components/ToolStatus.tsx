import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface ToolStatusProps {
  tool: string;
  status: "running" | "complete" | "error";
  detail?: string;
}

// Extract a human-readable detail from tool args
export function extractToolDetail(tool: string, args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const primary = args.filepath || args.path || args.pattern || args.file || args.directory;
  if (primary && typeof primary === "string") {
    // Show only the filename or last path component
    const parts = primary.split("/");
    return parts[parts.length - 1] || primary;
  }
  return undefined;
}

export const ToolStatus = React.memo(function ToolStatus({ tool, status, detail }: ToolStatusProps): React.ReactElement {
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
          {detail && (
            <Text color="gray"> ({detail})</Text>
          )}
        </>
      ) : status === "complete" ? (
        <>
          <Text color="green">✓ </Text>
          <Text color="gray">Tool completed: </Text>
          <Text color="white">{tool}</Text>
          {detail && (
            <Text color="gray"> ({detail})</Text>
          )}
        </>
      ) : (
        <>
          <Text color="red">✗ </Text>
          <Text color="gray">Tool failed: </Text>
          <Text color="red">{tool}</Text>
          {detail && (
            <Text color="gray"> ({detail})</Text>
          )}
        </>
      )}
    </Box>
  );
});
