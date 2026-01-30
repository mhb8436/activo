# TODO.md - activo-code 개발 계획

## continue-cli 분석 결과

### 아키텍처 구조
```
continue/
├── extensions/cli/          # CLI 애플리케이션
│   ├── src/
│   │   ├── index.ts         # 엔트리 (Commander.js)
│   │   ├── commands/        # chat, login, serve 등
│   │   ├── session.ts       # 세션 관리
│   │   ├── tools/           # CLI 전용 도구 구현
│   │   └── ui/              # React Ink TUI
│   └── package.json
├── core/                    # 핵심 라이브러리
│   ├── llm/
│   │   ├── llms/           # Ollama, OpenAI, Anthropic 등
│   │   └── index.ts        # LLM 추상화
│   ├── tools/
│   │   ├── definitions/    # Tool 정의 (스키마)
│   │   ├── implementations/# Tool 구현
│   │   └── callTool.ts     # Tool 호출 로직
│   └── config/             # 설정 관리
└── packages/
    └── @modelcontextprotocol/sdk  # MCP 지원
```

### 핵심 컴포넌트

| 컴포넌트 | 파일 | 역할 |
|----------|------|------|
| CLI Entry | `extensions/cli/src/index.ts` | Commander.js 기반 명령어 |
| Ollama LLM | `core/llm/llms/Ollama.ts` | Ollama 연동 + Tool Calling |
| Tool System | `core/tools/callTool.ts` | 내장 + MCP 도구 호출 |
| Session | `extensions/cli/src/session.ts` | 세션 저장/로드 |

### 내장 Tools (activo에서 활용)
- `ReadFile` - 파일 읽기
- `CreateNewFile` - 파일 생성
- `GrepSearch` - 텍스트 검색
- `FileGlobSearch` - 파일 패턴 검색
- `RunTerminalCommand` - 터미널 명령 실행
- `ViewSubdirectory` - 디렉토리 탐색

---

## 개발 전략: continue-cli 기반 커스터마이징

### 접근 방식
```
continue-cli (포크/참조)
      ↓
불필요한 기능 제거 (login, remote, serve 등)
      ↓
품질 분석 특화 기능 추가
      ↓
activo-code
```

### 유지할 것
- [x] Commander.js CLI 구조
- [x] Ollama LLM 연동 (Tool Calling 포함)
- [x] Tool 시스템 (ReadFile, Grep, Glob 등)
- [x] Session 관리
- [x] MCP 프로토콜 지원

### 제거할 것
- [ ] login/logout (Continue 계정 관련)
- [ ] remote/serve (원격 에이전트)
- [ ] Sentry/PostHog (텔레메트리)
- [ ] WorkOS 인증
- [ ] 불필요한 LLM 프로바이더들

### 추가할 것
- [ ] PDF → MD 변환 (pdf-parse)
- [ ] 개발표준 규칙 로더
- [ ] 코드 품질 분석 프롬프트
- [ ] code-quality-checker 연동
- [ ] 품질 리포트 생성

---

## Phase 0: 프로젝트 셋업 ✅

### 0.1 프로젝트 초기화
- [x] continue-cli 구조 기반 프로젝트 생성
- [x] package.json 설정
- [x] TypeScript 설정 (tsconfig.json)
- [x] 필수 의존성만 설치

**테스트:**
```bash
pnpm install
pnpm build
```

