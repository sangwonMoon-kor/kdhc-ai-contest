# ON_메모리 — 컨셉 & 발표 스토리 (작업 로그)

> 최종 갱신: 2026-07-08 · 상태: **진행 중** (Hello JARVIS 검색 진입점 + 관리자 콘솔 확정, 최종 발표 동선 리허설 필요)
> 이 문서는 아이디어 흐름을 다른 곳/다른 세션에서 이어받기 위한 정본 작업 로그입니다.
> **먼저 "0. 현재 상태 / 다음 할 일"부터 읽으세요.**

---

## 0. 현재 상태 / 다음 할 일 (이어서 작업용)

**끝난 것**
- ✅ S0 오프닝을 사용자 제작 영상으로 교체·배포 (`demo/assets/opening.mp4`, 23MB, GitHub Pages 라이브)
- ✅ 컨셉 재정의 — 중심축 = **Hello JARVIS 검색 진입 → 업무 액션 → AX 반전**
- ✅ `demo/jarvis.html` 추가 — 구글식 단일 검색창, 사내 근거 답변, 근거 문서, 초안/점검/브리핑 액션으로 이어지는 목업
- ✅ `demo/admin.html` 추가 — 직원 화면에서 숨긴 인제스트·파싱·온톨로지·검증 상태·구조화 이벤트를 심사위원용으로 공개하는 관리자 콘솔
- ✅ **디자인 = Apple 확정 (2026-07-08)** — `demo/jarvis.html`이 Apple판 정본(SF Pro·Action Blue 단일 액센트·검색창에만 정적 글로우·헤드라인만 입체). 콘솔/HUD 시안은 `demo/jarvis-console.html` 백업(미채택). `docs/DESIGN.md`도 Apple 기준으로 갱신 — 이후 모든 화면(admin 포함)은 이 문서로 정렬
- ✅ 발표 서사 척추 (4막 8비트) 설계
- ✅ **영상 스토리보드 확정** (영상 중심·자막 없음 · 매개체=PC 모니터/대시보드 · 캐릭터=사용자 첨부 레퍼런스 · Flow Omni 제작) — §4

**대기 / 남은 일**
- ⏳ **팀원 엔진 실동작 통합 포인트 확정**: 현재는 `admin.html`이 심사위원용 시각 증명 역할. 다음 단계에서 `creationy/jikmu-memory`의 QA·초안·사전점검·인제스트 API를 어느 순간 실호출로 연결할지 결정.
- ⏳ **`demo/admin.html`을 Apple 톤으로 정렬**: 현재 콘솔 미감(시안 네온·모노) → `docs/DESIGN.md`의 Apple 토큰으로 재스킨(밀도는 유지).
- ⏳ **최종 카피 확정**: 현재 간판 후보는 "Hello JARVIS? — 회사에 쌓인 기억이, 내가 하려던 일을 먼저 준비합니다."
- ⏳ **스토리보드 → 실제 제작**: 각 샷 **Flow Omni로 생성**(캐릭터 레퍼런스 첨부) → CapCut 편집. SHOT 1은 현 오프닝 영상 재활용 가능.
- ⏳ (선택) 스토리보드를 팀 공유용 비주얼 보드(웹)로 렌더.
- ⏳ (선택) 확정된 최종 카피를 데모 S0 히어로 문구에 반영.

---

## 1. 핵심 컨셉

### 한 줄 정의
> **순환보직 직원이 "지금·올해 내가 뭘 해야 하지?"를 사내 문서에 바로 물어보는 업무 비서.** 답변은 근거 문서와 함께 나오고, 초안·사전점검·브리핑으로 이어지며, 그 사용 과정이 회사가 원하던 AI-ready 데이터 구조화(온톨로지)를 **자발적 부산물**로 완성한다.

### 문제의 재정의
진짜 문제는 "직원에게 AI 비서가 없다"가 아니라, **AX의 전제인 데이터 구조화(파싱 → 레이어 분리 → 온톨로지)가 (a) 반드시 필요하지만 (b) 위에서 의무로 시키면 거부당한다**는 것.

### 결정적 인사이트
순환보직 공기업 직원에겐 이미 **자발적이고 반복되는 고통**이 있다: "이 업무 어떻게 처리하지?", "작년엔 어떻게 기안했지?", "이 문구 반려 안 나나?". 외부 AI를 쓰기 어려운 환경에서 이 고통을 **사내 문서만 아는 검색형 업무 비서**가 풀어주면, 사용자는 편해서 묻고 이어서 초안·점검을 실행한다.
→ **개인이 자기 좋으라고 묻고 쓰는 일 = 회사 AX.** 강제가 아니라 **부산물**로 AX가 일어난다.

