# Claude Code 기여 기록

이 문서는 Claude Code (Anthropic)가 activo 프로젝트에 기여한 내용을 기록합니다.

---

## 워크플로우 규칙 (필수)

### 빌드/테스트/커밋 순서

코드 변경 후 커밋 전 반드시 아래 순서를 따른다:

```bash
# 1. 빌드
npm run build

# 2. 테스트 실행
npm run test

# 3. 테스트 성공 시에만 커밋
git add -A && git commit -m "..."
```

**주의사항:**
- 테스트 실패 시 커밋하지 않는다
- 테스트가 없는 새 기능은 테스트 코드를 먼저 작성한다
- `npm version` 및 `npm publish`는 테스트 통과 후에만 실행한다
- 커밋 메시지에 `Co-Authored-By` 포함하지 않는다

---

## 세션: 2026-02-01

### 구현된 기능

#### 1. 파일 요약 캐싱 (`src/core/tools/cache.ts`)
- `summarize_file`: LLM으로 파일 요약 후 캐싱
- `get_file_outline`: 함수/클래스 시그니처 추출 (LLM 없음)
- `get_cached_summary`: 캐시된 요약 조회
- `list_cache`: 캐시 목록
- `clear_cache`: 캐시 삭제
- `batch_summarize`: 다중 파일 일괄 요약

**특징:**
- MD5 해시로 파일 변경 감지
- TypeScript, JavaScript, Python, Go 지원
- `.activo/cache/index.json`에 저장

#### 2. AST 분석 (`src/core/tools/ast.ts`)
- `ast_analyze`: TypeScript Compiler API로 심층 분석
- `get_call_graph`: 함수 호출 관계 추적
- `find_symbol_usage`: 심볼 사용처 검색
- `complexity_report`: 순환 복잡도 리포트

**특징:**
- tree-sitter 대신 TypeScript Compiler API 사용 (의존성 충돌 회피)
- 함수 파라미터, 리턴 타입, 복잡도 추출
- 호출된 함수 목록 추적

#### 3. 코드 임베딩/RAG (`src/core/tools/embeddings.ts`)
- `index_codebase`: 코드베이스 벡터 인덱싱
- `semantic_search`: 의미 기반 코드 검색
- `find_similar_code`: 유사 코드 찾기
- `embeddings_status`: 인덱스 상태
- `clear_embeddings`: 인덱스 삭제

**특징:**
- Ollama `nomic-embed-text` 모델 사용
- 함수/클래스 단위로 청킹
- 코사인 유사도 기반 검색
- `.activo/embeddings/`에 저장

#### 4. 프로젝트 메모리 (`src/core/tools/memory.ts`)
- `init_project_memory`: 프로젝트 컨텍스트 초기화
- `add_key_file`: 중요 파일 등록
- `add_note`: 노트 저장
- `add_fact`: key=value 사실 저장
- `save_conversation`: 대화 요약 저장
- `get_project_context`: 컨텍스트 조회
- `search_memory`: 메모리 검색
- `clear_memory`: 메모리 삭제

**특징:**
- 세션 간 컨텍스트 유지
- 최근 20개 대화 보관
- `.activo/memory/store.json`에 저장

