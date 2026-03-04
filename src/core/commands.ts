import { Config, loadConfig, saveConfig, Provider } from "./config.js";

export interface SlashCommandResult {
  output?: string;
  exit?: boolean;
  clear?: boolean;
  changeModel?: string;
  changeProvider?: Provider;
  showHelp?: boolean;
}

type CommandHandler = (args: string[], config: Config) => SlashCommandResult;

const HELP_MESSAGE = `
ACTIVO - AI 코드 품질 분석 도구

[슬래시 커맨드]
  /help          이 도움말 표시
  /exit, /quit   종료
  /clear         채팅 기록 삭제
  /model <name>  모델 변경 (예: /model qwen2.5:7b)
                 프로바이더 전환: /model anthropic:claude-sonnet-4-20250514
                                 /model ollama:qwen2.5:7b
  /info          현재 설정 정보 표시

[단축키]
  Enter          메시지 전송
  ESC            진행 중 작업 취소
  Ctrl+C x2      종료

[사용 예시]
  "src 폴더 구조 보여줘"
  "package.json 분석해줘"
  "코드 품질 검사해줘"
  "PDF를 마크다운으로 변환해줘"
`.trim();

const commandHandlers: Record<string, CommandHandler> = {
  help: () => ({
    output: HELP_MESSAGE,
    showHelp: true,
  }),

  exit: () => ({
    exit: true,
    output: "Goodbye!",
  }),

  quit: () => ({
    exit: true,
    output: "Goodbye!",
  }),

  clear: () => ({
    clear: true,
    output: "채팅 기록이 삭제되었습니다.",
  }),

  model: (args, config) => {
    if (args.length === 0) {
      const currentProvider = config.provider;
      const currentModel =
        currentProvider === "anthropic"
          ? config.anthropic.model
          : config.ollama.model;
      return {
        output: `현재 프로바이더: ${currentProvider}\n현재 모델: ${currentModel}\n\n사용법: /model <model_name>\n예시: /model qwen2.5:7b\n      /model anthropic:claude-sonnet-4-20250514\n      /model ollama:qwen2.5:7b`,
      };
    }

    const input = args[0];
    let provider: Provider | undefined;
    let newModel: string;

    // Parse provider:model format
    if (input.startsWith("anthropic:")) {
      provider = "anthropic";
      newModel = input.slice("anthropic:".length);
    } else if (input.startsWith("ollama:")) {
      provider = "ollama";
      newModel = input.slice("ollama:".length);
    } else if (input.startsWith("claude-") || input.startsWith("claude3")) {
      // Auto-detect Anthropic models
      provider = "anthropic";
      newModel = input;
    } else {
      // Default: use current provider, or assume ollama
      newModel = input;
      provider = undefined; // keep current provider
    }

    if (provider === "anthropic") {
      config.provider = "anthropic";
      config.anthropic.model = newModel;
    } else if (provider === "ollama") {
      config.provider = "ollama";
      config.ollama.model = newModel;
    } else {
      // No provider specified, change model for current provider
      if (config.provider === "anthropic") {
        config.anthropic.model = newModel;
      } else {
        config.ollama.model = newModel;
      }
    }

    saveConfig(config);

    const displayProvider = provider || config.provider;
    return {
      changeModel: newModel,
      changeProvider: provider,
      output: `[${displayProvider}] 모델이 "${newModel}"로 변경되었습니다.`,
    };
  },

  info: (args, config) => {
    const providerInfo =
      config.provider === "anthropic"
        ? `[Anthropic 설정]
  모델: ${config.anthropic.model}
  최대 토큰: ${config.anthropic.maxTokens}
  API 키: ${config.anthropic.apiKey ? "config.json" : process.env.ANTHROPIC_API_KEY ? "환경변수" : "미설정"}`
        : `[Ollama 설정]
  URL: ${config.ollama.baseUrl}
  모델: ${config.ollama.model}
  컨텍스트: ${config.ollama.contextLength}`;

    const info = `
[ACTIVO 정보]
  버전: 0.4.4
  프로바이더: ${config.provider}

${providerInfo}

[표준 디렉토리]
  ${config.standards.directory}
`.trim();

    return { output: info };
  },
};

export function handleSlashCommand(
  input: string,
  config: Config
): SlashCommandResult | null {
  // "/" 로 시작하지 않으면 null 반환
  if (!input.startsWith("/")) {
    return null;
  }

  // 파싱: "/" 제거 후 공백으로 분할
  const trimmed = input.slice(1).trim();
  const [command, ...args] = trimmed.split(/\s+/);

  if (!command) {
    return { output: "명령어를 입력하세요. /help 로 도움말을 확인하세요." };
  }

  const handler = commandHandlers[command.toLowerCase()];
  if (handler) {
    return handler(args, config);
  }

  return { output: `알 수 없는 명령어: /${command}\n/help 로 사용 가능한 명령어를 확인하세요.` };
}

export function getAvailableCommands(): string[] {
  return Object.keys(commandHandlers);
}
