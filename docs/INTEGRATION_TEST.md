# apex + activo 통합 테스트 시나리오

## 환경

| 항목 | 경로 |
|------|------|
| 개발표준 원본 (docx) | `~/Workspaces/sample-java/FTSS-DES-D299-개발표준정의서-v0.1.docx` |
| activo 표준 마크다운 | `~/Workspaces/activo/.activo/standards/` (10파일, 741줄) |
| 대상 소스코드 | `~/Downloads/spo/src` (Java 297개, XML 63개) |
| apex-ai | `~/Workspaces/apex-ai/` |
| activo | `~/Workspaces/activo/` |

### 대상 소스 구성

- Controller: 60개
- ServiceImpl: 21개
- Mapper XML: 51개
- 전자정부 프레임워크(eGovFrame) 기반 프로젝트

---

## Phase 0: 개발표준 → apex 커스텀 규칙 YAML 생성

> activo가 개발표준 마크다운을 읽고, apex가 실행할 수 있는 커스텀 규칙 YAML을 생성

### 0-1. 표준 마크다운 확인

```bash
cd ~/Workspaces/activo
ls .activo/standards/
# 01_dev-standards.md ~ 07_dev-standards.md, 01_naming_rules.md, 02_code_structure.md
```

**확인사항:**
- [ ] `.activo/standards/` 에 마크다운 파일이 있는가
- [ ] 표준 항목이 RULE-XXX 또는 섹션 헤더로 구분되어 있는가

> 없으면 먼저 변환: `activo -p "~/Workspaces/sample-java/FTSS-DES-D299-개발표준정의서-v0.1.docx PDF로 표준 변환해줘"`

### 0-2. 규칙 생성 실행

```bash
activo -p ".activo/standards 읽고 apex 규칙 생성해줘"
```

내부적으로 `generate_apex_rules` 도구가 실행됨:
- `standards_dir`: `.activo/standards`
- `schema_path`: `~/Workspaces/apex-ai/configs/rule-schema.yaml`
- `existing_rulesets_dir`: `~/Workspaces/apex-ai/configs/rulesets`
- `output_dir`: `.activo/generated-rules`

### 0-3. 결과 확인

```bash
ls .activo/generated-rules/
# custom.yaml       — apex가 실행할 규칙셋
# manual_rules.md   — Go 코드 수정 필요 항목
# matched.md        — 기존 apex 규칙과 매핑된 항목
```

**검증 체크리스트:**

- [ ] `custom.yaml`이 생성되었는가
- [ ] `custom.yaml`이 유효한 YAML인가: `python3 -c "import yaml; yaml.safe_load(open('.activo/generated-rules/custom.yaml'))"`
- [ ] 규칙 ID가 `custom-` 접두사인가
- [ ] severity가 low/medium/high/critical 중 하나인가
- [ ] pattern.type이 rule-schema.yaml에 정의된 20개 타입 중 하나인가
- [ ] regex 타입 규칙의 정규식이 유효한가
- [ ] `manual_rules.md`에 YAML 변환 불가 사유가 기재되어 있는가
- [ ] `matched.md`에 기존 규칙 ID 매핑이 있는가

### 0-4. apex에 커스텀 규칙 배포

```bash
# custom.yaml을 apex rulesets에 복사
cp .activo/generated-rules/custom.yaml ~/Workspaces/apex-ai/configs/rulesets/

# profiles.yaml에 custom 프로파일 추가 (이미 없으면)
cat >> ~/Workspaces/apex-ai/configs/profiles.yaml << 'EOF'

  custom:
    name: "Custom Rules from Standards"
    description: "activo가 개발표준에서 생성한 커스텀 규칙"
    ruleset: "rulesets/custom.yaml"
    languages:
      - java
      - sql
EOF
```

**검증:**
- [ ] `apex --list-profiles`에 custom이 표시되는가
- [ ] custom 프로파일로 빌드 오류 없이 실행 가능한가

---

## Phase 1: apex 전수 검사 → 리포트 생성

