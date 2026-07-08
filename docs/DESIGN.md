---
name: HelloJARVIS-design
base: awesome-design-md inspired system
description: "xAI/SpaceX의 블랙 미니멀 첫 화면과 VoltAgent의 기술 콘솔 문법을 섞어, 직원에게는 검색 한 줄만 보이고 관리자에게는 인제스트·온톨로지·검증 상태가 보이는 사내 AI 경진대회용 디자인 시스템."
---

# Hello JARVIS Design System

## 1. 디자인 의도

Hello JARVIS의 첫 화면은 “새로운 업무 시스템”처럼 보이면 안 된다. 직원은 업무를 추가로 배운다고 느끼지 않고, 구글 첫 화면처럼 질문 하나만 입력하면 된다. 기술적인 인제스트, 파싱, 온톨로지, 검증 상태는 직원 화면에서 숨기고, 관리자 콘솔에서만 드러낸다.

발표 연출은 아이언맨의 JARVIS 호출 감각을 차용하되, 장난감 HUD처럼 만들지 않는다. 공기업 내부 도구이므로 과장된 네온 장식보다 근거, 검증, 안정감이 먼저 보여야 한다.

## 2. 참고한 디자인 문법

- `awesome-design-md/design-md/x.ai`: near-black canvas, 얇은 hairline, 흰색/단색 중심, 그림자 최소화.
- `awesome-design-md/design-md/spacex`: 첫 화면의 cinematic black, 큰 문장, 불필요한 설명을 줄이는 hero 구성.
- `awesome-design-md/design-md/voltagent`: electric green accent, technical console, code/editor-like 정보 밀도.

이 셋을 섞되, 직원 화면은 xAI/SpaceX 쪽으로 비우고, 관리자 화면은 VoltAgent 쪽으로 밀도를 올린다.

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

```css
canvas       #070808
surface      #101214
surface-2    #171a1d
surface-3    #20262b
ink          #f5f8f8
ink-soft     #c6d0d4
muted        #7f8c93
line         #263038
line-strong  #3a4b54
cyan         #00e5ff
green        #00d992
amber        #ffb545
red          #ff5a66
radius       8px
```

폰트:
- 기본: `Inter`, `Pretendard`, `Apple SD Gothic Neo`, `Malgun Gothic`, `system-ui`.
- 기술 라벨: `SFMono-Regular`, `Cascadia Mono`, `JetBrains Mono`, `Consolas`, `monospace`.

타이포그래피:
- Hero: 46-64px, weight 400-420, letter-spacing 0.
- Section title: 16-18px, weight 650.
- Body: 15-17px, line-height 1.55-1.78.
- Mono label: 11-12px, uppercase 가능.

## 5. 컴포넌트 규칙

- 카드는 그림자 없이 1px hairline border로만 구획한다.
- 둥근 pill은 검색창, 상태 배지, 작은 시스템 라벨에만 쓴다.
- 직원 화면의 정보량은 검색 전에는 최소화한다.
- 결과 화면에서는 답변보다 근거와 다음 액션이 아래로 자연스럽게 이어져야 한다.
- 관리자 화면은 밀도를 허용하되, 모든 카드가 “AX 전환 증명”에 기여해야 한다.
- 장식용 gradient orb, bokeh, 과한 HUD 원형 장식은 쓰지 않는다.
- 그래프는 장식이 아니라 업무·문서·협조처·반려사유의 관계를 보여주는 실제 설명 장치로만 사용한다.

## 6. 발표 동선

1. 오프닝 영상: “JARVIS를 부르는” 감각으로 몰입.
2. `jarvis.html`: 직원은 검색창에 업무 질문만 입력.
3. 검색 결과: 근거 있는 답변과 다음 액션을 확인.
4. 본편 데모: 브리핑, 예보, 초안, 사전점검으로 이동.
5. `admin.html`: 같은 행동이 뒤에서 어떻게 구조화·검증·축적되는지 공개.

핵심 메시지:

> 직원은 편해서 쓰고, 조직은 모르게 AX-ready 데이터가 쌓인다.