### 숨은 엔진 ↔ 보이는 얼굴
| 숨은 엔진 (AX, 직원 무형·발표에서만 반전) | 보이는 얼굴 (비서/인계, 매일 씀) |
|---|---|
| 파싱·레이어 분리·관계 그래프·조직 지식 축적 **(← 팀원 담당)** | Hello JARVIS 검색 · 브리핑북 · 업무 일기예보 · 초안 · 사전점검 · 내 매뉴얼 |

### 왜 이기나 (심사 포인트)
- 대다수 사내 AX 제안 = **top-down 데이터 정제**(비쌈·저항·정체). 이건 **bottom-up·자발적·부산물** → **"AX 콜드스타트 문제를 직원 개인의 이기심으로 푼다."**
- 공기업 고유의 **순환보직을 부채 → 자산으로 반전**(인계 고통이 곧 데이터 축적 트리거).

### 리스크 / 주의
- (a) 개인 사용이 실제로 데이터를 구조화하려면 확인·교정이 **최소 마찰**로 자연스럽게 일어나야.
- (b) 개인 문서의 조직 이월 = 개인정보·권한 경계("누가 뭘 보나").
- (c) '온톨로지'는 심사 키워드론 좋으나 과하게 기술적 → 발표에선 "조직 지식으로 쌓인다" 수준 언어로.
- (d) **반전이 "직원을 몰래 이용/기만"으로 오해될 여지 → 반드시 긍정·존중 프레임.** (아래 워딩 금지 참고)

---

## 2. 확정된 결정