> apex가 spo 소스 전체를 검사하고 JSON/Excel 리포트 생성

### 1-1. 기본 프로파일 검사 (all)

```bash
cd ~/Workspaces/apex-ai

# JSON 리포트 (Phase 4 수정 코드 생성용)
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all \
  --output=json \
  --output-file=/tmp/spo-report-all.json

# Excel 리포트 (사람 리뷰용)
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all \
  --output=excel \
  --output-file=/tmp/spo-report-all.xlsx
```

### 1-2. 커스텀 규칙 검사

```bash
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=custom \
  --output=json \
  --output-file=/tmp/spo-report-custom.json
```

### 1-3. activo MCP 경유 검사 (선택)

```bash
activo -p "~/Downloads/spo/src apex 전체 검사해줘"
# → mcp_apex_analyze_code 실행 (profile=all, max_issues=30)
```

### 1-4. 결과 확인

```bash
# 이슈 수 확인
python3 -c "
import json
data = json.load(open('/tmp/spo-report-all.json'))
issues = data.get('issues', data.get('top_issues', []))
print(f'총 이슈: {len(issues)}건')

# severity별 집계
from collections import Counter
sev = Counter(i.get('severity','?') for i in issues)
for k,v in sev.most_common(): print(f'  {k}: {v}건')

# category별 집계
cat = Counter(i.get('category','?') for i in issues)
for k,v in cat.most_common(10): print(f'  {k}: {v}건')
"
```

**검증 체크리스트:**

- [ ] JSON 리포트가 생성되었는가
- [ ] `issues` 배열에 이슈가 있는가
- [ ] 각 이슈에 `rule_id`, `file`, `line`, `severity`, `message` 필드가 있는가
- [ ] 커스텀 규칙(`custom-*`)으로 검출된 이슈가 있는가
- [ ] Excel 리포트가 정상 생성되었는가

---

## Phase 2: 오탐 체크 (사람 작업)

> 사람이 Excel 리포트를 검토하고 오탐(false positive)을 제거

### 2-1. 리뷰 프로세스

1. `/tmp/spo-report-all.xlsx` 열기
2. 각 이슈별로 확인:
   - 실제 위반인가? → 유지
   - 오탐인가? → 제거 또는 `false_positive` 마킹
3. 확정된 이슈만 남긴 리포트 저장

### 2-2. 확정 리포트 생성

```bash
# 방법 A: apex에서 exclude 파일 지정 후 재검사
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all \
  --output=json \
  --output-file=/tmp/spo-report-confirmed.json

# 방법 B: 수동으로 JSON 편집 (오탐 이슈 제거)
# cp /tmp/spo-report-all.json /tmp/spo-report-confirmed.json
# 편집기에서 오탐 이슈 삭제
```

**검증:**
- [ ] 확정 리포트에 오탐이 제거되었는가
- [ ] 이슈 수가 Phase 1보다 같거나 적은가

---

## Phase 3: apex 최종 검사 → 확정 리포트

> Phase 2에서 확정된 규칙/설정으로 최종 리포트 생성

### 3-1. 최종 검사

```bash
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all \
  --output=json \
  --output-file=/tmp/spo-report-final.json
```

### 3-2. 리포트 형식 확인

```bash
# 확정 리포트가 activo generate_fixes 입력 형식에 맞는지 확인
python3 -c "
import json
data = json.load(open('/tmp/spo-report-final.json'))
issues = data.get('issues', data.get('top_issues', []))
if not issues:
    print('ERROR: 이슈 없음')
    exit(1)

sample = issues[0]
required = ['rule_id', 'file', 'line', 'severity', 'message']
missing = [f for f in required if f not in sample and f.replace('_','') not in str(sample.keys())]
if missing:
    print(f'WARNING: 누락 필드: {missing}')
    print(f'실제 필드: {list(sample.keys())}')
else:
    print(f'OK: {len(issues)}건 이슈, 형식 정상')
    print(f'샘플: {json.dumps(sample, ensure_ascii=False, indent=2)[:300]}')
"
```

