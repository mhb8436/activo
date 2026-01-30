# activo-code 최종 방안 (간소화)

## 0. 참조 레포지토리

### continue-cli GitHub
- **메인 레포**: https://github.com/continuedev/continue
- **CLI 코드 위치**: `extensions/cli/`
- **Core 코드 위치**: `core/`

### 작업 전 준비 (필수)

```bash
# continue 레포 클론 (참조용)
cd ~/Downloads
git clone https://github.com/continuedev/continue.git
cd continue

# CLI 구조 확인
ls -la extensions/cli/
ls -la extensions/cli/src/

# Core 구조 확인  
ls -la core/
ls -la core/llm/
```

### 참조할 주요 파일

```
~/Downloads/continue/
├── extensions/cli/
│   ├── src/
│   │   ├── index.ts              # CLI 엔트리포인트
│   │   ├── commands/             # 명령어 구현
│   │   ├── tui/                  # Terminal UI (React Ink)
│   │   └── headless/             # Headless 모드
│   └── package.json              # 의존성 참조
├── core/
│   ├── llm/
│   │   ├── llms/                 # LLM 프로바이더들
│   │   └── templates/            # 프롬프트 템플릿
│   ├── config/                   # 설정 로딩
│   └── tools/                    # Agent Tools
└── packages/
    └── openai-adapters/          # OpenAI 호환 어댑터
```

### 참조 시 주의사항
- continue-cli는 범용 코딩 에이전트 (우리는 품질 분석 특화)
- Ollama 연동 방식, CLI 구조, 세션 관리 참조
- LLM Provider 추상화 패턴 참조
- 프롬프트 구조는 우리 목적에 맞게 재설계

---

## 1. 결론 요약

### 인터페이스: CLI 단일화
```
PDF → MD 변환: CLI (activo standards import)
MD 수정: 에디터로 직접 (VS Code 등)
코드 분석: CLI (activo improve, activo check)
```

### continue-cli RAG 기능
**있음**, 하지만 제한적:
- `.continue/rules/` 폴더에 MD 파일 배치 → 자동 컨텍스트 로드
- `@docs` context provider → 문서 참조 (deprecated, MCP로 대체 중)
- Custom Context Provider → 자체 RAG 서버 연동 가능

**activo-code에서 활용 방안:**
- 규칙 MD를 `.continue/rules/` 또는 `.activo/standards/`에 배치
- 분석 시 해당 MD를 직접 로드하여 프롬프트에 포함 (자체 구현)

---

## 2. PDF → MD 변환 전략

### 2.1 CLI 명령어

```bash
# PDF 변환 (청크 분할, 여러 MD 생성)
activo standards import ./개발표준.pdf

# 결과
.activo/standards/
├── _index.md           # 전체 목록/요약
├── 01_명명규칙.md      # 청크 1
├── 02_코드구조.md      # 청크 2
├── 03_보안.md          # 청크 3
├── 04_예외처리.md      # 청크 4
└── 05_주석문서화.md    # 청크 5
```

### 2.2 청크 분할 전략

| PDF 크기 | 청크 크기 | MD 파일 수 |
|----------|----------|-----------|
| ~20페이지 | 전체 1개 | 1개 |
| 20~50페이지 | 장/절 단위 | 3~5개 |
| 50페이지+ | 2000자 단위 | 다수 |

**분할 기준:**
1. 목차 기반 (장/절 경계)
2. 페이지 단위 (목차 없을 경우)
3. 고정 길이 (마지막 수단)

### 2.3 생성되는 MD 구조

```markdown
# 명명규칙 (01_명명규칙.md)

> 원본: 개발표준_v2.1.pdf (페이지 5-12)
> 추출일: 2025-01-30

## NR-001: 클래스명
- 심각도: error
- 규칙: PascalCase 사용
- 예시: UserService (O), userService (X)

## NR-002: 변수명
- 심각도: warning
- 규칙: camelCase 사용
- 예시: userName (O), user_name (X)

---
[수동 수정 필요 시 이 파일을 직접 편집하세요]
```

### 2.4 수동 편집 가이드

```bash
# 변환 후 안내 메시지
$ activo standards import ./개발표준.pdf

PDF 변환 완료!
- 생성된 파일: 5개
- 위치: .activo/standards/

[다음 단계]
1. 생성된 MD 파일을 에디터로 확인하세요
2. 잘못 추출된 규칙은 직접 수정/삭제하세요
3. 누락된 규칙은 수동으로 추가하세요

$ code .activo/standards/  # VS Code로 열기
```

