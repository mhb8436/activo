# CLAUDE.md - activo-code

## 프로젝트 개요

activo-code는 continue-cli 아키텍처를 기반으로 한 AI 코드 품질 분석 CLI 도구입니다. React Ink TUI, Ollama Tool Calling, MCP 프로토콜을 지원합니다.

## 핵심 기능

| 기능 | 설명 |
|------|------|
| 자연어 인터페이스 | 한글로 명령 입력, AI가 도구 자동 선택 |
| Tool Calling | Ollama가 내장 도구 자동 호출 |
| MCP 지원 | 외부 도구 서버 연결 가능 |
| PDF 변환 | 개발표준 PDF → MD 규칙 변환 |
| 코드 품질 분석 | 규칙 기반 코드 품질 체크 |

## 사용 예시

```bash
# 대화형 모드 실행
activo

# 초기 프롬프트와 함께 실행
activo "src 폴더 구조 보여줘"

# 비대화형 모드 (print & exit)
activo --print "package.json 분석해줘"

# 특정 모델 사용
activo --model qwen2.5:7b
```

## 자연어 명령 예시

```
• 이 프로젝트의 코드 품질을 분석해줘
• PDF 파일을 마크다운 규칙으로 변환해줘
• src 폴더의 명명규칙 위반을 찾아줘
• UserService.ts 파일 보여줘
• TODO 주석을 검색해줘
```

## 아키텍처

```
activo-code/
├── src/
│   ├── cli/
│   │   ├── index.ts           # CLI 엔트리 (Commander.js + React Ink)
│   │   ├── banner.ts          # ACTIVO ASCII 아트 배너
│   │   └── headless.ts        # 비대화형 모드
│   ├── core/
│   │   ├── config.ts          # 설정 관리
│   │   ├── agent.ts           # 에이전트 (Tool Calling 루프)
│   │   ├── llm/
│   │   │   └── ollama.ts      # Ollama 클라이언트
│   │   ├── tools/
│   │   │   ├── types.ts       # Tool 타입 정의
│   │   │   ├── builtIn.ts     # 내장 도구
│   │   │   ├── standards.ts   # 표준 관련 도구
│   │   │   └── index.ts       # 도구 레지스트리
│   │   └── mcp/
│   │       └── client.ts      # MCP 클라이언트
│   └── ui/
│       ├── App.tsx            # 메인 React Ink 앱
│       └── components/
│           ├── InputBox.tsx   # 입력창
│           ├── MessageList.tsx # 메시지 목록
│           ├── StatusBar.tsx  # 상태바
│           └── ToolStatus.tsx # 도구 상태
├── package.json
├── tsconfig.json
├── TODO.md
└── CLAUDE.md
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript (ESM) |
| CLI | Commander.js |
| TUI | React Ink 6.x |
| LLM | Ollama (Tool Calling) |
| MCP | @modelcontextprotocol/sdk |
| PDF | pdf-parse |

## 내장 도구 (Tools)

### 파일 도구
| 도구 | 설명 |
|------|------|
| `read_file` | 파일 읽기 |
| `write_file` | 파일 쓰기 |
| `list_directory` | 디렉토리 목록 |
| `glob_search` | 파일 패턴 검색 |
| `grep_search` | 텍스트 검색 |
| `run_command` | 명령 실행 |

### 표준 도구
| 도구 | 설명 |
|------|------|
| `import_pdf_standards` | PDF → MD 변환 |
| `list_standards` | 규칙 목록 조회 |
| `check_code_quality` | 코드 품질 체크 |

## 설정

설정 파일: `~/.activo/config.json`

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5:7b"
  },
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": ["@example/mcp-server"],
      "env": {}
    }
  },
  "standardsDir": ".activo/standards"
}
```

## 빌드 & 실행

```bash
# 의존성 설치
pnpm install

# 빌드
pnpm build

# 개발 모드
pnpm dev

# CLI 실행
pnpm start

# 버전 확인
node dist/cli/index.js --version
```

## Ollama 설정

**권장 모델:**
- 코드 분석: `codellama:7b`, `qwen2.5-coder:7b`
- 한국어 처리: `qwen2.5:7b`
- 경량: `mistral:7b`

**Tool Calling 요구사항:**
- Ollama 0.5.0 이상 (native tool calling)
- 최소 8GB 메모리 권장

## MCP 서버 연결

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-server-filesystem", "/path/to/dir"]
    }
  }
}
```

## 참조

- **continue-cli**: https://github.com/continuedev/continue
- **Ollama**: https://ollama.ai
- **MCP**: https://modelcontextprotocol.io
- **React Ink**: https://github.com/vadimdemedes/ink

## 라이선스

MIT