**검증:**
- [ ] JSON에 `issues` 또는 `top_issues` 배열이 있는가
- [ ] 각 이슈에 `rule_id`, `file`, `line`, `message` 필드가 있는가
- [ ] `file` 경로가 실제 존재하는 파일인가

---

## Phase 4: 확정 이슈 → 수정 코드 생성

> activo가 확정된 이슈에 대해 파일별 수정 코드(diff)를 생성

### 4-1. 수정 코드 생성

```bash
cd ~/Workspaces/activo

activo -p "/tmp/spo-report-final.json 이슈들 개선 코드 생성해줘"
```

내부적으로 `generate_fixes` 도구가 실행됨:
- `report_path`: `/tmp/spo-report-final.json`
- `output_dir`: `.activo/fixes`
- `max_issues_per_file`: 20 (초과 시 스킵)
- `context_lines`: 10

### 4-2. 결과 확인

```bash
ls .activo/fixes/
# *.diff           — 파일별 unified diff
# _fix_summary.md  — 수정 요약

cat .activo/fixes/_fix_summary.md
```

### 4-3. diff 유효성 검증

```bash
# diff 파일이 적용 가능한지 dry-run
for f in .activo/fixes/*.diff; do
  echo "=== $(basename $f) ==="
  patch --dry-run -p1 < "$f" 2>&1 | head -3
  echo
done
```

### 4-4. diff 적용 (선택)

```bash
# 테스트 브랜치에서 적용
cd ~/Downloads/spo
git checkout -b fix/activo-auto-fix

for f in ~/Workspaces/activo/.activo/fixes/*.diff; do
  echo "Applying $(basename $f)..."
  patch -p1 < "$f" || echo "FAILED: $f"
done

# 적용 결과 확인
git diff --stat
```

**검증 체크리스트:**

- [ ] `.activo/fixes/` 디렉토리가 생성되었는가
- [ ] diff 파일이 1개 이상 존재하는가
- [ ] `_fix_summary.md`에 수정/스킵 파일 목록이 있는가
- [ ] diff 파일이 unified diff 형식인가 (`--- a/...`, `+++ b/...`, `@@ ... @@`)
- [ ] `patch --dry-run`이 성공하는가
- [ ] 스킵된 파일에 대한 사유가 기재되어 있는가

---

## Phase 5: 수정 후 재검사 (회귀 검증)

> 수정 코드 적용 후 apex 재검사로 이슈 감소 확인

### 5-1. 재검사

```bash
cd ~/Workspaces/apex-ai

go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all \
  --output=json \
  --output-file=/tmp/spo-report-after-fix.json
```

### 5-2. 이슈 비교

```bash
python3 -c "
import json

before = json.load(open('/tmp/spo-report-final.json'))
after  = json.load(open('/tmp/spo-report-after-fix.json'))

b_issues = before.get('issues', before.get('top_issues', []))
a_issues = after.get('issues', after.get('top_issues', []))

print(f'수정 전: {len(b_issues)}건')
print(f'수정 후: {len(a_issues)}건')
print(f'감소:    {len(b_issues) - len(a_issues)}건 ({(len(b_issues)-len(a_issues))/max(len(b_issues),1)*100:.1f}%)')

# 새로 발생한 이슈 확인 (회귀)
b_keys = {(i.get('rule_id',''), i.get('file',''), i.get('line',0)) for i in b_issues}
a_keys = {(i.get('rule_id',''), i.get('file',''), i.get('line',0)) for i in a_issues}
new_issues = a_keys - b_keys
if new_issues:
    print(f'\n⚠ 신규 발생 이슈: {len(new_issues)}건')
    for k in list(new_issues)[:5]:
        print(f'  {k}')
else:
    print('\n✓ 신규 이슈 없음 (회귀 없음)')
"
```