---

## 3. 아키텍처 (간소화)

```
┌─────────────────────────────────────────────────┐
│                  activo-code                     │
├─────────────────────────────────────────────────┤
│                                                  │
│  [CLI]                                          │
│  ├── activo standards import <pdf>              │
│  │   └── PDF → 청크 분할 → Ollama 추출 → MD들   │
│  │                                              │
│  ├── activo standards list                      │
│  │   └── 현재 로드된 규칙 목록                  │
│  │                                              │
│  ├── activo improve <path>                      │
│  │   └── 코드 개선점 분석 (Why/How)             │
│  │                                              │
│  ├── activo check <path>                        │
│  │   └── 표준 규칙 준수 여부 점검               │
│  │                                              │
│  └── activo explain --input <cqc-result.json>   │
│      └── code-quality-checker 결과 설명 추가    │
│                                                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  [Standards Loader]                             │
│  └── .activo/standards/*.md 로드                │
│      └── 여러 MD 병합 → 프롬프트 컨텍스트       │
│                                                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  [Ollama Engine]                                │
│  ├── PDF 규칙 추출: qwen2.5:7b (한국어)         │
│  └── 코드 분석: codellama:7b                    │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 4. 분석 시 규칙 로드 방식

### 4.1 단순 방식 (권장)

```
[분석 요청]
     ↓