### 0.2 디렉토리 구조 생성
```
activo-code/
├── src/
│   ├── cli/
│   │   ├── index.ts              # CLI 엔트리
│   │   └── commands/
│   │       ├── chat.ts           # 대화형 분석
│   │       ├── standards.ts      # 규칙 관리
│   │       ├── check.ts          # 표준 점검
│   │       └── config.ts         # 설정
│   ├── core/
│   │   ├── llm/
│   │   │   ├── ollama.ts         # Ollama 연동
│   │   │   └── prompts.ts        # 프롬프트 템플릿
│   │   ├── tools/
│   │   │   ├── definitions/      # 도구 정의
│   │   │   ├── implementations/  # 도구 구현
│   │   │   └── callTool.ts
│   │   ├── standards/
│   │   │   ├── pdf-parser.ts     # PDF 파싱
│   │   │   ├── rule-loader.ts    # 규칙 로드
│   │   │   └── rule-extractor.ts # 규칙 추출
│   │   └── analyzer/
│   │       └── quality.ts        # 품질 분석
│   ├── session/
│   │   └── index.ts              # 세션 관리
│   └── utils/
├── package.json
└── tsconfig.json
```

---

## Phase 1: 기본 CLI + Ollama 연동 ✅

### 1.1 CLI 프레임워크
- [x] Commander.js 기반 CLI 엔트리 생성
- [x] --version, --help 옵션
- [x] config 명령어 (설정 확인/수정)

**테스트:**
```bash
activo --version          # 0.1.0
activo --help             # 명령어 목록
activo config             # 현재 설정
```

### 1.2 Ollama 클라이언트
- [x] continue-cli의 Ollama.ts 참조하여 구현
- [x] 연결 테스트
- [x] 스트리밍 채팅
- [x] Tool Calling 지원

**테스트:**
```bash
# Ollama 상태 확인
activo config check-ollama

# 간단한 대화 테스트
activo chat "hello"
```

### 1.3 기본 Tools 구현
- [x] ReadFile - 파일 읽기
- [x] GrepSearch - 텍스트 검색
- [x] FileGlobSearch - 파일 패턴 검색
- [x] RunTerminalCommand - 명령 실행

**테스트:**
```bash
# 에이전트가 자동으로 도구 사용
activo chat "src 폴더에 어떤 파일이 있어?"
activo chat "UserService 클래스 찾아줘"
```

### 1.4 세션 관리
- [x] 세션 생성/저장/로드
- [x] --resume 옵션
- [x] 히스토리 관리

**테스트:**
```bash
activo chat "분석 시작"      # 새 세션
activo chat --resume         # 이전 세션 이어서
```

---

## Phase 2: PDF → MD 변환 ✅

### 2.1 PDF 파서
- [x] pdf-parse 라이브러리 연동
- [x] 텍스트 + 페이지 정보 추출

**테스트:**
```bash
pnpm test src/core/standards/pdf-parser.test.ts
```

### 2.2 청크 분할기
- [x] 목차 기반 분할
- [x] 페이지 단위 분할 (폴백)
- [x] 2000자 단위 분할 (최후)

**테스트:**
```bash
pnpm test src/core/standards/chunk-splitter.test.ts
```

### 2.3 규칙 추출기 (Ollama 활용)
- [x] PDF 텍스트 → 구조화된 규칙 추출
- [x] 규칙 ID, 심각도, 설명 파싱
- [x] MD 포맷 생성

**테스트:**
```bash
pnpm test src/core/standards/rule-extractor.test.ts
```

### 2.4 standards 명령어
- [x] `activo standards import <pdf>` - PDF 변환
- [x] `activo standards list` - 규칙 목록
- [x] `activo standards validate` - MD 검증

**테스트:**
```bash
activo standards import ./개발표준.pdf
ls -la .activo/standards/
activo standards list
```

---

## Phase 3: 규칙 기반 코드 분석

