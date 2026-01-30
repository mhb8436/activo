# TODO.md - activo-code 개발 계획

## 아키텍처 (v0.2.0 - React Ink TUI)

### continue-cli 기반 새 구조
```
activo-code/
├── src/
│   ├── cli/
│   │   ├── index.ts           # CLI 엔트리 (Commander.js + React Ink)
│   │   ├── banner.ts          # ACTIVO ASCII 아트 배너
│   │   └── headless.ts        # 비대화형 모드
│   ├── core/
│   │   ├── config.ts          # 설정 관리 (Ollama, MCP)
│   │   ├── agent.ts           # 에이전트 (Tool Calling 루프)
│   │   ├── llm/
│   │   │   └── ollama.ts      # Ollama 클라이언트 (스트리밍, Tool Calling)
│   │   ├── tools/
│   │   │   ├── types.ts       # Tool, ToolCall, ToolResult 타입
│   │   │   ├── builtIn.ts     # 내장 도구 (파일, 검색, 명령)
│   │   │   ├── standards.ts   # 표준 도구 (PDF, 품질 체크)
│   │   │   └── index.ts       # 도구 레지스트리
│   │   └── mcp/
│   │       └── client.ts      # MCP 프로토콜 클라이언트
│   └── ui/
│       ├── App.tsx            # 메인 React Ink 앱
│       └── components/
│           ├── InputBox.tsx   # 입력창 컴포넌트
│           ├── MessageList.tsx # 메시지 목록
│           ├── StatusBar.tsx  # 상태바 (모델, 메시지 수)
│           └── ToolStatus.tsx # 도구 실행 상태
├── package.json
└── tsconfig.json
```

### 핵심 기능
- **자연어 인터페이스**: 터미널에서 한글로 명령 입력
- **Tool Calling**: Ollama가 필요한 도구 자동 선택/실행
- **MCP 지원**: 외부 도구 서버 연결 가능
- **스트리밍**: 실시간 응답 출력

---

## Phase 0: 프로젝트 리빌드 ✅

### 0.1 React Ink TUI 구축
- [x] ink, ink-spinner, ink-text-input 설치
- [x] Commander.js + React Ink 통합
- [x] ASCII 배너 (gradient-string)
- [x] 대화형/비대화형 모드 분리

**테스트:**
```bash
node dist/cli/index.js --version     # 0.2.0
node dist/cli/index.js --help        # 옵션 목록
node dist/cli/index.js --print "test" # 배너 + 응답
```

### 0.2 Ollama 클라이언트
- [x] 스트리밍 chat 지원
- [x] Tool Calling 지원
- [x] 연결 상태 확인

---

## Phase 1: Tool Calling 시스템 ✅

### 1.1 내장 도구 (Built-in Tools)
- [x] `read_file` - 파일 읽기
- [x] `write_file` - 파일 쓰기
- [x] `list_directory` - 디렉토리 목록
- [x] `grep_search` - 텍스트 검색
- [x] `glob_search` - 파일 패턴 검색
- [x] `run_command` - 명령 실행

### 1.2 표준 도구 (Standards Tools)
- [x] `import_pdf_standards` - PDF → MD 변환
- [x] `list_standards` - 규칙 목록 조회
- [x] `check_code_quality` - 코드 품질 체크

### 1.3 에이전트 루프
- [x] 시스템 프롬프트 정의
- [x] 반복 Tool Calling 처리
- [x] 스트리밍 이벤트 생성

---

## Phase 2: MCP 지원 ✅

### 2.1 MCP 클라이언트
- [x] StdioClientTransport 연동
- [x] 도구 목록 조회
- [x] 도구 호출 프록시

### 2.2 설정
- [x] ~/.activo/config.json 지원
- [x] MCP 서버 설정 구조

---

## Phase 3: UI 컴포넌트 ✅

### 3.1 React Ink 컴포넌트
- [x] InputBox - 입력창 + 처리중 상태
- [x] MessageList - 대화 기록 표시
- [x] StatusBar - 모델, 메시지 수, 상태
- [x] ToolStatus - 도구 실행 표시

### 3.2 상태 관리
- [x] 메시지 히스토리
- [x] 도구 호출 추적
- [x] 에러 표시
- [x] Ctrl+C 처리 (2회 종료)

---

## Phase 4: 통합 및 테스트

### 4.1 빌드 검증
- [x] TypeScript 컴파일
- [x] 배너 출력 확인
- [ ] Ollama 연동 테스트
- [ ] Tool Calling 실행 테스트

### 4.2 사용 시나리오 테스트
- [ ] "src 폴더 구조 보여줘"
- [ ] "이 프로젝트의 코드 품질 분석해줘"
- [ ] "PDF 파일을 규칙으로 변환해줘"
- [ ] "명명규칙 위반 찾아줘"

### 4.3 패키징
- [ ] npm link 테스트
- [ ] 글로벌 설치 테스트

---

## 테스트 체크리스트

### 빌드 & 기본 테스트
| 항목 | 명령어 | 예상 결과 | 상태 |
|------|--------|-----------|------|
| 빌드 | `pnpm build` | 성공 | ✅ |
| 버전 | `node dist/cli/index.js --version` | 0.2.0 | ✅ |
| 도움말 | `node dist/cli/index.js --help` | 옵션 목록 | ✅ |
| 배너 | `node dist/cli/index.js --print "test"` | ASCII 아트 | ✅ |

### 대화 테스트
| 항목 | 명령어 | 예상 결과 | 상태 |
|------|--------|-----------|------|
| 파일 목록 | "src 폴더에 뭐가 있어?" | list_directory 호출 | ⬜ |
| 파일 읽기 | "package.json 보여줘" | read_file 호출 | ⬜ |
| 검색 | "TODO 찾아줘" | grep_search 호출 | ⬜ |
| 품질 체크 | "코드 품질 분석해줘" | check_code_quality 호출 | ⬜ |

---

## 핵심 의존성

```json
{
  "dependencies": {
    "commander": "^14.0.0",
    "chalk": "^5.4.1",
    "ink": "^6.1.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "react": "^19.1.0",
    "gradient-string": "^3.0.0",
    "pdf-parse": "^1.1.1",
    "@modelcontextprotocol/sdk": "^1.25.0",
    "@anthropic-ai/sdk": "^0.52.0",
    "uuid": "^9.0.1",
    "date-fns": "^4.1.0"
  }
}
```

---

## 진행 상황

- **버전**: v0.2.0 (React Ink TUI 버전)
- **현재 단계**: Phase 4.1 (빌드 검증)
- **마지막 업데이트**: 2025-01-30
- **다음 작업**: Ollama 연동 테스트, 실사용 시나리오 검증

### 완료된 작업
- [x] continue-cli 아키텍처 분석
- [x] React Ink TUI 구현
- [x] Tool Calling 시스템 구현
- [x] MCP 클라이언트 구현
- [x] ASCII 배너 구현
- [x] 빌드 성공
