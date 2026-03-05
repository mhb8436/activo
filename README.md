# ACTIVO

AI 기반 코드 품질 분석 CLI (Ollama)

![Demo](demo.gif)

Ollama를 활용한 대화형 코드 분석 에이전트. Java, TypeScript, Python, SQL, CSS 등 다국어·멀티스택 프로젝트를 자동 감지하고 품질 이슈를 분석합니다.

> **[ACTIVO 소개자료 (PDF)](docs/ACTIVO_Secure_Code_Agent.pdf)** — 아키텍처, 분석 기능, 도입 효과를 한눈에 확인할 수 있습니다.

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

## APEX 정적분석 연동

[APEX](https://github.com/mhb8436/apex-ai)는 400+ 규칙의 정적분석 엔진입니다. ACTIVO와 MCP로 연동하면 자연어로 코드 품질 점검·Excel 보고서·개선코드 생성을 한 번에 처리할 수 있습니다.

### 연동 기능

| 기능 | 명령 예시 |
|------|----------|
| 코드 품질 분석 | `src 폴더 품질검사 해줘` |
| Excel 점검 내역 출력 | `엑셀로 출력해줘` |
| 경영진 보고서 | `보고서 만들어줘` |
| 개선코드 보고서 (대표사례) | `개선보고서 만들어줘` |
| 개선코드 보고서 (전체 이슈) | `전체 개선보고서 만들어줘` |
| 전체 보고서 자동화 | `전체보고서 /path/to/src /output` |

### APEX MCP 설정

#### 1. APEX 빌드

```bash
git clone https://github.com/mhb8436/apex-ai
cd apex-ai
make mcp        # MCP 서버 빌드 → build/apex-mcp
```

#### 2. activo 설정 (`~/.activo/config.json`)

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "mistral:latest"
  },
  "mcp": {
    "servers": {
      "apex": {
        "command": "/path/to/apex-ai/build/apex-mcp",
        "args": [],
        "env": {
          "APEX_CONFIG_DIR": "/path/to/apex-ai"
        }
      }
    }
  }
}
```

#### 3. 연동 확인

```bash
activo
# [MCP] Connected: apex  ← 이 메시지가 나오면 성공
```

### 전체 보고서 파이프라인

`전체보고서` 키워드 하나로 4단계 자동 실행:

```
전체보고서 /path/to/src /path/to/output
```

```
1. mcp_apex_analyze_code   → 400+ 규칙 정적분석
2. mcp_apex_export_excel   → 전체 이슈 Excel 저장 (4시트)
3. generate_report         → 경영진용 Markdown 보고서 (AI 분석 포함)
4. generate_improvement_report → 문제코드/개선코드 Markdown 보고서
```

**출력물:**
```
output/
├── 2024-01-15_14-30.xlsx              # 고객 납품용 점검 내역 (필터/정렬 가능)
├── 2024-01-15_14-30.md               # 경영진 보고서 (AI 요약 포함)
├── improvement_2024-01-15_14-31.md   # 개선코드 보고서 (대표사례)
└── data/2024-01-15_14-30.json        # 원본 분석 데이터
```

### 개선코드 보고서 옵션

```bash
# 대표사례 모드 (기본, 빠름) - rule_id당 1개 사례
activo "개선보고서 /path/to/report.json"

# 전체 모드 - 모든 이슈 파일별 배치 처리
activo "전체 개선보고서 /path/to/report.json"

# 심각도 필터 (critical만)
# → generate_improvement_report mode=full min_severity=critical
```

### 폐쇄망(망분리) 환경 설치

인터넷이 차단된 환경에서 ACTIVO + APEX를 사용하는 방법입니다.

#### 준비 (인터넷 연결 환경)

```bash
# 1. activo 패키지 생성
cd activo
npm pack
# → activo-0.4.4.tgz 생성

# 2. apex MCP 바이너리 빌드
cd apex-ai
make mcp
# → build/apex-mcp, build/configs/ 생성

# 3. Ollama 모델 파일 준비
# Ollama 모델은 ~/.ollama/models/ 에 저장됨
# 해당 디렉토리를 통째로 복사하거나 모델 파일(.gguf)을 별도 내보내기
```

#### 폐쇄망으로 복사할 파일 목록

```
배포 패키지/
├── activo-0.4.4.tgz          # activo npm 패키지
├── apex-mcp                  # APEX MCP 서버 바이너리 (플랫폼별)
├── apex-configs/             # APEX 규칙셋
│   ├── profiles.yaml
│   └── rulesets/
└── ollama-models/            # Ollama 모델 파일 (선택)
    └── mistral/              # 또는 qwen2.5:7b 등
```

#### 폐쇄망에서 설치

```bash
# Node.js는 사전 설치 필요 (nodejs.org에서 오프라인 설치 패키지 다운로드)

# 1. activo 설치 (오프라인)
npm install -g activo-0.4.4.tgz

# 2. apex 바이너리 권한 설정 (Linux/macOS)
chmod +x apex-mcp

# 3. Ollama 설치 + 모델 로드
# ollama.ai에서 설치 파일 다운로드 후 설치
# 모델 파일을 ~/.ollama/models/ 에 복사하거나:
ollama create mistral -f Modelfile   # GGUF에서 import

# 4. activo 설정
cat > ~/.activo/config.json << 'EOF'
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "mistral:latest"
  },
  "mcp": {
    "servers": {
      "apex": {
        "command": "/opt/apex/apex-mcp",
        "args": [],
        "env": {
          "APEX_CONFIG_DIR": "/opt/apex"
        }
      }
    }
  }
}
EOF

# 5. 실행 확인
activo
```

#### Anthropic API 대신 Ollama 사용

폐쇄망에서는 Anthropic API 연결이 불가하므로 반드시 Ollama를 사용합니다:

```json
{
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5-coder:7b"
  }
}
```

> 권장 모델: `qwen2.5-coder:7b` (코드 분석 특화, 8GB RAM) 또는 `mistral:latest` (범용)

---

## 함께 사용하기

activo는 단독으로도 품질 점검 도구로 충분합니다. **APEX MCP 연동** 시 Excel 리포트·정밀 정적분석이 추가됩니다.

| 용도 | activo 단독 | activo + APEX |
|------|------------|--------------|
| 대화형 분석·설명 | ◎ | ◎ |
| 개발표준 RAG 검사 | ◎ | ◎ |
| 정밀 정적분석 (400+ 규칙) | - | ◎ |
| Excel 제출용 리포트 | - | ◎ |
| 전체 이슈 개선코드 보고서 | - | ◎ |
| 오프라인 단일 바이너리 | - | ◎ (APEX) |

## 기술 스택

- **Ollama / Anthropic API** - 로컬 LLM 또는 클라우드 LLM
- **APEX MCP** - 400+ 규칙 정적분석 엔진 (Go, ANTLR4)
- **TypeScript Compiler API** - JS/TS AST 분석
- **java-ast** - Java 파싱 (ANTLR4)
- **React Ink** - 터미널 UI
- **Model Context Protocol (MCP)** - 외부 도구 연동

## 라이선스

MIT
