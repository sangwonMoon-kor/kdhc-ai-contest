"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DOCUMENT_ID = "PROC-MAINT-31100";
const REQUIRED_MARKERS = [
  "# 가. 기본계획 수립",
  "### 4. 업무절차",
  "4.4 기본계획 수립",
  "4.4.3 기본계획의 내용",
  "4.4.4 기본계획의 작성",
  "4.5.2 작업항목 및 범위 결정시 고려사항",
  "4.5.3 시행 계획의 결정",
  "4.5.4 계획의 변경",
  "4.7 예산반영",
  "4.8 보고사항",
  "4.11 기술정산",
  "4.12 자료관리"
];
const FORBIDDEN_OUTPUT_PATTERNS = [
  { label: "마스킹 토큰", pattern: /\[[A-Z][A-Z0-9_]*_\d+\]/ },
  { label: "이미지 파일명", pattern: /image[_-]?\d+\.(?:png|jpe?g|gif|webp)/i },
  { label: "윈도우 사용자 경로", pattern: /[A-Za-z]:\\Users\\/i },
  { label: "원본 파일명", pattern: /sanitized\.md/i }
];

function normalizeNewlines(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function validateSource(markdown) {
  const source = normalizeNewlines(markdown);
  if (!source.trim()) throw new Error("입력 Markdown이 비어 있습니다.");
  const missing = REQUIRED_MARKERS.filter((marker) => !source.includes(marker));
  if (missing.length) throw new Error(`필수 구조가 없습니다: ${missing.join(", ")}`);
  return source;
}

function evidence(text) {
  return [{ docId: DOCUMENT_ID, label: "정기점검보수 기본계획 수립 절차", text: "" }];
}

function buildAskFixture() {
  return {
    question: "올해 정기점검보수 기본계획을 어떻게 수립해야 해?",
    intent: "procedure_guidance",
    cueType: null,
    answer: [
      "먼저 정기점검보수 대상과 제외 범위를 구분하고, 작업 항목·예상 공정·필요 예산을 기본계획에 정리합니다.",
      "범위를 정할 때는 과거 정비·점검 기록, 설비 상태와 장애 이력, 제작사 자료, 검사 정보를 함께 확인합니다.",
      "관련 부서와 일정·작업 조건을 협의한 뒤 종합 검토를 거쳐 시행 계획을 확정합니다.",
      "계획이 바뀌면 변경 사유와 영향 범위를 다시 검토하고 필요한 보고·예산 반영 절차를 밟습니다.",
      "작업 완료 후 결과 보고, 기술정산, 후속 활용을 위한 자료관리까지 마무리합니다."
    ],
    knowledge: [
      {
        rel: "is_controlled_by",
        fromName: "정기점검보수 기본계획",
        toName: "대상·제외 범위 구분",
        text: "정기점검보수 계획은 적용 대상과 제외 범위를 먼저 구분합니다.",
        status: "변환본 검토 필요",
        confidence: 0.9,
        evidence: evidence()
      },
      {
        rel: "requires_document",
        fromName: "작업 범위 결정",
        toName: "과거 기록과 설비 정보",
        text: "작업 범위는 과거 기록, 설비 상태, 장애 이력, 제작사 자료와 검사 정보를 함께 확인해 정합니다.",
        status: "변환본 검토 필요",
        confidence: 0.9,
        evidence: evidence()
      },
      {
        rel: "involves_actor",
        fromName: "시행 계획 확정",
        toName: "관련 부서",
        text: "일정과 작업 조건은 관련 부서 협의와 종합 검토를 거쳐 확정합니다.",
        status: "변환본 검토 필요",
        confidence: 0.88,
        evidence: evidence()
      },
      {
        rel: "produces_document",
        fromName: "정기점검보수 수행",
        toName: "보고·정산·관리 기록",
        text: "완료 후 결과 보고, 기술정산과 자료관리 기록을 남깁니다.",
        status: "변환본 검토 필요",
        confidence: 0.88,
        evidence: evidence()
      }
    ],
    docs: [{
      id: DOCUMENT_ID,
      title: "정기점검보수 기본계획 수립 절차",
      kind: "유지보수 절차",
      snippet: "대상과 범위 결정부터 협의, 변경, 보고, 기술정산, 자료관리까지의 구조화된 시연용 절차"
    }],
    forecast: [],
    entities: {
      stages: ["기본계획 수립", "시행 계획 결정", "결과 정리"],
      actors: ["계획 담당자", "관련 부서", "검토 책임자"],
      assets: ["정기점검보수 대상 설비"],
      risks: ["과거 이력 누락", "관련 부서 협의 누락", "변경 기록 누락"]
    },
    followups: [
      "작업 범위를 정할 때 확인할 자료를 체크리스트로 보여줘",
      "계획이 변경되면 무엇을 다시 확인해야 해?",
      "작업 완료 후 남겨야 할 기록을 알려줘"
    ],
    grounded: true,
    disclaimer: "보안 변환본의 대표 절을 최소 구조로 재구성한 로컬 시연 답변입니다. 실제 적용 전 담당자의 원문 대조와 승인이 필요합니다."
  };
}

function buildDocumentFixture() {
  const checklist = [
    "정기점검보수 대상과 제외 범위를 구분했는가",
    "작업 항목, 예상 공정, 필요 예산과 산출 근거를 정리했는가",
    "과거 정비·점검 기록과 설비 상태를 확인했는가",
    "장애 이력, 제작사 자료와 검사 정보를 확인했는가",
    "관련 부서와 일정·작업 조건을 협의했는가",
    "종합 검토 결과와 계획 변경 사유를 기록했는가",
    "결과 보고, 기술정산과 자료관리 방안을 정했는가"
  ];
  const text = [
    "정기점검보수 기본계획 수립 절차",
    "",
    "1. 적용 범위",
    "계획된 정기점검보수를 대상으로 하며, 일상적인 조치와 긴급 대응 업무는 별도로 구분합니다.",
    "",
    "2. 기본계획 구성",
    "작업 항목, 예상 공정, 필요 예산과 산출 근거를 한 묶음으로 정리합니다.",
    "",
    "3. 범위 결정 근거",
    "과거 정비·점검 기록, 설비 상태와 성능, 장애·예방 이력, 제작사 자료, 유사 사례와 검사 정보를 함께 확인합니다.",
    "",
    "4. 협의와 확정",
    "관련 부서와 일정 및 작업 조건을 협의하고, 종합 검토 결과를 바탕으로 시행 계획을 확정합니다.",
    "",
    "5. 변경과 마무리",
    "계획 변경 시 사유와 영향을 검토해 필요한 보고와 예산 절차를 수행합니다. 완료 후에는 결과 보고, 기술정산과 자료관리를 마칩니다.",
    "",
    "체크리스트",
    ...checklist.map((item) => `- ${item}`),
    "",
    "주의: 보안 변환본에서 시연에 필요한 절차만 재구성했습니다. 실제 업무 적용 전 담당자 검토가 필요합니다."
  ].join("\n");

  const relations = [
    ["requires_document", "과거 정비·점검 기록"],
    ["involves_actor", "관련 부서 협의"],
    ["is_controlled_by", "계획 변경 검토"],
    ["produces_document", "결과 보고와 기술정산"],
    ["produces_document", "유지보수 자료관리 기록"]
  ];

  return {
    doc: {
      id: DOCUMENT_ID,
      kind: "유지보수 절차",
      kindConfidence: 0.9,
      title: "정기점검보수 기본계획 수립 절차",
      stageId: "maintenance-planning",
      task: "기본계획 수립",
      taskScore: 9,
      author: "보안 변환본 기반 로컬 시연",
      fields: {
        title: "정기점검보수 기본계획 수립 절차",
        sections: [
          { h: "적용 범위", body: "정기점검보수 대상과 제외 범위를 구분합니다." },
          { h: "기본계획", body: "작업 항목, 예상 공정, 필요 예산과 산출 근거를 정리합니다." },
          { h: "검토·협의", body: "과거 이력과 설비 정보를 확인하고 관련 부서와 협의합니다." },
          { h: "사후 관리", body: "변경·보고·기술정산·자료관리 기록을 마무리합니다." }
        ],
        checklist
      },
      text,
      entities: {
        actors: ["계획 담당자", "관련 부서", "검토 책임자"],
        assets: ["정기점검보수 대상 설비"],
        docRefs: ["과거 정비·점검 기록", "제작사 자료", "검사 정보"],
        dates: [],
        amounts: []
      }
    },
    edges: relations.map(([rel, target], index) => ({
      key: `Procedure:${DOCUMENT_ID}|${rel}|Item:${index + 1}`,
      from: `Procedure:${DOCUMENT_ID}`,
      to: `Item:${target}`,
      rel,
      status: "변환본 검토 필요",
      confidence: 0.88,
      provenance: [{ docId: DOCUMENT_ID, label: "정기점검보수 기본계획 수립 절차", text: "" }]
    }))
  };
}

function assertSafeOutput(value) {
  const serialized = JSON.stringify(value);
  for (const { label, pattern } of FORBIDDEN_OUTPUT_PATTERNS) {
    if (pattern.test(serialized)) throw new Error(`생성 결과에 금지된 ${label}이(가) 남아 있습니다.`);
  }
}

function buildMaintenanceFixture(markdown, options = {}) {
  const source = String(markdown || "");
  validateSource(source);
  const generatedAt = options.generatedAt || new Date().toISOString();
  if (Number.isNaN(new Date(generatedAt).getTime())) throw new Error("generatedAt이 유효한 ISO 날짜가 아닙니다.");
  const sha256 = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  const document = buildDocumentFixture();
  const result = {
    manifest: {
      contractVersion: 1,
      localOnly: true,
      generatedAt,
      source: { sha256 },
      documents: [DOCUMENT_ID],
      documentIndex: [{
        id: document.doc.id,
        access: "full",
        kind: document.doc.kind,
        title: document.doc.title,
        task: document.doc.task,
        author: document.doc.author
      }]
    },
    ask: buildAskFixture(),
    document
  };
  assertSafeOutput(result);
  return result;
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMaintenanceFixture(inputPath, outputRoot, options = {}) {
  const source = fs.readFileSync(path.resolve(inputPath), "utf8");
  const built = buildMaintenanceFixture(source, options);
  const resolvedOutput = path.resolve(outputRoot);
  const parent = path.dirname(resolvedOutput);
  if (resolvedOutput === parent || path.parse(resolvedOutput).root === resolvedOutput) {
    throw new Error("출력 경로가 너무 넓습니다.");
  }

  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(resolvedOutput)}.tmp-`));
  try {
    writeJSON(path.join(staging, "manifest.json"), built.manifest);
    writeJSON(path.join(staging, "ask", "maintenance-plan.json"), built.ask);
    writeJSON(path.join(staging, "documents", `${DOCUMENT_ID}.json`), built.document);
    if (fs.existsSync(resolvedOutput)) fs.rmSync(resolvedOutput, { recursive: true, force: true });
    fs.renameSync(staging, resolvedOutput);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return { sha256: built.manifest.source.sha256, files: 3 };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input" || value === "--output") {
      if (!argv[index + 1]) throw new Error(`${value} 뒤에 경로가 필요합니다.`);
      args[value.slice(2)] = argv[index + 1];
      index += 1;
      continue;
    }
    if (value.startsWith("--input=")) args.input = value.slice("--input=".length);
    else if (value.startsWith("--output=")) args.output = value.slice("--output=".length);
    else throw new Error(`알 수 없는 옵션입니다: ${value}`);
  }
  return args;
}

function runCLI() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.input) throw new Error("사용법: node tools/build-local-maintenance-fixture.js --input <sanitized.md 경로> [--output <출력 폴더>]");
  const output = args.output || path.resolve(__dirname, "..", "product-ui", "fixtures", "local-maintenance");
  const result = writeMaintenanceFixture(args.input, output);
  process.stdout.write(`Local fixture generated (files: ${result.files}, sha256: ${result.sha256})\n`);
}

if (require.main === module) {
  try {
    runCLI();
  } catch (error) {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_MARKERS,
  buildMaintenanceFixture,
  writeMaintenanceFixture
};
