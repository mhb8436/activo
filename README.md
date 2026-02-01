# ACTIVO

AI 기반 코드 품질 분석 CLI (Ollama)

![Demo](demo.gif)

## 설치

```bash
npm install -g activo
```

## 요구사항

- Node.js 18+
- [Ollama](https://ollama.ai) 실행 중
- 모델: `ollama pull mistral:latest`

## 사용법

```bash
# 대화형 모드
activo

# 프롬프트와 함께 실행
activo "src 폴더 분석해줘"

# 특정 모델 사용
activo --model qwen2.5:7b
```

## 라이선스

MIT
