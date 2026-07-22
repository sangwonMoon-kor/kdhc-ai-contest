"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  REQUIRED_MARKERS,
  buildMaintenanceFixture,
  writeMaintenanceFixture
} = require("../build-local-maintenance-fixture.js");

const syntheticSource = `# 테스트기관 유지보수 절차

[ORG_001]
image_001.png

# 가. 기본계획 수립

### 4. 업무절차

#### 4.4 기본계획 수립

##### 4.4.3 기본계획의 내용

작업항목, 예상 공정 및 예산을 검토한다.

##### 4.4.4 기본계획의 작성

관련 부서와 협의하여 기본계획을 작성한다.

##### 4.5.2 작업항목 및 범위 결정시 고려사항

과거 기록, 설비 상태, 장애 이력, 제작사 자료 및 검사 정보를 확인한다.

##### 4.5.3 시행 계획의 결정

종합 검토를 거쳐 시행 계획을 결정한다.

##### 4.5.4 계획의 변경

계획 변경 시 검토와 보고를 수행한다.

##### 4.7 예산반영

필요 예산과 산출 근거를 반영한다.

##### 4.8 보고사항

계획과 결과를 보고한다.

##### 4.11 기술정산

완료 후 기술정산을 수행한다.

##### 4.12 자료관리

기록과 결과 자료를 관리한다.
`;

function assertAskContract(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.equal(value.grounded, true);
  assert(Array.isArray(value.answer) && value.answer.length >= 4);
  assert(Array.isArray(value.knowledge) && value.knowledge.length >= 4);
  assert(Array.isArray(value.docs) && value.docs.length === 1);
  assert.equal(value.docs[0].id, "PROC-MAINT-31100");
}

function assertDocumentContract(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.equal(value.doc.id, "PROC-MAINT-31100");
  assert(Array.isArray(value.edges) && value.edges.length >= 4);
  assert(value.doc.text.includes("체크리스트"));
}

(() => {
  assert(Array.isArray(REQUIRED_MARKERS) && REQUIRED_MARKERS.length >= 10);

  const generatedAt = "2026-07-22T00:00:00.000Z";
  const built = buildMaintenanceFixture(syntheticSource, { generatedAt });
  assertAskContract(built.ask);
  assertDocumentContract(built.document);
  assert.equal(built.manifest.contractVersion, 1);
  assert.equal(built.manifest.localOnly, true);
  assert.equal(built.manifest.generatedAt, generatedAt);
  assert.equal(
    built.manifest.source.sha256,
    crypto.createHash("sha256").update(syntheticSource, "utf8").digest("hex")
  );
  assert.deepEqual(Object.keys(built.manifest.source), ["sha256"]);

  const serialized = JSON.stringify(built);
  for (const forbidden of ["테스트기관", "[ORG_001]", "image_001.png", "C:\\Users", "sanitized.md"]) {
    assert(!serialized.includes(forbidden), `generated fixture leaked forbidden source text: ${forbidden}`);
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maintenance-fixture-test-"));
  try {
    const inputPath = path.join(temporaryRoot, "source.md");
    const outputPath = path.join(temporaryRoot, "fixtures", "local-maintenance");
    fs.writeFileSync(inputPath, syntheticSource, "utf8");

    const result = writeMaintenanceFixture(inputPath, outputPath, { generatedAt });
    assert.equal(result.sha256, built.manifest.source.sha256);
    assert(!JSON.stringify(result).includes(inputPath), "builder result leaked the source path");

    const manifestPath = path.join(outputPath, "manifest.json");
    const askPath = path.join(outputPath, "ask", "maintenance-plan.json");
    const documentPath = path.join(outputPath, "documents", "PROC-MAINT-31100.json");
    for (const file of [manifestPath, askPath, documentPath]) assert(fs.existsSync(file), `missing ${file}`);

    const diskManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const diskAsk = JSON.parse(fs.readFileSync(askPath, "utf8"));
    const diskDocument = JSON.parse(fs.readFileSync(documentPath, "utf8"));
    assert.deepEqual(diskManifest, built.manifest);
    assertAskContract(diskAsk);
    assertDocumentContract(diskDocument);

    const missingMarkerSource = syntheticSource.replace("##### 4.12 자료관리", "##### 자료 보관");
    const invalidInput = path.join(temporaryRoot, "invalid.md");
    const invalidOutput = path.join(temporaryRoot, "invalid-output");
    fs.writeFileSync(invalidInput, missingMarkerSource, "utf8");
    assert.throws(
      () => writeMaintenanceFixture(invalidInput, invalidOutput, { generatedAt }),
      /필수 구조가 없습니다.*4\.12 자료관리/
    );
    assert(!fs.existsSync(invalidOutput), "invalid source left a partial output directory");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log("Local maintenance fixture builder contract passed");
})();