#### 5. Ollama 클라이언트 확장 (`src/core/llm/ollama.ts`)
- `embed()`: 텍스트 임베딩 생성
- `embedBatch()`: 배치 임베딩

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/core/tools/index.ts` | 새 도구 모듈 통합 |
| `src/core/llm/ollama.ts` | 임베딩 메서드 추가 |
| `README.md` | 새 기능 문서화 |
| `src/core/tools/frontendAst.ts` | React/Vue/jQuery 분석 도구 |
| `src/core/tools/sqlAnalysis.ts` | SQL 쿼리 분석 도구 |
| `src/core/tools/mybatisAnalysis.ts` | MyBatis XML 분석 도구 |
| `src/core/tools/cssAnalysis.ts` | CSS/SCSS/LESS 분석 도구 |
| `src/core/tools/htmlAnalysis.ts` | HTML/JSP 분석 도구 |
| `src/core/tools/dependencyAnalysis.ts` | 의존성 분석 도구 |
| `src/core/tools/openapiAnalysis.ts` | OpenAPI/Swagger 분석 도구 |
| `src/core/tools/pythonAnalysis.ts` | Python 분석 도구 |

#### 5. Java AST 분석 (`src/core/tools/javaAst.ts`)
- `java_analyze`: Java 파일 AST 분석 (클래스, 메서드, 필드, 어노테이션)
- `java_complexity`: Java 복잡도 리포트
- `spring_check`: Spring 패턴 검사 (Controller, Service, Repository, Entity)

**특징:**
- `java-ast` 패키지 사용 (ANTLR4 기반)
- Spring 어노테이션 자동 감지
- 순환 복잡도 계산

#### 6. 프론트엔드 분석 (`src/core/tools/frontendAst.ts`)
- `react_check`: React 컴포넌트 분석
  - 함수/클래스 컴포넌트 구분
  - Hooks 사용 분석 (useState, useEffect, useMemo 등)
  - 인라인 arrow function 경고
  - 클래스 컴포넌트 → 함수 컴포넌트 권장
- `vue_check`: Vue 컴포넌트 분석
  - Options API / Composition API / Script Setup 감지
  - 컴포넌트 구조 분석 (data, methods, computed, watch 등)
  - Vue 3 권장사항 제안
- `jquery_check`: jQuery deprecated 메서드 검사
  - bind, live, die, size, toggle 등 deprecated 메서드 감지
  - 대체 메서드 권장 (bind → on, size → length 등)
  - jQuery 셀렉터 분석

**특징:**
- TypeScript Compiler API로 JSX/TSX 파싱
- 정규식 기반 Vue SFC 분석
- deprecated 메서드 자동 감지

#### 7. SQL 분석 (`src/core/tools/sqlAnalysis.ts`)
- `sql_check`: Java 파일 내 SQL 쿼리 분석
  - @Query, @NamedQuery 어노테이션 추출
  - createQuery, prepareStatement JDBC 쿼리 추출
  - SELECT *, N+1 패턴, LIKE '%...' 검출
  - 복잡한 JOIN, 서브쿼리 경고

**특징:**
- JPA/JPQL, Native Query, JDBC 모두 지원
- 라인 번호 포함 상세 리포트

#### 8. MyBatis 분석 (`src/core/tools/mybatisAnalysis.ts`)
- `mybatis_check`: MyBatis XML 매퍼 분석
  - DTD/namespace로 MyBatis 파일 자동 감지
  - ${} SQL Injection 위험 검출
  - 동적 SQL 요소 분석 (if, choose, foreach, where, set)
  - WHERE 없는 UPDATE/DELETE 경고
  - 미사용 resultMap 감지

**특징:**
- select/insert/update/delete 구문 파싱
- 동적 SQL 복잡도 분석

#### 9. CSS 분석 (`src/core/tools/cssAnalysis.ts`)
- `css_check`: CSS/SCSS/LESS 분석
  - !important 남용 검출
  - 셀렉터 복잡도 (깊이, ID 중첩)
  - 중첩 깊이 (SCSS/LESS)
  - vendor prefix 직접 사용
  - 레거시 속성 (float)
  - z-index 과다 사용

**특징:**
- 변수, mixin 추출
- 규칙별 이슈 리포트

#### 10. HTML 분석 (`src/core/tools/htmlAnalysis.ts`)
- `html_check`: HTML/JSP/Vue 분석
  - 접근성(a11y): alt, label, aria-label 누락
  - SEO: title, description, viewport 검사
  - 시맨틱 태그: header, main, nav, footer
  - deprecated 태그: font, center, marquee
  - 폼 요소: label 연결, autocomplete
  - iframe: title, sandbox 보안

**특징:**
- a11y 점수, SEO 점수 계산
- 요소별 상세 이슈 리포트

#### 11. 의존성 분석 (`src/core/tools/dependencyAnalysis.ts`)
- `dependency_check`: 프로젝트 의존성 분석
  - package.json (npm) 분석
  - pom.xml (Maven) 분석
  - build.gradle (Gradle) 분석
  - 알려진 취약점 검출 (Log4Shell, Fastjson 등)
  - deprecated 패키지 감지 (moment, tslint, node-sass 등)
  - 불안정 버전 경고 (0.x, SNAPSHOT)

**특징:**
- 보안 취약점 데이터베이스 내장
- npm/Maven/Gradle 지원

#### 12. OpenAPI 분석 (`src/core/tools/openapiAnalysis.ts`)
- `openapi_check`: OpenAPI/Swagger 스펙 분석
  - 엔드포인트 추출 및 검증
  - 파라미터, 요청/응답 스키마 분석
  - 누락된 필드 검출 (summary, operationId, tags)
  - 보안 스키마 정의 검사

**특징:**
- OpenAPI 3.x, Swagger 2.x 지원
- YAML, JSON 파싱

#### 13. Python 분석 (`src/core/tools/pythonAnalysis.ts`)
- `python_check`: Python 파일 분석
  - 클래스, 함수, import 추출
  - Django/Flask/FastAPI 프레임워크 패턴 감지
  - docstring 커버리지 분석
  - 보안 이슈 검출 (eval, exec, 하드코딩된 비밀번호)
  - PEP8 권장사항 검사

**특징:**
- 프레임워크별 패턴 분석
- 보안 취약점 자동 감지

### 도구 통계

| 카테고리 | 추가된 도구 |
|----------|------------|
| Cache | 6개 |
| AST (TS/JS) | 4개 |
| Embeddings | 5개 |
| Memory | 8개 |
| Java | 3개 |
| Frontend | 3개 |
| SQL/DB | 2개 |
| Web | 2개 |
| 의존성 | 1개 |
| API | 1개 |
| Python | 1개 |
| **총합** | **36개** |

### 기술 결정

1. **tree-sitter 대신 TypeScript Compiler API**
   - npm 의존성 충돌 회피
   - TypeScript가 이미 devDependency로 설치됨
   - TS/JS 파일에 더 정확한 분석

2. **청크 크기 제한 (1500자)**
   - `nomic-embed-text` 컨텍스트 제한 대응
   - 큰 함수는 자동 분할

3. **MD5 해시 기반 캐시 무효화**
   - 파일 내용 변경 시에만 재생성
   - 증분 인덱싱 지원

---

## 세션: 2026-02-13 (v0.4.4)

### Java 코드 품질 검사 추가 및 버그 수정

#### 1. Java 품질 이슈 감지 (`src/core/tools/javaAst.ts`)

`java_analyze` 도구에 정규식 기반 코드 품질 검사 추가 (LLM 미사용, 7B 모델에서도 동작):

- **`QualityIssue` 인터페이스** — type, severity, line, message, suggestion
- **`JavaFileAnalysis.issues`** 필드 추가

**감지 함수 3개:**

| 함수 | 감지 항목 | severity |
|------|----------|----------|
| `detectNPERisks()` | `.get().toString()`, `.get().equals()`, `(String) map.get()`, `.get().length()/size()` | error |
| `detectExceptionAntiPatterns()` | 빈 catch 블록, `e.printStackTrace()`, catch 내 info 레벨 로그, 미사용 예외 변수 | warning |
| `detectCommentedOutCode()` | 연속 5줄 이상 `//` 주석 + Java 키워드 포함 시 dead-code 판정 | info |