| 항목 | 결정 |
|---|---|
| 피치 중심축 | **Hello JARVIS 검색으로 진입 → 업무 액션 → 마지막에 AX 반전** (편의 훅 → 전략 착지) |
| 반전 처리 | 제품(직원용)은 **순수 비서 + 은은한 기여신호**("당신의 정리가 다음 사람의 브리핑북이 됩니다"), **심사위원용 반전은 발표 클라이맥스에서만** |
| 착지 문장 | **"개인에게 가장 도움 되는 일이, 회사에 가장 필요한 일과 같은 방향이었습니다."** |
| 오프닝 영상 | 현 영상 유지 + **발표자 멘트로 의미 재정의**('서류 분류'가 아니라 '인수인계 막막함의 은유') |
| 발표 형식 | **발표자가 직접 시연하며 설명** (이야기의 90%는 발표자 말이 나름, 데모는 시각 보조 + 반전) |
| 컨셉 영상 | **자막 없이 영상으로 의미 전달**(show, don't tell) · 매개체=**PC 모니터/대시보드**(책 아님) · **일반 회사 배경**(특정 업무 X) · 캐릭터=사용자 제작 **레퍼런스 첨부**(일관성 신경 X) · 도구=**Flow Omni** — 상세 §4 |
| 디자인 시스템 | **직원용은 cinematic dark 검색 화면, 관리자용은 technical console**. `awesome-design-md`의 xAI/SpaceX/VoltAgent 문법을 차용하되 공기업 발표용 신뢰감 유지 |
| 관리자 반전 화면 | `demo/admin.html`에서 인제스트·파싱·온톨로지·검증 상태·민감정보 가드를 공개. 직원은 기술을 몰라도 되고, 심사위원은 AX 전환 구조를 볼 수 있음 |

### ⚠️ 워딩 금지 목록 (반전 멘트에서 절대 쓰지 말 것)
직원의 노력을 깎거나 회사가 몰래 뽑아먹는 뉘앙스는 전부 금지:
- ❌ "한 일이 있나요? / 없습니다"
- ❌ "위장했습니다 / 속였습니다 / 몰래"
- ❌ "AX 하라고 시킨 사람은 아무도 없었다"

→ 대신 **"그가 자기 일을 잘 해낸 것, 그 자체가 회사에 큰 보탬이 됐다"**(더하기·정렬) 프레임.

---

## 3. 발표 서사 척추 (4막 8비트)

각 비트 = **[발표자 여는 말] → [화면]**. 핵심은 비트 사이 **"그래서/그런데"** 연결 + 마지막 반전.

**1막 · 고통 (진입)**
- **B0 · Hello JARVIS 검색** — *"외부 AI는 못 쓰지만, 우리 회사 문서에게는 물어볼 수 있습니다. 김 과장은 검색창에 묻습니다. 정산시스템 전환은 뭘 먼저 확인해야 해?"* → 진입 마찰 0, 직원 공감.
- **B0-2 · S0 영상** — *"이 서류 더미가 이제 질문에 답하는 업무 기억으로 바뀝니다."* → 영상은 인수인계 막막함보다 "흩어진 문서가 정리되는 은유"로 재해석.

**2막 · 비서가 돕는다 (상승 — 김 과장의 1년)**
- **B1 · JARVIS 결과/S1 브리핑북** — *"답변은 그냥 문장이 아닙니다. 근거 문서, 검증 상태, 그리고 바로 열 수 있는 브리핑북이 붙습니다."* (막막함 → 근거 있는 첫 지도)
- **B2 · S2 일기예보** — *"3월이 다가옵니다. 김 과장은 몰라도 시스템은 알아요 — 작년 이맘때 뭘 기안했는지."* (정적 지도 → 다가오는 일 예보)
- **B3 · S3 초안** — *"그 보고서, 쓰려면 막막하죠. 과거 근거로 초안이 이미 나와 있습니다."* (뭘 할지 → 어떻게 할지)
- **B4 · S4 사전점검 (감정 정점)** — *"제출 직전, 과거 감사 지적·반려와 대조해 위험을 짚어줍니다. 일을 줄이는 걸 넘어 김 과장을 *지켜주는* AI."*
- **B5 · S5 내 매뉴얼** — *"이렇게 6개월. 평범하게 일했을 뿐인데, 하루하루가 '내 매뉴얼'로 저절로 쌓였어요."* + 은은한 기여신호

**3막 · 반전 (AX 착지)** ← 현 데모에 없는 단 하나, 신규 화면 필요
- **B6 · 신규 '반전' 화면** — *"김 과장은 특별한 걸 하지 않았습니다. 그저 자기 앞의 일을 성실히 해냈을 뿐이에요. **그런데** 그 성실한 6개월이 쌓이는 사이, 흩어져 있던 회사 문서들이 AI가 읽을 수 있는 지식으로 정리되고 있었습니다. **김 과장이 자기 일을 잘 해낸 것, 그 자체가 회사의 데이터 전환에 그대로 보탬이 된 거죠."***
  - 착지: **"개인에게 가장 도움 되는 일이, 회사에 가장 필요한 일과 같은 방향이었습니다."**
  - 화면: 김 과장의 개인 활동들이 배경에서 **조직 지식 그래프로 수렴**하는 시각.

**4막 · 여운 (인계 + 확장)**
- **B7 · S6 클로징** — *"김 과장이 또 순환하면? 쌓은 기억은 자리에 남아 다음 사람의 첫날을 바꿉니다. 그리고 이건 모든 자리에서…"* → 확장 비전 + **최종 카피 착지 지점**

> 데모 화면(S1~S5)은 손대지 않음(팀원 작업과 무충돌). 발표자의 "그래서/그런데" 대사가 이음새를 채움. 새로 만들 것은 **B6 반전 화면 하나**.

---

## 4. 영상 스토리보드 (영상 중심 · 자막 없음)

- **제작 도구:** Flow Omni 에이전트 (샷별 생성).
- **캐릭터:** 사용자가 만든 캐릭터 **레퍼런스 이미지 첨부** → 프롬프트에 외형 묘사 불필요, 일관성은 레퍼런스가 담당. 프롬프트엔 `the character`로만.
- **배경:** 특정 업무 상황 X → **일반 회사 사무실**.
- **매개체(중요):** '빛나는 책' → **업무용 PC 모니터/대시보드**(자리에 남는 현실적 매개체). 흩어진 서류가 화면으로 정리돼 쌓이고, 사람이 떠나도 그 화면은 남음.
- **표현 원칙:** **자막 없이 영상으로 의미 전달(show, don't tell).** 감정=표정·자세, 개념=카메라 무브·대비. 설명은 발표자가 라이브로(§3 4막 척추).

| # | 비트 | 길이 | 화면이 말하는 것 (자막 없이 시각으로) |
|---|---|---|---|
| 1 | 막막한 첫날 *(현 오프닝 재활용 가능)* | ~9s | 큰 사무실 구석 한 자리, 서류 산더미에 파묻혀 웅크린 캐릭터, 꺼진 어두운 모니터. 막막·고립 (표정+대비) |
| 2 | 기억이 깨어난다 | ~8s | 키보드를 건드리면 모니터가 따뜻하게 켜지고 흩어진 서류가 화면으로 빨려들어가 깔끔한 대시보드로 정렬. 표정: 절망→경이→안도 |
| 3 | 능숙해진다 (몽타주) | ~13s | 창밖 빛이 아침→저녁. 캐릭터가 자신감 있게 화면과 일함 — 달력 알림에 끄덕, 초안 자동 조립, 빨간 경고를 잡아냄. 편안·능숙 |
| 4 ⭐ | 반전 — 나도 모르게 쌓인다 | ~11s | 고개 숙여 일하는 캐릭터, 끝낸 일마다 작은 빛 입자가 떠오름(본인은 모름). 카메라가 뒤로·위로 빠지면 그 입자들이 등 뒤로 거대한 빛의 지식망을 이룸. **작고 담담한 사람 ↔ 그가 모르게 지은 거대한 구조**의 대비 = "내 일 = 회사 자산" |
| 5 | 남기고, 이어진다 | ~10s | 노을. 마지막으로 화면을 바라보고 개인 머그를 챙겨 떠남. 정돈된 책상 + 여전히 켜진 모니터 + 새 머그가 놓임(다음 사람 암시) |
| 6 | 확장 | ~7s | 카메라가 사무실 전체→건물 위로. 자리마다 같은 빛의 모니터, 빛의 실선이 이어져 하나의 망 |
| 7 | 타이틀 카드 | ~4s | 캐릭터 정면 미소 + 상단에 카피 얹을 여백. 착지: "개인에게 가장 도움 되는 일이, 회사에 가장 필요한 일과 같은 방향이었습니다." |

**총 ~60초 / 클립 6개 + 타이틀.** 핵심은 **SHOT 4** — 자막 없이 카메라 무브(뒤로·위로)와 대비만으로 반전.

### 샷별 영문 생성 프롬프트 (참고 · `the character`=첨부 레퍼런스, 자막 없음)
- **S1** `A single desk in a large quiet corporate office at dawn. The character sits small and hunched, almost swallowed by towering chaotic stacks of paper documents, facing a cold dark monitor, looking lost and overwhelmed. Dim bluish light with one warm lamp, slow push-in. Cinematic, melancholic. No text.`
- **S2** `The character touches the keyboard; the dark monitor awakens with a warm golden glow and the scattered papers lift and stream into the screen, self-sorting into a clean dashboard of glowing folders. The character's face shifts from despair to wonder to relief. Warm, hopeful, gentle move. No text.`
- **S3** `Montage as window light shifts morning to evening. The character works confidently with the glowing monitor: a calendar date pulses and they nod, a draft assembles on screen, a soft red warning appears and they catch it with relief. Growing ease and confidence. Warm, cozy, smooth. No text.`
- **S4** `The character works head-down; each finished task releases a tiny glowing mote they don't notice. Camera slowly pulls back and rises, revealing the motes have woven into a vast luminous tree-like network of light behind them. The character stays small and unaware of the beautiful structure their ordinary work built. Awe-inspiring reveal. No text.`
- **S5** `Warm dusk light. The character gives the glowing monitor a last gentle look, picks up a personal mug and leaves the frame. The desk is now clean and organized; the empty chair and the monitor still glowing warmly; a fresh coffee mug appears, hinting someone new arrives. Tender, bittersweet, slow. No text.`
- **S6** `Camera lifts up and out over an open-plan office then over the whole building; every desk's monitor glows the same warm light, connected by delicate threads of light into one network. Inspiring, expansive, cinematic. No text.`
- **타이틀** `The character faces forward with a gentle warm smile, centered on a clean minimal warm-lit background with empty space at the top for a title. Simple, elegant. No text.`

---

## 5. 관련 파일 / 링크
- 데모(정본): `demo/index.html`
- 라이브: https://sangwonmoon-kor.github.io/kdhc-ai-contest/demo/index.html
- 현 오프닝 영상: `demo/assets/opening.mp4` (원본 `~/Movies/CapCut/0707.mov`)
- 기존 기획서: `docs/PRD.md`
- 이 문서: `docs/concept-and-story.md`
