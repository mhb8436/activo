import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Config } from "../core/config.js";
import { OllamaClient, ChatMessage } from "../core/llm/ollama.js";
import { streamProcessMessage, AgentEvent } from "../core/agent.js";
import { handleSlashCommand } from "../core/commands.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { ToolStatus } from "./components/ToolStatus.js";

interface AppProps {
  initialPrompt?: string;
  config: Config;
  resume?: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    tool: string;
    status: "running" | "complete" | "error";
    result?: string;
  }>;
}

export function App({ initialPrompt, config, resume }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<"running" | "complete" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client] = useState(() => new OllamaClient(config.ollama));
  const [currentModel, setCurrentModel] = useState(config.ollama.model);
  const [exitPending, setExitPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Handle Ctrl+C and ESC
  useInput((inputChar, key) => {
    // ESC key to cancel current operation
    if (key.escape && isProcessing) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setCancelled(true);
        setIsProcessing(false);
        setCurrentTool(null);
        setToolStatus(null);
        setError("Operation cancelled by user (ESC)");
      }
      return;
    }

    // Ctrl+C to exit
    if (key.ctrl && inputChar === "c") {
      if (isProcessing && abortControllerRef.current) {
        abortControllerRef.current.abort();
        setCancelled(true);
        setIsProcessing(false);
        setCurrentTool(null);
        setToolStatus(null);
        return;
      }
      if (exitPending) {
        exit();
      } else {
        setExitPending(true);
        setTimeout(() => setExitPending(false), 1000);
      }
    }
  });

  // Check Ollama connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      const connected = await client.isConnected();
      if (!connected) {
        setError(`Cannot connect to Ollama at ${config.ollama.baseUrl}`);
      }
    };
    checkConnection();
  }, [client, config.ollama.baseUrl]);

  // Process initial prompt
  useEffect(() => {
    if (initialPrompt) {
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    setInput("");
    setError(null);

    // Handle slash commands first
    if (text.startsWith("/")) {
      const result = handleSlashCommand(text, config);
      if (result) {
        // Add command as user message
        setMessages((prev) => [...prev, { role: "user", content: text }]);

        if (result.exit) {
          const exitMsg: Message = { role: "assistant", content: result.output || "Goodbye!" };
          setMessages((prev) => [...prev, exitMsg]);
          setTimeout(() => exit(), 500);
          return;
        }

        if (result.clear) {
          setMessages([]);
          return;
        }

        if (result.changeModel) {
          setCurrentModel(result.changeModel);
          client.setModel(result.changeModel);
        }

        if (result.output) {
          const outputMsg: Message = { role: "assistant", content: result.output };
          setMessages((prev) => [...prev, outputMsg]);
        }

        return;
      }
    }

    setIsProcessing(true);
    setCancelled(false);

    // Create AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Add user message
    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);

    // Convert messages to chat format
    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Create assistant message placeholder
    const assistantMessage: Message = { role: "assistant", content: "", toolCalls: [] };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      let fullContent = "";

      for await (const event of streamProcessMessage(text, history, client, config, abortController.signal)) {
        // Check if cancelled
        if (abortController.signal.aborted) {
          break;
        }
        switch (event.type) {
          case "content":
            fullContent += event.content || "";
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                last.content = fullContent;
              }
              return updated;
            });
            break;

          case "tool_use":
            setCurrentTool(event.tool || null);
            setToolStatus("running");
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                last.toolCalls = [
                  ...(last.toolCalls || []),
                  { tool: event.tool!, status: "running" },
                ];
              }
              return updated;
            });
            break;

          case "tool_result":
            setToolStatus(event.status as "complete" | "error");
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant" && last.toolCalls) {
                const toolCall = last.toolCalls.find((tc) => tc.tool === event.tool);
                if (toolCall) {
                  toolCall.status = event.status as "complete" | "error";
                  toolCall.result = event.result?.content || event.result?.error;
                }
              }
              return updated;
            });
            setTimeout(() => {
              setCurrentTool(null);
              setToolStatus(null);
            }, 500);
            break;

          case "error":
            setError(event.error || "Unknown error");
            break;

          case "done":
            break;
        }
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(String(err));
      }
    } finally {
      setIsProcessing(false);
      setCurrentTool(null);
      setToolStatus(null);
      abortControllerRef.current = null;
    }
  }, [messages, client, config, isProcessing]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={messages} />
      </Box>

      {/* Tool Status */}
      {currentTool && (
        <ToolStatus tool={currentTool} status={toolStatus || "running"} />
      )}

      {/* Error */}
      {error && (
        <Box marginY={1}>
          <Text color="red">⚠ {error}</Text>
        </Box>
      )}

      {/* Exit Warning */}
      {exitPending && (
        <Box marginY={1}>
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        </Box>
      )}

      {/* Input */}
      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isProcessing={isProcessing}
        placeholder="Type your message..."
      />

      {/* Status Bar */}
      <StatusBar
        model={currentModel}
        isProcessing={isProcessing}
        messageCount={messages.length}
      />
    </Box>
  );
}