**특징:**
- 정규식 기반 — AST 파싱 실패해도 독립 동작
- TODO/FIXME/NOTE 주석은 dead-code에서 제외
- `formatJavaAnalysis()`에 `⚠️ 이슈` 섹션 출력

#### 2. `analyze_all` 버그 수정 (`src/core/tools/analyzeAll.ts`)

- **spring_check 호출 수정**: `{ filepath: file }` → `{ pattern: "path/**/*.java" }` (glob 기반으로 수정, 기존에는 파라미터 불일치로 실행 실패)
- **java_analyze 이슈 추출 수정**: `summary.files[].issues` → `summary.samples[].result.issues` (실제 데이터 구조에 맞게 수정)

#### 3. LLM 요약에 이슈 반영 (`src/core/agent.ts`)

- `compressAnalysisResult()`에서 `samples[].result.issues` 추출하여 `brief.issues`로 포함 (최대 10건)
- headless 모드 LLM 요약 시 품질 이슈가 반영됨

#### 4. 통합 테스트 (`src/core/tools/javaQuality.integration.test.ts`)

실제 Java 프로젝트(`서비스안내팀 소스`) 대상 23개 테스트, 5개 시나리오:

| 시나리오 | 테스트 수 | 내용 |
|----------|----------|------|
| java_analyze 단일 파일 이슈 감지 | 9 | NPE, 예외 안티패턴, 주석 코드 블록 |
| spring_check glob 기반 실행 | 3 | pattern 파라미터 정상 동작, filepath 호출 시 빈 결과 |
| analyze_all 디렉토리 분석 | 4 | issues 포함, issuesSummary 추출, spring_check 버그 수정 검증 |
| compressAnalysisResult 이슈 포함 | 1 | 압축 결과에 issues 유지 |
| 이슈 감지 정확도 (인라인) | 6 | NPE 4패턴, 빈 catch, printStackTrace, dead-code + false positive 방지 |

### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/core/tools/javaAst.ts` | QualityIssue 인터페이스, 3개 감지 함수, issues 필드, 포맷 출력 |
| `src/core/tools/analyzeAll.ts` | spring_check 파라미터 수정, java_analyze 이슈 추출 경로 수정 |
| `src/core/agent.ts` | compressAnalysisResult에 issues 포함 |
| `src/core/tools/javaQuality.integration.test.ts` | 통합 테스트 23개 (신규) |

### 기술 결정

1. **정규식 기반 품질 검사 (AST 불필요)**
   - java-ast 파서 실패해도 독립적으로 동작
   - 7B 모델(qwen2.5-coder:7b)에서도 LLM 없이 감지
   - compressAnalysisResult가 2000자 제한이므로 소형 모델 컨텍스트에 적합

2. **spring_check은 glob 기반 유지**
   - 개별 파일 단위가 아닌 프로젝트 전체 패턴 분석 도구
   - analyzeAll에서 `path/**/*.java` 패턴으로 위임

---

*Generated by Claude Code (claude-opus-4-6)*
