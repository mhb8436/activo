import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
  onSubmit: (value: string) => void;
  isProcessing: boolean;
  placeholder?: string;
}

export const InputBox = React.memo(function InputBox({
  onSubmit,
  isProcessing,
  placeholder,
}: InputBoxProps): React.ReactElement {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback((text: string) => {
    onSubmit(text);
    setValue("");
  }, [onSubmit]);

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
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
});
