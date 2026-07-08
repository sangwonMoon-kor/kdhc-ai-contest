---
name: HelloJARVIS-design
base: IBM Carbon Design System (adapted)
description: "IBM Carbon의 엔터프라이즈 엄격함 — 플랫 0-radius 스퀘어, 화이트/차콜, 얇은 헤어라인 타일, 그림자 없음, 라이트 웨이트 대형 디스플레이, 8px 그리드, 시맨틱 상태색 — 을 차용하되 단일 액센트만 KDHC 웜(#e8590c)으로 각색한 공공·엔터프라이즈 신뢰형 시스템. 코딩 에이전트는 이 토큰·원칙대로 UI를 생성/정렬한다."
---

## 원칙 (Carbon rigor + 웜 액센트)
- **플랫**: 모서리 `0`(버튼·입력·타일·카드). 필요 시 2px까지만. pill은 상태 칩에만.
- **표면**: 화이트 캔버스 + 차콜 잉크. 구획은 **얇은 헤어라인**과 subtle gray로. **그림자 지양** — 호버 시 그림자 대신 경계(액센트)로 반응.
- **타이포**: 대형 디스플레이는 **라이트(300)**, 본문 400, 강조 600. 한글은 가독성 위해 300 대신 500 사용. 라벨/eyebrow는 소문자 + letter-spacing.
- **색**: 뉴트럴은 순회색이 아니라 **웜 바이어스** 그레이. **단일 액센트(웜 오렌지) 하나만**. 시맨틱(성공/경고/위험)은 액센트와 별개 축.
- **정보 우선**: 대시보드·상태는 pill·chip·stripe로 한눈에. 근거·검증상태는 항상 노출.
- **8px 그리드**: 4/8/12/16/24/32/48/96.

## 토큰 — 색
```
canvas #ffffff · surface-1 #f5f3f0 · surface-2 #e8e4dd
ink #17181a · ink-muted #565961 · ink-subtle #8a8d94
hairline #e3dfd7 · hairline-strong #c9c3b8
accent #e8590c · accent-deep #b8470a · accent-soft #fbeee4 · accent-line #f2c8a9
ok #198038 · ok-soft #e6f3ea · warn #8a6d00 · warn-soft #f7f0dc · danger #da1e28 · danger-soft #fbeaea
```
Dark: `canvas #161719 · surface-1 #1e2023 · surface-2 #262a2e · ink #f2f1ee · ink-muted #a0a3ab · ink-subtle #71747c · hairline #2c2f34 · hairline-strong #3c4046 · accent #f2792f`

## 토큰 — 타이포 (system sans: Pretendard / Apple SD Gothic Neo / system-ui)
```
display  clamp(34,4.8vw,54) / 300 / -.03em    (영문 대형 라이트가 Carbon 시그니처)
headline 28-32 / 500 / -.02em
title    21-24 / 600
subhead  18 / 600
body     15.5 / 400 / line-height 1.55
body-sm  14 / 400
label    12.5 / 600 / +.08em  (eyebrow·section 라벨; 영문은 uppercase)
caption  12 / 400 / +.02em
```

## 토큰 — radius / spacing
```
radius: 0 (기본) · 2 (입력·타일 미세 소프트) · 999 (상태 pill만)
spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 96
```

## 컴포넌트
- **button-primary**: accent bg / white / radius 0 / padding 13×20 / hover→accent-deep
- **button-ghost**: canvas bg / 1px hairline-strong / radius 0 / hover→border accent + accent-soft
- **input**: surface-1 fill / 1px hairline / radius 0 / focus = 하단 2px 액센트 + border accent (Carbon 필드 규칙)
- **tile / card**: canvas / 1px hairline / radius 0 / **no shadow** / hover→border accent
- **status badge**: {ok|warn|danger}-soft bg + 1px 동색 경계 + 텍스트 동색 / radius 0(또는 2)
- **cite chip**: accent-soft bg / 1px accent-line / 근거문서 + 검증상태·신뢰도% / radius 2
- **label(eyebrow)**: 12.5 / 600 / +.08em / ink-subtle

## 적용 대상
`demo/`(발표 데모), 서비스 UI, Hello JARVIS 검색 목업. 실제 화면 검증 시 lazyweb 레퍼런스 병행.
출처: awesome-design-md(github.com/VoltAgent/awesome-design-md)의 IBM Carbon 파일 각색. (참조: [[reference-design-mcps]])
