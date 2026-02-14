# Ollama 모델 가이드

activo 실행을 위한 Ollama 모델 선정 및 문제 해결 가이드입니다.

## activo 요구사항

| 항목 | 요구사항 |
|------|----------|
| **Tool Calling** | Ollama `tools` 파라미터 지원 (필수) |
| **컨텍스트** | 시스템 프롬프트 + 도구 스키마 + 대화 → 최소 4k~8k 토큰 |
| **언어** | 한국어 이해·생성 |
| **역할** | 코드 분석, 도구 선택, 요약 |

---

## 8GB VRAM 기준 모델

| 모델 | q4 (4-bit) | q8 (8-bit) |
|------|------------|------------|
| 3B급 | ~2GB | ~3GB |
| 7B급 | ~4~5GB | ~7GB |
| 8B급 | ~5GB | ~8GB |
| 13B급 | ~7~8GB | ❌ |

8GB VRAM에서는 **7B q4/q8** 또는 **3B급**이 안전합니다.

---

## 추천 모델 (우선순위)

### 1순위: qwen2.5:7b

- VRAM: q4 4~5GB, 8GB에서 여유 있음
- Tool Calling: 양호
- 한국어: 우수
- activo 기본 권장 모델

```bash
ollama pull qwen2.5:7b
```

### 2순위: mistral:7b

- activo 기본 설정 모델
- Tool Calling 지원

```bash
ollama pull mistral:7b
```

### 3순위: phi3:mini (속도 우선)

- VRAM: ~2.5GB, 여유 큼
- 속도: 7B 대비 빠름
- 8GB에서 layout memory 에러 시 권장

```bash
ollama pull phi3:mini
```

### 4순위: qwen2.5:3b (한국어 우선)

- VRAM: ~2GB
- 한국어 지원 우수
- 8GB에서 안정적

```bash
ollama pull qwen2.5:3b
```

### 5순위: gemma2:2b (경량)

- VRAM: ~1.5GB
- 가장 빠른 응답
- 도구 복잡도 높을 때는 3B 이상 권장

```bash
ollama pull gemma2:2b
```

---

## Layout Memory 에러 해결

`qwen2.5-coder:7b` 등 7B 모델에서 **layout memory** 에러가 발생하면:

### 원인

- VRAM 8GB 초과
- `num_ctx`(컨텍스트 길이) 과다
- 도구 스키마 + 대화로 토큰 수 증가

### 해결 방법

1. **3B급 모델로 전환** (가장 확실)
   - `phi3:mini` 또는 `qwen2.5:3b` 사용

2. **컨텍스트 길이 축소**

   `~/.activo/config.json`:

   ```json
   {
     "ollama": {
       "model": "phi3:mini",
       "contextLength": 4096
     }
   }
   ```

   기본값 8192 → 4096 권장

3. **작은 양자화 버전 시도** (7B 유지 시)
   ```bash
   ollama pull qwen2.5-coder:7b-instruct-q4_0
   ```

---

## 느린 시작 시간 해결

activo 시작이 오래 걸리는 경우:

### 원인

1. **Ollama 모델 로딩**: 첫 요청 시 VRAM에 로드 (15~60초)
2. **--resume 사용**: 세션 요약을 위해 LLM 자동 호출
3. **첫 메시지 컨텍스트**: 도구 스키마 등 대용량 전송

### 해결 방법

1. **모델 선로딩**
   ```bash
   ollama run phi3:mini "ready"
   # 이후 activo 실행
   ```

2. **keepAlive 연장**
   `~/.activo/config.json`에서 `keepAlive: 3600` 이상

3. **--resume 생략**: 세션 이어쓰기가 필요 없으면 `--resume` 미사용

---

## 8GB VRAM + Layout Error 시 권장 조합

| 상황 | 추천 모델 |
|------|-----------|
| Layout memory 에러 발생 | **phi3:mini** 또는 **qwen2.5:3b** |
| 한국어 비중 높음 | **qwen2.5:3b** |
| 속도 최우선 | **phi3:mini** 또는 **gemma2:2b** |
| 7B 유지 희망 | **qwen2.5:7b** (coder 대신) + contextLength 4096 |

### 설정 예시

```json
{
  "ollama": {
    "model": "phi3:mini",
    "contextLength": 4096,
    "baseUrl": "http://localhost:11434",
    "keepAlive": 1800
  }
}
```

```bash
activo --model phi3:mini
```

---

## 비권장

| 모델 | 이유 |
|------|------|
| 13B 이상 | 8GB VRAM 부족 |
| Tool Calling 미지원 | activo 핵심 기능 불가 |
| 1B~1.5B급 | 도구 복잡도 대비 품질 부족 |
