---
name: HelloJARVIS-design
base: awesome-design-md / design-md/apple/DESIGN.md (adapted)
description: "Apple의 절제 — SF Pro, 여백 중심, Action Blue(#0066cc) 단일 액센트, pill 버튼, 소프트 엘리베이션 1종 — 를 차용한 사내 AI 디자인 시스템. 직원에게는 검색 한 줄만 보이고, 관리자에게는 인제스트·온톨로지·검증 상태가 보인다. (2026-07-08 사용자 확정: 콘솔/HUD 시안 → Apple로 전환)"
---

# Hello JARVIS Design System

## 1. 디자인 의도

Hello JARVIS의 첫 화면은 “새로운 업무 시스템”처럼 보이면 안 된다. 직원은 업무를 추가로 배운다고 느끼지 않고, 구글 첫 화면처럼 질문 하나만 입력하면 된다. 기술적인 인제스트, 파싱, 온톨로지, 검증 상태는 직원 화면에서 숨기고, 관리자 콘솔에서만 드러낸다.

발표 연출은 아이언맨의 JARVIS 호출 감각을 차용하되, 장난감 HUD처럼 만들지 않는다. 공기업 내부 도구이므로 과장된 네온 장식보다 근거, 검증, 안정감이 먼저 보여야 한다.

## 2. 참고한 디자인 문법

- `awesome-design-md/design-md/apple/DESIGN.md`: SF Pro 세미볼드 헤드라인(음수 자간), 단일 Action Blue, 크롬엔 그림자 없음(제품 아래 딱 하나의 시그니처 소프트 섀도), pill 버튼, UI가 물러나고 콘텐츠가 말하게 하는 여백.

각색 원칙: 직원 화면은 Spotlight/Siri처럼 "검색 한 줄 + 여백"으로 비우고, 관리자 화면도 같은 Apple 토큰을 쓰되 정보 밀도만 올린다(밀도≠다른 미감). 이전 시안(사이버 콘솔/HUD)은 `demo/jarvis-console.html`에 백업, 미채택.

## 3. 화면 분리 원칙

### 직원 화면: `demo/jarvis.html`

보이는 것:
- “Hello, JARVIS?” 한 줄.
- 업무 질문 검색창.
- 예시 질문.
- 답변, 근거 문서, 검증 상태, 다음 액션.

숨기는 것:
- 온톨로지, 파싱, 인제스트, 그래프, 데이터 구조화.
- “AI 모델이 무엇인지” 같은 기술 설명.
- 사용자가 데이터를 정리하고 있다는 느낌.

직원 카피 원칙:
- “물어보세요”보다 “바로 일할 수 있게 준비합니다”에 가깝게 쓴다.
- 근거가 없으면 “근거 없음”을 명확히 표시한다.
- 답변 뒤에는 항상 초안 작성, 사전점검, 브리핑, 예보 같은 업무 액션이 붙는다.

### 관리자 화면: `demo/admin.html`

보이는 것:
- 인제스트 파이프라인.
- 문서 파싱 및 업무 분류 상태.
- 온톨로지 관계 그래프.
- 질문, 초안, 점검 실행이 구조화 이벤트로 바뀌는 trace.
- 후보 → 작성자 확인 → 동료 확인 → 오너 승인 검증 단계.
- 민감정보 가드와 업무 표현 치환.

역할:
- 직원 채택 경험이 AX 전환으로 이어진다는 것을 심사위원에게 증명한다.
- 팀원 저장소(`creationy/jikmu-memory`)의 무LLM 결정론적 엔진, QA, 관계 그래프, 검증 상태를 UI 언어로 포장한다.

## 4. 토큰

라이트 (기본):
```css
canvas    #ffffff   parchment #f5f5f7   pearl   #fafafc
ink       #1d1d1f   ink-2     #424245   muted   #6e6e73   faint #86868b
hairline  #d2d2d7   divider   #eeeef0
accent    #0066cc   accent-hover #0071e3           /* Apple Action Blue, 단일 액센트 */
ok #248a3d/#e7f7ec  warn #9a6400/#fbf1dd  none #86868b/#f0f0f2
shadow    0 4px 24px rgba(0,0,0,.08)               /* 소프트 엘리베이션 딱 1종 */
radius    18(카드·검색) / 12(타일) / 8 / pill 9999
```

다크:
```css
canvas #000000  parchment #1c1c1e  pearl #161617
ink #f5f5f7  hairline #3a3a3c  divider #2a2a2c
accent #2997ff  accent-hover #0a84ff
shadow 0 6px 34px rgba(0,0,0,.55)
```

폰트: `SF Pro Display/Text`, `-apple-system`, `Apple SD Gothic Neo`, `Pretendard`, `Malgun Gothic`, `system-ui`.

타이포그래피:
- Hero: clamp(40~64px), weight 600, letter-spacing −.035em. **"Hello, JARVIS?"에만 입체**(그라데이션 글리프 + 1~2px 압출 에지 + 소프트 앰비언트 드롭섀도).
- 리드: 19~23px, weight 400, muted.
- 답변 질문: 25~32px / 600. 본문 17~18px / 1.5~1.6.
- 라벨/캡션: 12~13.5px, faint. 모노 폰트는 쓰지 않는다(콘솔 문법 제거).

## 5. 컴포넌트 규칙

- **검색창**: parchment 필 + 소프트 섀도, 포커스 시 canvas + hairline. **정적 글로우는 검색창에만**(블루-바이올렛 linear-gradient + blur, **회전 애니메이션 금지**). 결과 화면의 검색줄은 글로우 없이 담백하게.
- **강조는 굵기(600)로만** — 형광 하이라이트·밑줄·색 강조 금지. `mark`는 반드시 `background:none`.
- 카드/근거 리스트: pearl 배경 + 1px divider + radius 18, 행 구분은 divider. 그림자는 검색창·로고 타일에만.
- 버튼: pill. primary=accent 채움/화이트, secondary=텍스트만 accent(호버 시 pearl). 화살표 미세 이동만.
- 상태 배지: pill, 시맨틱 소프트 배경(검증됨 ok / 주의 warn / 근거 없음 none). "문제 없음" 판정 배지는 만들지 않는다.
- cite 칩: pearl pill(근거·신뢰도%), 본문 흐름 안에 인라인.
- 직원 화면의 정보량은 검색 전에는 최소화한다. 결과 화면에서는 답변 → 근거 → 다음 액션이 아래로 자연스럽게 이어진다.
- 관리자 화면은 밀도를 허용하되 같은 Apple 토큰을 쓰고, 모든 카드가 "AX 전환 증명"에 기여해야 한다. 모노 폰트·시안 네온·그리드 오버레이 등 콘솔 장식은 쓰지 않는다.
- 그래프는 장식이 아니라 업무·문서·협조처·반려사유의 관계를 보여주는 실제 설명 장치로만 사용한다.

## 6. 발표 동선

1. 오프닝 영상: “JARVIS를 부르는” 감각으로 몰입.
2. `jarvis.html`: 직원은 검색창에 업무 질문만 입력.
3. 검색 결과: 근거 있는 답변과 다음 액션을 확인.
4. 본편 데모: 브리핑, 예보, 초안, 사전점검으로 이동.
5. `admin.html`: 같은 행동이 뒤에서 어떻게 구조화·검증·축적되는지 공개.

핵심 메시지:

> 직원은 편해서 쓰고, 조직은 모르게 AX-ready 데이터가 쌓인다.