**검증:**
- [ ] 이슈 수가 감소했는가
- [ ] 새로 발생한 이슈(회귀)가 없는가
- [ ] 컴파일 오류가 발생하지 않는가

---

## 전체 흐름 요약

```
Phase 0                Phase 1           Phase 2        Phase 3            Phase 4              Phase 5
┌──────────┐      ┌──────────┐     ┌──────────┐   ┌──────────┐     ┌──────────────┐     ┌──────────┐
│ activo   │      │  apex    │     │  사람    │   │  apex    │     │   activo     │     │  apex    │
│          │      │          │     │          │   │          │     │              │     │          │
│ 표준.md  │      │ spo/src  │     │ Excel    │   │ spo/src  │     │ report.json  │     │ spo/src  │
│    ↓     │      │    ↓     │     │ 리뷰     │   │    ↓     │     │     ↓        │     │    ↓     │
│ generate │ ──→  │ 전수검사 │ ──→ │ 오탐제거 │→  │ 최종검사 │ ──→ │ generate     │ ──→ │ 재검사   │
│ _apex_   │      │          │     │          │   │          │     │ _fixes       │     │          │
│ rules    │      │ report   │     │ 확정     │   │ final    │     │              │     │ 이슈감소 │
│    ↓     │      │ .json    │     │          │   │ .json    │     │ *.diff       │     │ 확인     │
│custom    │      │ .xlsx    │     │          │   │          │     │ _summary.md  │     │          │
│.yaml     │      │          │     │          │   │          │     │              │     │          │
└──────────┘      └──────────┘     └──────────┘   └──────────┘     └──────────────┘     └──────────┘
```

---

## 빠른 실행 (Phase 0 + 1 + 4 원샷)

Phase 2-3(사람 리뷰)를 생략하고 빠르게 돌려보는 경우:

```bash
cd ~/Workspaces/activo

# Step 1: 규칙 생성
activo -p ".activo/standards 읽고 apex 규칙 생성해줘"

# Step 2: 커스텀 규칙 배포
cp .activo/generated-rules/custom.yaml ~/Workspaces/apex-ai/configs/rulesets/

# Step 3: apex 검사
cd ~/Workspaces/apex-ai
go run ./cmd/apex ~/Downloads/spo/src \
  --profile=all --output=json --output-file=/tmp/spo-quick.json

# Step 4: 수정 코드 생성
cd ~/Workspaces/activo
activo -p "/tmp/spo-quick.json 이슈들 개선 코드 생성해줘"

# Step 5: 결과 확인
cat .activo/fixes/_fix_summary.md
```

---

## 예상 이슈 유형 (spo 프로젝트 기준)

| 카테고리 | 예상 이슈 | 근거 |
|----------|-----------|------|
| naming | Controller/Service 명명규칙 위반 | eGovFrame 표준 |
| security | SQL Injection (MyBatis `${}`) | XML mapper 51개 |
| exception | 빈 catch 블록 | 전자정부 레거시 패턴 |
| deprecated | `java.util.Date` import | 레거시 Java |
| transaction | 복수 CUD에 `@Transactional` 누락 | ServiceImpl 21개 |
| architecture | Controller에서 DAO 직접 호출 | 계층 위반 |
| sql | SELECT *, LEFT JOIN 과다 | XML mapper |
| logging | `System.out.println` 사용 | 개발 잔재 |
| modernize | EgovAbstractDAO 상속 (iBatis 잔존) | eGovFrame 3.x |

---

## 성공 기준

| 기준 | 목표 |
|------|------|
| Phase 0: custom.yaml 생성 | 규칙 5개 이상 |
| Phase 0: YAML 유효성 | 100% 파싱 성공 |
| Phase 1: apex 검사 완료 | 오류 없이 종료 |
| Phase 1: 이슈 검출 | 50건 이상 |
| Phase 4: diff 생성 | 파일 3개 이상 |
| Phase 4: diff 적용률 | patch --dry-run 80% 성공 |
| Phase 5: 이슈 감소율 | 10% 이상 감소 |
