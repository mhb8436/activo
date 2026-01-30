import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isProcessing: boolean;
  placeholder?: string;
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  isProcessing,
  placeholder,
}: InputBoxProps): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor={isProcessing ? "gray" : "cyan"} paddingX={1}>
      <Text color="green" bold>
        {isProcessing ? "⏳" : "❯"}{" "}
      </Text>
      {isProcessing ? (
        <Text color="gray">Processing...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
}
