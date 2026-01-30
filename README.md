# ACTIVO

AI 기반 코드 품질 분석 CLI 도구

![Screenshot](screenshot.png)

## 설치

```bash
pnpm install
pnpm build
npm link
```

## 사용법

```bash
# 대화형 모드
activo

# 프롬프트와 함께 실행
activo "src 폴더 구조 보여줘"

# 비대화형 모드
activo --print "package.json 분석해줘"
```

## 주요 기능

- **자연어 인터페이스**: 한글로 명령 입력
- **Tool Calling**: 파일 읽기/쓰기, 검색, 명령 실행
- **PDF 변환**: 개발표준 PDF → Markdown 변환
- **코드 품질 분석**: 규칙 기반 코드 점검

## 요구사항

- Node.js 18+
- [Ollama](https://ollama.ai) 실행 중

## 설정

`~/.activo/config.json`:
```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "mistral:latest"
  }
}
```

## 단축키

| 키 | 동작 |
|---|------|
| `Enter` | 메시지 전송 |
| `ESC` | 진행 중 작업 취소 |
| `Ctrl+C` x2 | 종료 |

## 라이선스

MIT