[.activo/standards/*.md 전체 로드]
     ↓
[관련 규칙만 필터링] ← 파일 확장자, 카테고리 기반
     ↓
[프롬프트에 규칙 포함]
     ↓
[Ollama 호출]
```

**예시: Java 파일 분석 시**
```
로드할 규칙:
- 01_명명규칙.md (전체)
- 02_코드구조.md (전체)
- 03_보안.md (전체)

제외:
- 06_HTML규칙.md
- 07_CSS규칙.md
```

### 4.2 프롬프트 구성

```
[시스템]
당신은 코드 품질 전문가입니다.
아래 개발표준 규칙에 따라 코드를 점검하세요.

[개발표준 규칙]
## 명명규칙
- NR-001: 클래스명 PascalCase (error)
- NR-002: 변수명 camelCase (warning)
...

## 코드구조
- CS-001: 메서드 50줄 이하 (warning)
...

[분석 대상 코드]
```java
public class userService { ... }
```

[질문]
위 코드가 개발표준을 위반하는 부분을 찾고,
각 위반에 대해 다음을 설명하세요:
1. 위반 규칙 ID
2. 위반 위치 (라인)
3. 위반 이유
4. 수정 방안
```

### 4.3 8GB Ollama 대응

**규칙 MD가 너무 클 경우:**
```
전체 규칙: 10,000자 → 컨텍스트 초과

해결책:
1. 분석 대상 언어의 규칙만 로드
2. 카테고리별로 나눠서 여러 번 호출
3. 규칙 요약본 사용 (_index.md)
```

---

## 5. CLI 명령어 최종

```bash
# 개발표준 관리
activo standards import <pdf>     # PDF → MD 변환 (청크 분할)
activo standards list             # 현재 규칙 목록
activo standards validate         # MD 문법 검증

# 코드 분석
activo improve <path>             # 개선점 분석
activo improve --focus naming     # 특정 영역 집중
activo check <path>               # 표준 준수 점검
activo check --strict             # 엄격 모드

# code-quality-checker 연동
activo explain -i result.json     # cqc 결과 설명

# 설정
activo config                     # 설정 확인/수정
activo config set model codellama:7b
```

---

## 6. continue-cli 참조 vs 자체 구현

### continue-cli 레포 구조 (~/Downloads/continue/)

```
~/Downloads/continue/
├── extensions/cli/           # ← 메인 참조 대상
│   ├── src/
│   │   ├── index.ts         # CLI 메인 (Commander.js)
│   │   ├── commands/        # 명령어 핸들러
│   │   ├── tui/             # React Ink TUI
│   │   ├── headless/        # CI용 헤드리스 모드
│   │   └── session/         # 세션 관리
│   ├── package.json         # 의존성 목록
│   └── tsconfig.json
├── core/                     # ← LLM/Tool 참조
│   ├── llm/
│   │   ├── llms/            # 각 프로바이더 구현
│   │   │   ├── Ollama.ts    # ★ Ollama 연동 참조
│   │   │   ├── OpenAI.ts
│   │   │   └── Anthropic.ts
│   │   └── templates/       # 프롬프트 템플릿
│   ├── config/              # 설정 로딩
│   ├── tools/               # Agent Tools
│   └── index.d.ts           # 타입 정의
└── packages/
    ├── config-types/        # 설정 타입
    └── fetch/               # HTTP 클라이언트
```

### continue-cli에서 가져올 것
- CLI 구조 (Commander.js 패턴) → `extensions/cli/src/index.ts`
- Ollama 연동 방식 → `core/llm/llms/Ollama.ts`
- 세션/히스토리 관리 → `extensions/cli/src/session/`
- 설정 로딩 패턴 → `core/config/`

### 자체 구현할 것
- PDF 파싱 및 청크 분할
- 개발표준 규칙 로더
- 코드 품질 분석 프롬프트
- code-quality-checker 연동

### continue-cli RAG 활용 여부
**활용 안 함** (자체 구현)
- continue-cli RAG는 IDE 통합 위주
- 우리는 단순히 MD 파일 로드 → 프롬프트 포함
- 복잡한 벡터 DB 불필요 (규칙 MD는 작음)

---

## 7. 개발 우선순위

### Phase 1 (1주)
- [ ] CLI 프레임워크
- [ ] Ollama 연동 (ollama-js)
- [ ] 단일 파일 개선점 분석

### Phase 2 (1주)
- [ ] PDF 파싱 (pdf-parse)
- [ ] 청크 분할 로직
- [ ] MD 생성

### Phase 3 (1주)
- [ ] 규칙 MD 로더
- [ ] 표준 준수 점검
- [ ] cqc 연동

---

## 8. 파일 구조

```
activo-code/
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── standards.ts    # import, list, validate
│   │       ├── improve.ts      # 개선점 분석
│   │       ├── check.ts        # 표준 점검
│   │       └── explain.ts      # cqc 연동
│   ├── core/
│   │   ├── pdf-parser.ts       # PDF → 텍스트
│   │   ├── chunk-splitter.ts   # 청크 분할
│   │   ├── rule-extractor.ts   # Ollama로 규칙 추출
│   │   ├── rule-loader.ts      # MD 로드
│   │   └── analyzer.ts         # 코드 분석
│   └── llm/
│       ├── ollama.ts           # Ollama 클라이언트
│       └── prompts.ts          # 프롬프트 템플릿
├── package.json
└── .activo/                    # 프로젝트별 설정
    └── standards/              # 규칙 MD 저장 위치
```

---

## 9. 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript (Node.js) |
| CLI | Commander.js |
| PDF | pdf-parse |
| LLM | ollama (npm 패키지) |
| 출력 | chalk, ora |

또는 Go로 통일 (code-quality-checker와 맞춤):

| 영역 | 기술 |
|------|------|
| 언어 | Go |
| CLI | cobra |
| PDF | pdfcpu |
| LLM | ollama Go client |

---

## 10. 개발 시작 전 체크리스트

### 환경 준비

```bash
# 1. continue 레포 클론 (참조용)
cd ~/Downloads
git clone https://github.com/continuedev/continue.git

# 2. continue-cli 구조 파악
cd continue
cat extensions/cli/package.json    # 의존성 확인
cat extensions/cli/src/index.ts    # CLI 엔트리 확인
cat core/llm/llms/Ollama.ts        # Ollama 연동 확인

# 3. Ollama 설치 및 모델 다운로드
ollama pull codellama:7b           # 코드 분석용
ollama pull qwen2.5:7b             # 한국어 PDF용 (선택)

# 4. activo-code 프로젝트 생성
cd ~/Projects  # 또는 원하는 위치
mkdir activo-code && cd activo-code
pnpm init
```

### 참조 파일 복사 (선택)

```bash
# Ollama 연동 코드 참조용 복사
cp ~/Downloads/continue/core/llm/llms/Ollama.ts ./reference/

# CLI 구조 참조용 복사
cp ~/Downloads/continue/extensions/cli/src/index.ts ./reference/
```

### Claude Code 작업 시 지시문

```
activo-code 프로젝트를 만들어주세요.

참조 레포: ~/Downloads/continue/
- CLI 구조: extensions/cli/src/
- Ollama 연동: core/llm/llms/Ollama.ts
- 설정 패턴: core/config/

주요 기능:
1. PDF → MD 변환 (청크 분할)
2. 개발표준 규칙 점검
3. 코드 개선점 분석

Ollama 모델: codellama:7b (8GB 메모리 제한)
```
