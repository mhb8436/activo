import { Config, loadConfig, saveConfig } from "./config.js";

export interface SlashCommandResult {
  output?: string;
  exit?: boolean;
  clear?: boolean;
  changeModel?: string;
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
      return {
        output: `현재 모델: ${config.ollama.model}\n\n사용법: /model <model_name>\n예시: /model qwen2.5:7b`,
      };
    }

    const newModel = args[0];
    config.ollama.model = newModel;
    saveConfig(config);

    return {
      changeModel: newModel,
      output: `모델이 "${newModel}"로 변경되었습니다.`,
    };
  },

  info: (args, config) => {
    const info = `
[ACTIVO 정보]
  버전: 0.2.1

[Ollama 설정]
  URL: ${config.ollama.baseUrl}
  모델: ${config.ollama.model}
  컨텍스트: ${config.ollama.contextLength}

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
