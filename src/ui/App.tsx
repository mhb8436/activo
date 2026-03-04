import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Config } from "../core/config.js";
import { OllamaClient } from "../core/llm/ollama.js";
import { AnthropicClient } from "../core/llm/anthropic.js";
import type { LLMClient, ChatMessage } from "../core/llm/types.js";
import { streamProcessMessage, AgentEvent } from "../core/agent.js";
import { handleSlashCommand } from "../core/commands.js";
import type { Provider } from "../core/config.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { ToolStatus, extractToolDetail } from "./components/ToolStatus.js";
import {
  createSession,
  loadLatestSession,
  saveSession,
  getSessionContext,
  cleanOldSessions,
} from "../core/conversation.js";
import { initMCPServers, shutdownMCPServers } from "../core/mcp/init.js";

interface AppProps {
  initialPrompt?: string;
  config: Config;
  resume?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    tool: string;
    status: "running" | "complete" | "error";
    result?: string;
    detail?: string;
  }>;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}

function createLLMClient(config: Config): LLMClient {
  if (config.provider === "anthropic") {
    return new AnthropicClient(config.anthropic);
  }
  return new OllamaClient(config.ollama);
}

function getDisplayModel(config: Config): string {
  if (config.provider === "anthropic") {
    return `anthropic:${config.anthropic.model}`;
  }
  return `ollama:${config.ollama.model}`;
}

export function App({ initialPrompt, config, resume }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolDetail, setCurrentToolDetail] = useState<string | undefined>(undefined);
  const [toolStatus, setToolStatus] = useState<"running" | "complete" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<LLMClient>(() => createLLMClient(config));
  const [currentModel, setCurrentModel] = useState(getDisplayModel(config));
  const [exitPending, setExitPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Session management
  const [session, setSession] = useState(() => createSession());
  const [contextSummary, setContextSummary] = useState<string>("");

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

  // Check LLM connection and initialize MCP servers on mount
  useEffect(() => {
    const checkConnection = async () => {
      const connected = await client.isConnected();
      if (!connected) {
        if (config.provider === "anthropic") {
          setError("Cannot connect to Anthropic API. Check ANTHROPIC_API_KEY.");
        } else {
          setError(`Cannot connect to Ollama at ${config.ollama.baseUrl}`);
        }
      }
      // Initialize MCP servers (non-fatal)
      await initMCPServers(config);
    };
    checkConnection();
    return () => {
      shutdownMCPServers();
    };
  }, [client, config.provider, config.ollama.baseUrl]);

  // Load previous session context on mount (if resume)
  useEffect(() => {
    const loadContext = async () => {
      if (resume) {
        try {
          const { summary, recentMessages } = await getSessionContext(client, 5);
          if (summary) {
            setContextSummary(summary);
          }
          // Optionally load recent messages to display
          if (recentMessages.length > 0) {
            const displayMessages: Message[] = recentMessages
              .filter(m => m.role === "user" || m.role === "assistant")
              .map(m => ({
                id: nextMessageId(),
                role: m.role as "user" | "assistant",
                content: m.content,
              }));
            setMessages(displayMessages);
          }
        } catch {
          // Ignore context loading errors
        }
      }
      // Clean old sessions
      cleanOldSessions(10);
    };
    loadContext();
  }, [resume, client]);

  // Process initial prompt
  useEffect(() => {
    if (initialPrompt) {
      handleSubmit(initialPrompt);
    }
  }, [initialPrompt]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    setError(null);

    // Handle slash commands first
    if (text.startsWith("/")) {
      const result = handleSlashCommand(text, config);
      if (result) {
        // Add command as user message
        setMessages((prev) => [...prev, { id: nextMessageId(), role: "user", content: text }]);

        if (result.exit) {
          const exitMsg: Message = { id: nextMessageId(), role: "assistant", content: result.output || "Goodbye!" };
          setMessages((prev) => [...prev, exitMsg]);
          setTimeout(() => exit(), 500);
          return;
        }

        if (result.clear) {
          setMessages([]);
          return;
        }

        if (result.changeProvider) {
          // Provider changed — recreate client
          config.provider = result.changeProvider;
          const newClient = createLLMClient(config);
          setClient(newClient);
          setCurrentModel(getDisplayModel(config));
        } else if (result.changeModel) {
          // Same provider, just change model
          client.setModel(result.changeModel);
          setCurrentModel(getDisplayModel(config));
        }

        if (result.output) {
          const outputMsg: Message = { id: nextMessageId(), role: "assistant", content: result.output };
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
    const userMessage: Message = { id: nextMessageId(), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);

    // Convert messages to chat format
    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Create assistant message placeholder
    const assistantMessage: Message = { id: nextMessageId(), role: "assistant", content: "", toolCalls: [] };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      let fullContent = "";

      for await (const event of streamProcessMessage(text, history, client, config, abortController.signal, contextSummary)) {
        // Check if cancelled
        if (abortController.signal.aborted) {
          break;
        }
        switch (event.type) {
          case "content":
            fullContent += event.content || "";
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx].role === "assistant") {
                // 새 객체 생성 (React.memo가 변경 감지하도록)
                updated[lastIdx] = { ...updated[lastIdx], content: fullContent };
              }
              return updated;
            });
            break;

          case "tool_use": {
            const detail = extractToolDetail(event.tool || "", event.args);
            setCurrentTool(event.tool || null);
            setCurrentToolDetail(detail);
            setToolStatus("running");
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx].role === "assistant") {
                // 새 객체 생성 (React.memo가 변경 감지하도록)
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  toolCalls: [
                    ...(updated[lastIdx].toolCalls || []),
                    { tool: event.tool!, status: "running", detail },
                  ],
                };
              }
              return updated;
            });
            break;
          }

          case "tool_result":
            setToolStatus(event.status as "complete" | "error");
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              const last = updated[lastIdx];
              if (last.role === "assistant" && last.toolCalls) {
                // 새 toolCalls 배열 + 새 객체 생성
                updated[lastIdx] = {
                  ...last,
                  toolCalls: last.toolCalls.map((tc) =>
                    tc.tool === event.tool
                      ? { ...tc, status: event.status as "complete" | "error", result: event.result?.content || event.result?.error }
                      : tc
                  ),
                };
              }
              return updated;
            });
            setTimeout(() => {
              setCurrentTool(null);
              setCurrentToolDetail(undefined);
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

      // Save conversation to session
      setSession((prevSession) => {
        const updatedSession = { ...prevSession };
        // Add user message
        updatedSession.messages.push({ role: "user", content: text });
        // Add assistant message (get from current messages state)
        setMessages((currentMessages) => {
          const lastMessage = currentMessages[currentMessages.length - 1];
          if (lastMessage?.role === "assistant") {
            updatedSession.messages.push({
              role: "assistant",
              content: lastMessage.content,
            });
          }
          return currentMessages;
        });
        saveSession(updatedSession);
        return updatedSession;
      });
    }
  }, [messages, client, config, isProcessing, contextSummary]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages */}
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={messages} />
      </Box>

      {/* Tool Status */}
      {currentTool && (
        <ToolStatus tool={currentTool} status={toolStatus || "running"} detail={currentToolDetail} />
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