### 3.1 규칙 로더
- [ ] .activo/standards/*.md 로드
- [ ] 파일 확장자별 필터링
- [ ] 프롬프트 컨텍스트 구성

**테스트:**
```bash
pnpm test src/core/standards/rule-loader.test.ts
```

### 3.2 품질 분석기
- [ ] 코드 + 규칙 → Ollama 프롬프트
- [ ] 위반 사항 파싱
- [ ] 결과 포맷팅

**테스트:**
```bash
pnpm test src/core/analyzer/quality.test.ts
```

### 3.3 check 명령어
- [ ] `activo check <path>` - 표준 준수 점검
- [ ] `activo check --strict` - 엄격 모드
- [ ] 리포트 출력

**테스트:**
```bash
# 위반 코드 준비
echo 'class userService {}' > test.java

activo check test.java
# 출력: NR-001 위반 - 클래스명 PascalCase 사용 필요
```

### 3.4 대화형 분석 (chat 강화)
- [ ] 규칙 자동 로드
- [ ] 에이전트가 파일 탐색 → 분석 → 개선안 제시

**테스트:**
```bash
activo chat "UserService.java 분석해줘"
# 에이전트가:
# 1. ReadFile로 파일 읽기
# 2. 규칙 로드
# 3. 분석 결과 출력
```

---

## Phase 4: 통합 + 마무리

### 4.1 code-quality-checker 연동
- [ ] `activo explain -i result.json`
- [ ] cqc 결과에 설명 추가

**테스트:**
```bash
activo explain -i cqc-result.json
```

### 4.2 MCP 도구 지원 (선택)
- [ ] MCP 프로토콜 지원
- [ ] 외부 도구 연동 가능

### 4.3 패키징
- [ ] npm 패키지 설정
- [ ] 글로벌 설치 테스트

**테스트:**
```bash
npm link
activo --version
```

---

## 테스트 체크리스트

### Phase 1 완료 조건
| 테스트 | 명령어 | 예상 결과 | 상태 |
|--------|--------|-----------|------|
| 버전 | `activo --version` | 0.1.0 | ⬜ |
| Ollama 연결 | `activo config check-ollama` | Connected | ⬜ |
| 대화 | `activo chat "hello"` | 응답 출력 | ⬜ |
| 도구 사용 | `activo chat "파일 목록"` | ls 결과 | ⬜ |

### Phase 2 완료 조건
| 테스트 | 명령어 | 예상 결과 | 상태 |
|--------|--------|-----------|------|
| PDF 변환 | `activo standards import x.pdf` | MD 생성 | ⬜ |
| 규칙 목록 | `activo standards list` | 규칙 수 | ⬜ |

### Phase 3 완료 조건
| 테스트 | 명령어 | 예상 결과 | 상태 |
|--------|--------|-----------|------|
| 표준 점검 | `activo check test.java` | 위반 리포트 | ⬜ |
| 대화형 분석 | `activo chat "분석해줘"` | 자동 분석 | ⬜ |

---

## 핵심 의존성

```json
{
  "dependencies": {
    "commander": "^14.0.0",
    "chalk": "^5.4.1",
    "ink": "^6.1.0",
    "react": "^19.1.0",
    "uuid": "^9.0.1",
    "pdf-parse": "^1.1.1",
    "@modelcontextprotocol/sdk": "^1.24.0"
  }
}
```

---

## 참조 파일 (continue-cli)

| 기능 | 파일 경로 |
|------|-----------|
| CLI 엔트리 | `extensions/cli/src/index.ts` |
| Ollama 연동 | `core/llm/llms/Ollama.ts` |
| Tool 호출 | `core/tools/callTool.ts` |
| Tool 정의 | `core/tools/definitions/*.ts` |
| Tool 구현 | `core/tools/implementations/*.ts` |
| 세션 관리 | `extensions/cli/src/session.ts` |

---

## 진행 상황

- **현재 단계**: Phase 2 완료, Phase 3 진행 중
- **마지막 업데이트**: 2025-01-30
- **다음 작업**: 규칙 기반 코드 분석 고도화

### 완료된 테스트
- [x] `activo --version` → 0.1.0 출력
- [x] `activo --help` → 명령어 목록 출력
- [x] `activo config` → 설정 출력
- [x] `activo config check-ollama` → Ollama 연결 확인
- [x] `activo chat "..." -p` → Tool Calling 동작 확인
- [x] `activo standards list` → 규칙 목록 + 통계
- [x] `activo standards validate` → 규칙 검증
- [x] `activo check <file>` → 규칙 기반 코드 점검
