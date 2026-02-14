# activo 개선 계획 (2026-02)

이 문서는 코드베이스 분석 결과를 바탕으로 한 개선 계획입니다.

---

## 1. Ollama 작은 모델 지원 강화

### 현재 상태

| 항목 | 현재 | 비고 |
|------|------|------|
| 기본 모델 | `mistral:latest` | config.ts 기본값 |
| 컨텍스트 | 4096 | contextLength |
| 작은 모델 가이드 | OLLAMA_MODELS.md 존재 | phi3:mini, qwen2.5:3b, gemma2:2b 권장 |

**문제점:**
- 기본값이 `mistral:latest`로 7B급 — VRAM 8GB 이하 환경에서 layout memory 에러
- **작은 모델(3B 이하)** 사용 시 도구 스키마 + 시스템 프롬프트 토큰 과다
- `selectTools`가 최대 ~15개 도구 전달 — 작은 모델은 토큰 부담 큼

### 개선 방안

#### 1.1 기본 모델 변경 (작은 모델 우선)

```typescript
// src/core/config.ts
model: "qwen2.5:3b"  // 또는 phi3:mini
```

**장점:** VRAM 2~3GB, 8GB PC에서 안정적  
**단점:** 도구 선택/요약 품질 약간 저하 가능 → Intent Router로 상쇄

#### 1.2 모델별 도구 수 제한 (`selectTools`)

작은 모델(3B 이하)일 때 `maxTools` 파라미터 추가:

```typescript
// config에 modelSize: "small" | "medium" | "large" 추가
// small: 최대 8개 도구, core + 매칭 카테고리 1~2개만
```

#### 1.3 compressAnalysisResult 강화

현재 `maxChars: 2000` → **작은 모델용 1200** 옵션 추가:

```typescript
compressAnalysisResult(resultContent, config.modelSize === "small" ? 1200 : 2000)
```

#### 1.4 Intent Router 확대 (권장)

**현재:** 경로 + 키워드 매칭 시 LLM 없이 바로 도구 실행 → **도구 스키마 미전송** (VRAM 절약)

**개선:** `전자정부`, `egov`, `공통컴포넌트` 키워드 추가하여 `analyze_all` 또는 `egov_check` 바로 실행

---

## 2. 시스템 프롬프트 개선

### 현재 상태

```25:31:src/core/agent.ts
const BASE_SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer. You MUST call tools to perform tasks.

## RULES
1. Call tool IMMEDIATELY when user requests an action
2. NEVER fabricate results - only report actual tool output
3. After tool returns, summarize in user's language (Korean if user speaks Korean)
4. Use analyze_all for broad code analysis`;
```

**문제점:**
- 역할 정의가 단순
- 출력 형식(마크다운, 구조화 등) 명시 없음
- 작은 모델이 혼동하기 쉬운 상황(예: 여러 도구 중 선택)에 대한 가이드 부재
- **한 번에 하나의 도구** 호출 강조 필요 (작은 모델은 멀티 툴콜에 취약)

### 개선 방안

#### 2.1 구조화된 시스템 프롬프트 (모델 크기별)

```markdown
# 역할
ACTIVO — 코드 품질 분석 도구. Java/Spring, 전자정부프레임워크, 프론트엔드 등 검사.

# 규칙
1. 도구를 반드시 호출하여 작업 수행. 결과를 지어낼 금지.
2. 사용자 요청 시 즉시 적절한 도구 1개만 호출 (한 번에 하나).
3. 도구 결과 도착 후 한국어로 요약. 핵심 이슈·개선점 위주.
4. 분석 요청: analyze_all 권장. Java/Spring: java_analyze, spring_check.

# 출력 형식
- 이슈 있음: severity(에러/경고), 라인, 메시지, 개선 제안
- 이슈 없음: "특별한 이슈 없음" 간단히
```

#### 2.2 요약 전용 짧은 프롬프트 (Intent Router 사용 시)

도구 실행 후 요약만 할 때는 **도구 스키마 없음** → 프롬프트를 더 구체적으로:

```markdown
아래는 [도구명] 결과입니다. 사용자에게 한국어로 핵심만 3~5문장 요약. 이슈 있으면 severity와 개선 제안 포함.
```

---

## 3. 자바 스프링 / 전자정부프레임워크 검사 강화

### 현재 상태

| 기능 | 파일 | 내용 |
|------|------|------|
| java_analyze | javaAst.ts | AST 분석, NPE/예외 안티패턴, dead-code |
| spring_check | javaAst.ts | @Controller, @Service, @Repository, @Entity 등 |

**한계:**
- **전자정부프레임워크(eGov)** 특화 검사 **없음**
- 공통컴포넌트, BaseVO, EgovAbstractServiceImpl 등 패턴 미검사

### 전자정부프레임워크 개발표준 검사 항목 (예정)

#### 3.1 추가 검사 패턴

| 패턴 | 설명 | 검사 내용 |
|------|------|----------|
| BaseVO 상속 | 공통 VO 베이스 | BaseVO 상속 여부, 페이징 필드 (pageIndex, pageUnit 등) |
| EgovAbstractServiceImpl | 서비스 구현 표준 | 상속 구조, @Override 누락 |
| EgovAbstractDAO | DAO 표준 | Generics casting, deprecated 사용 |
| 공통컴포넌트 | egovframework 패키지 | import egovframework.* 패턴 |
| 명명규칙 | 개발표준 | ServiceImpl suffix, DAO suffix |
| 예외처리 | 전자정부 표준 | EgovBizException 등 |

#### 3.2 신규 도구: `egov_check`

```
이름: egov_check
설명: 전자정부프레임워크 개발표준 검사. BaseVO, EgovAbstract*, 공통컴포넌트 패턴 분석.
파라미터: pattern (glob, 예: src/**/*.java)
```

#### 3.3 구현 우선순위

1. **1단계:** 정규식 기반 egov 패턴 감지 (LLM 불필요, 7B 이하에서 동작)
   - `extends EgovAbstractServiceImpl`
   - `extends BaseVO`
   - `import egovframework.`
   - `EgovAbstractDAO`

2. **2단계:** java_analyze에 egov 이슈 통합
   - `QualityIssue` 타입에 `egov-standard` 추가

3. **3단계:** analyze_all에 egov_check 연동
   - `include: ["java"]` 시 egov_check 자동 실행 (선택)

---

## 4. 구현 우선순위 요약

| 순위 | 항목 | 난이도 | 영향 |
|------|------|--------|------|
| 1 | Intent Router에 전자정부 키워드 추가 | 낮음 | 즉시 egov 분석 라우팅 |
| 2 | 시스템 프롬프트 개선 (한 번에 1도구, 출력 형식) | 낮음 | 작은 모델 안정성 |
| 3 | 기본 모델 → qwen2.5:3b 또는 phi3:mini | 낮음 | 8GB 이하 PC 대응 |
| 4 | egov_check 도구 (정규식 1단계) | 중간 | 전자정부 전용 검사 |
| 5 | 모델별 selectTools 제한 (maxTools) | 중간 | 작은 모델 토큰 절감 |
| 6 | java_analyze에 egov 이슈 통합 | 중간 | 통합 리포트 |

---

## 5. 참고

- [OLLAMA_MODELS.md](./OLLAMA_MODELS.md) — Ollama 모델 선택 가이드
- [CLAUDE.md](../CLAUDE.md) — Java 품질 검사 구현 이력
- [전자정부 표준프레임워크 개발가이드](https://www.egovframe.go.kr/wiki/)
