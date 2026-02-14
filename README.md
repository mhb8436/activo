# ACTIVO

AI 기반 코드 품질 분석 CLI (Ollama)

![Demo](demo.gif)

Ollama를 활용한 대화형 코드 분석 에이전트. Java, TypeScript, Python, SQL, CSS 등 다국어·멀티스택 프로젝트를 자동 감지하고 품질 이슈를 분석합니다.

- **Tool Calling**: LLM이 상황에 맞는 도구를 직접 호출
- **MCP 지원**: Model Context Protocol 연동
- **React Ink TUI**: 터미널용 대화형 UI

## 주요 기능

| 카테고리 | 도구 | 설명 |
|----------|------|------|
| **전체 분석** | `analyze_all` | 디렉토리 전체 자동 감지 및 분석 (권장) |
| **코드 분석** | Java, JS/TS, Python, React, Vue | AST, 순환 복잡도, 프레임워크 패턴 |
| **SQL/DB** | `sql_check`, `mybatis_check` | SQL Injection, N+1, 동적 SQL 분석 |
| **웹** | `css_check`, `html_check` | !important, 접근성(a11y), SEO 검사 |
| **의존성** | `dependency_check` | npm/Maven/Gradle 보안 취약점 검출 |
| **표준/RAG** | `import_hwp_standards`, `check_quality_rag` | HWP/PDF → 마크다운, RAG 기반 품질 검사 |

## 설치

```bash
npm install -g activo
```

## 요구사항

- Node.js 18+
- [Ollama](https://ollama.ai) 실행 중
- 모델: `ollama pull mistral:latest` (또는 `qwen2.5:7b` 등)

## 사용법

```bash
# 대화형 모드
activo

# 프롬프트와 함께 실행 (권장)
activo "src 폴더 품질 분석해줘"

# 특정 모델 사용
activo --model qwen2.5:7b "Java 코드 복잡도 점검해줘"

# Headless 모드 (CI/스크립트)
activo --headless "analyze_all 해줘"

# 프롬프트만 출력 후 종료
activo --print "분석 요약해줘"

# 이전 세션 이어서
activo --resume
```

## 설정

설정 파일: `~/.activo/config.json` (전역), `.activo/config.json` (프로젝트별)

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "mistral:latest",
    "contextLength": 8192,
    "keepAlive": 1800
  },
  "standards": {
    "directory": ".activo/standards"
  },
  "mcp": {
    "servers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-server"],
        "env": {}
      }
    }
  }
}
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `ollama.baseUrl` | Ollama API URL | `http://localhost:11434` |
| `ollama.model` | 사용할 모델 | `mistral:latest` |
| `ollama.contextLength` | 컨텍스트 길이 | `8192` |
| `ollama.keepAlive` | 모델 유지 시간(초) | `1800` |

## 프로젝트 데이터

분석 시 프로젝트 루트에 `.activo/` 디렉토리가 생성됩니다.

| 경로 | 용도 |
|------|------|
| `.activo/cache/` | 파일 요약 캐시 |
| `.activo/embeddings/` | 코드 임베딩 인덱스 |
| `.activo/memory/` | 프로젝트 메모리·대화 요약 |
| `.activo/standards-rag/` | 표준 문서 RAG (HWP/PDF import 후) |

## MCP 연동

`~/.activo/config.json`의 `mcp.servers`에 MCP 서버를 등록하면 activo가 해당 도구를 자동으로 사용할 수 있습니다.

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
      }
    }
  }
}
```

## 함께 사용하기

activo는 단독으로도 품질 점검 도구로 충분합니다. 다만 **규칙 고정·배치 검사·Excel 리포트**가 필요한 경우 [Code Quality Checker (CQC)](https://github.com/mhb8436/code-quality-checker)와 함께 쓰면 효과적입니다.

| 용도 | activo | CQC |
|------|--------|-----|
| 대화형 분석·설명 | ◎ | - |
| 개발표준 RAG 검사 | ◎ | - |
| 고정 규칙 배치 검사 | - | ◎ |
| Excel 제출용 리포트 | - | ◎ |
| 오프라인 단일 바이너리 | - | ◎ |

activo로 개발표준 PDF를 MD로 변환·RAG 인덱싱한 뒤 점검하고, CQC로 조직 룰셋을 YAML로 정의해 CI·감사에 사용하는 구성이 가능합니다.

## 기술 스택

- **Ollama** - 로컬 LLM
- **TypeScript Compiler API** - JS/TS AST 분석
- **java-ast** - Java 파싱 (ANTLR4)
- **React Ink** - 터미널 UI

## 라이선스

MIT
