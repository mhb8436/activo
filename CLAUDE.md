# CLAUDE.md - activo-code

## 프로젝트 개요

activo-code는 개발표준 PDF를 Markdown으로 변환하고, Ollama 기반 LLM을 활용하여 코드 품질을 분석하는 CLI 도구입니다.

## 핵심 기능

| 명령어 | 설명 |
|--------|------|
| `activo standards import <pdf>` | PDF → MD 변환 (청크 분할) |
| `activo standards list` | 현재 규칙 목록 확인 |
| `activo standards validate` | MD 문법 검증 |
| `activo improve <path>` | 코드 개선점 분석 |
| `activo check <path>` | 표준 준수 점검 |
| `activo explain -i result.json` | code-quality-checker 결과 설명 |

## 아키텍처

```
activo-code/
├── src/
│   ├── cli/
│   │   ├── index.ts              # CLI 엔트리포인트
│   │   └── commands/
│   │       ├── standards.ts      # import, list, validate
│   │       ├── improve.ts        # 개선점 분석
│   │       ├── check.ts          # 표준 점검
│   │       └── explain.ts        # cqc 연동
│   ├── core/
│   │   ├── pdf-parser.ts         # PDF → 텍스트
│   │   ├── chunk-splitter.ts     # 청크 분할
│   │   ├── rule-extractor.ts     # Ollama로 규칙 추출
│   │   ├── rule-loader.ts        # MD 로드
│   │   └── analyzer.ts           # 코드 분석
│   └── llm/
│       ├── ollama.ts             # Ollama 클라이언트
│       └── prompts.ts            # 프롬프트 템플릿
├── package.json
└── .activo/
    └── standards/                # 규칙 MD 저장 위치
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript (Node.js) |
| CLI | Commander.js |
| PDF | pdf-parse |
| LLM | ollama (npm 패키지) |
| 출력 | chalk, ora |

## Ollama 설정

- **코드 분석**: `codellama:7b`
- **한국어 PDF 추출**: `qwen2.5:7b`
- **메모리 제한**: 8GB

## 개발 규칙

### 빌드 & 실행

```bash
# 의존성 설치
pnpm install

# 개발 모드
pnpm dev

# 빌드
pnpm build

# CLI 실행
pnpm start
```

### 테스트

```bash
# 전체 테스트
pnpm test

# 단위 테스트
pnpm test:unit

# 통합 테스트
pnpm test:integration
```

## 단계별 테스트 수행 기록

### Phase 1: CLI 프레임워크 + Ollama 연동

| 단계 | 테스트 항목 | 명령어 | 예상 결과 |
|------|-------------|--------|-----------|
| 1.1 | CLI 초기화 | `activo --version` | 버전 출력 |
| 1.2 | 도움말 | `activo --help` | 명령어 목록 |
| 1.3 | Ollama 연결 | `activo config` | Ollama 상태 확인 |
| 1.4 | 단일 파일 분석 | `activo improve ./test.ts` | 개선점 출력 |

### Phase 2: PDF → MD 변환

| 단계 | 테스트 항목 | 명령어 | 예상 결과 |
|------|-------------|--------|-----------|
| 2.1 | PDF 파싱 | `activo standards import ./test.pdf` | 텍스트 추출 |
| 2.2 | 청크 분할 | 20페이지 이상 PDF | 여러 MD 파일 생성 |
| 2.3 | 규칙 추출 | Ollama 호출 | 규칙 ID, 심각도 포함 |
| 2.4 | MD 생성 | `.activo/standards/` 확인 | 구조화된 MD |

### Phase 3: 규칙 로드 + 점검

| 단계 | 테스트 항목 | 명령어 | 예상 결과 |
|------|-------------|--------|-----------|
| 3.1 | 규칙 목록 | `activo standards list` | 로드된 규칙 수 |
| 3.2 | 표준 점검 | `activo check ./src/` | 위반 사항 리포트 |
| 3.3 | cqc 연동 | `activo explain -i result.json` | 설명 추가된 결과 |
| 3.4 | 언어별 필터 | Java 파일 분석 | Java 규칙만 적용 |

## 참조 레포지토리

- **continue-cli**: https://github.com/continuedev/continue
  - CLI 구조: `extensions/cli/src/`
  - Ollama 연동: `core/llm/llms/Ollama.ts`
  - 설정 패턴: `core/config/`

## 청크 분할 전략

| PDF 크기 | 청크 크기 | MD 파일 수 |
|----------|----------|-----------|
| ~20페이지 | 전체 1개 | 1개 |
| 20~50페이지 | 장/절 단위 | 3~5개 |
| 50페이지+ | 2000자 단위 | 다수 |

## 주의사항

- Ollama 8GB 메모리 제한 고려
- 규칙 MD가 클 경우 카테고리별 분리 호출
- 분석 대상 언어에 맞는 규칙만 로드

## 라이선스

MIT
