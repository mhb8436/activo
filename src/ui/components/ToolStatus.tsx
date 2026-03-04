import React from "react";
import { Box, Text } from "ink";

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
  const icon = status === "running" ? "⟳" : status === "complete" ? "✓" : "✗";
  const iconColor = status === "running" ? "cyan" : status === "complete" ? "green" : "red";
  const label = status === "running" ? "Using tool:" : status === "complete" ? "Tool completed:" : "Tool failed:";

  return (
    <Box paddingX={1}>
      <Text color={iconColor}>{icon} </Text>
      <Text color={status === "running" ? "cyan" : "gray"}>{label} </Text>
      <Text color={status === "running" ? "yellow" : status === "error" ? "red" : "white"} bold={status === "running"}>
        {tool}
      </Text>
      {detail && <Text color="gray"> ({detail})</Text>}
    </Box>
  );
});
