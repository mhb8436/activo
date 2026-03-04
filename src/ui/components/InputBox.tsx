import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

interface InputBoxProps {
  onSubmit: (value: string) => void;
  isProcessing: boolean;
  placeholder?: string;
}

// Continue-style: mutable text buffer decoupled from React state
class TextBuffer {
  private _text = "";
  private _cursor = 0;

  get text(): string { return this._text; }
  get cursor(): number { return this._cursor; }

  insertText(text: string): void {
    this._text = this._text.slice(0, this._cursor) + text + this._text.slice(this._cursor);
    this._cursor += text.length;
  }

  // On Mac, backspace key registers as key.delete — both should delete backward
  deleteBackward(): void {
    if (this._cursor > 0) {
      this._text = this._text.slice(0, this._cursor - 1) + this._text.slice(this._cursor);
      this._cursor--;
    }
  }

  moveLeft(): void {
    if (this._cursor > 0) this._cursor--;
  }

  moveRight(): void {
    if (this._cursor < this._text.length) this._cursor++;
  }

  moveToStart(): void {
    this._cursor = 0;
  }

  moveToEnd(): void {
    this._cursor = this._text.length;
  }

  clear(): void {
    this._text = "";
    this._cursor = 0;
  }

  deleteWordBackward(): void {
    if (this._cursor === 0) return;
    let i = this._cursor - 1;
    while (i > 0 && this._text[i - 1] === " ") i--;
    while (i > 0 && this._text[i - 1] !== " ") i--;
    this._text = this._text.slice(0, i) + this._text.slice(this._cursor);
    this._cursor = i;
  }

  deleteLineBackward(): void {
    this._text = this._text.slice(this._cursor);
    this._cursor = 0;
  }
}

export const InputBox = React.memo(function InputBox({
  onSubmit,
  isProcessing,
  placeholder,
}: InputBoxProps): React.ReactElement {
  const [textBuffer] = useState(() => new TextBuffer());
  const [inputText, setInputText] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);

  // Sync React state from TextBuffer (Continue-style: immediate, no debounce)
  const syncState = useCallback(() => {
    setInputText(textBuffer.text);
    setCursorPosition(textBuffer.cursor);
  }, [textBuffer]);

  useInput((input, key) => {
    if (isProcessing) return;

    // Enter: submit
    if (key.return) {
      const text = textBuffer.text.trim();
      if (text) {
        textBuffer.clear();
        setInputText("");
        setCursorPosition(0);
        onSubmit(text);
      }
      return;
    }

    // Backspace/Delete: both delete backward (Mac sends key.delete for backspace)
    if ((key.backspace || key.delete) && !key.meta) {
      textBuffer.deleteBackward();
      syncState();
      return;
    }

    // Arrow keys
    if (key.leftArrow) {
      textBuffer.moveLeft();
      syncState();
      return;
    }
    if (key.rightArrow) {
      textBuffer.moveRight();
      syncState();
      return;
    }

    // Ctrl+A: move to start
    if (key.ctrl && input === "a") {
      textBuffer.moveToStart();
      syncState();
      return;
    }

    // Ctrl+E: move to end
    if (key.ctrl && input === "e") {
      textBuffer.moveToEnd();
      syncState();
      return;
    }

    // Ctrl+W: delete word backward
    if (key.ctrl && input === "w") {
      textBuffer.deleteWordBackward();
      syncState();
      return;
    }

    // Ctrl+U: delete line backward
    if (key.ctrl && input === "u") {
      textBuffer.deleteLineBackward();
      syncState();
      return;
    }

    // Option+Backspace (macOS): delete word backward
    const isOptionKey = input.startsWith("\u001b") && input.length > 1;
    if (isOptionKey) {
      const seq = input.slice(1);
      if (seq === "\u007f" || seq === "\u0008") {
        textBuffer.deleteWordBackward();
        syncState();
        return;
      }
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && !isOptionKey) {
      textBuffer.insertText(input);
      syncState();
      return;
    }
  });

  // Render text with cursor (Continue-style: inverse block cursor)
  const renderInputText = () => {
    if (inputText.length === 0) {
      return (
        <>
          <Text inverse> </Text>
          <Text color="gray">{placeholder || ""}</Text>
        </>
      );
    }

    const before = inputText.slice(0, cursorPosition);
    const atCursor = inputText.slice(cursorPosition, cursorPosition + 1);
    const after = inputText.slice(cursorPosition + 1);

    return (
      <Text>
        {before}
        <Text inverse>{atCursor || " "}</Text>
        {after}
      </Text>
    );
  };

  return (
    <Box borderStyle="round" borderColor={isProcessing ? "gray" : "cyan"} paddingX={1}>
      <Text color="green" bold>
        {isProcessing ? "⏳" : "❯"}{" "}
      </Text>
      {isProcessing ? (
        <Text color="gray">Processing...</Text>
      ) : (
        renderInputText()
      )}
    </Box>
  );
});
