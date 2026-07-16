const path = require('path');
const { chromium } = require('playwright');

const appUrl = `file:///${path.resolve(__dirname, '..', 'app.html').replace(/\\/g, '/')}#home`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const executablePath = process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const baseUrl = appUrl.replace(/#.*$/, '');
  const introPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  introPage.setDefaultTimeout(7000);
  await introPage.goto(baseUrl);
  await introPage.click('#openSkip');
  await introPage.waitForTimeout(120);
  const earlyIntro = await introPage.evaluate(() => ({
    title: document.getElementById('heroTitle').textContent.replace(/\s+/g, ' ').trim(),
    promiseVisible: document.getElementById('heroPromise').classList.contains('in'),
  }));
  assert(earlyIntro.title !== 'Hello, JARVIS?' && !earlyIntro.promiseVisible, 'opening skip bypassed the original typing intro');
  await introPage.waitForFunction(() => document.getElementById('heroSearch').classList.contains('in'));
  await introPage.close();

  await page.goto(`${baseUrl}#home`);
  await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await page.reload();

  await page.goto(`${baseUrl}#workbench/pump-2026`);
  await page.waitForSelector('#view-workbench.active');
  await page.evaluate(() => {
    const work = getWork('pump-2026');
    work.notes.unshift({ id: 'persist-check', tag: '메모', time: '방금', text: '새로고침 유지 확인' });
    saveState();
  });
  await page.reload();
  assert((await page.textContent('#activityList')).includes('새로고침 유지 확인'), 'notes did not persist');

  await page.goto(`${baseUrl}#draft/missing-work`);
  await page.waitForSelector('#view-notfound.active');
  assert((await page.textContent('#notFoundTitle')).includes('업무를 찾을 수 없습니다'), 'invalid deep link silently selected a sample work');

  await page.evaluate(() => localStorage.setItem('jm-workbench-v1', '{broken json'));
  await page.reload();
  await page.goto(`${baseUrl}#work/list`);
  await page.waitForSelector('#view-work.active');
  assert(await page.locator('[data-work-id="pump-2026"]').count() === 1, 'corrupt storage did not recover the immutable seed');

  await page.evaluate(() => localStorage.setItem('jm-workbench-v1', JSON.stringify({
    version: 1,
    works: [{
      id: 'damaged-work', title: '필수 필드가 빠진 업무', due: null,
      todos: [], sources: [], notes: [],
      deliverable: { title: '손상 데이터', items: [] },
      draft: { background: '', details: [], table: [], checks: [] },
    }],
  })));
  await page.reload();
  await page.waitForSelector('#view-work.active');
  assert(await page.locator('[data-work-id="pump-2026"]').count() === 1, 'structurally corrupt storage did not recover the immutable seed');

  await page.goto(`${baseUrl}#work/calendar`);
  await page.reload();
  await page.waitForSelector('#view-work.active');
  assert(await page.isVisible('#workCalendar'), 'calendar hash mode did not survive reload');

  const progressContract = await page.evaluate(() => {
    const fixture = { todos: [
      { text: '완료', done: true },
      { text: '다음', done: false, next: true },
      { text: '후보', done: false, candidate: true },
    ] };
    const progress = getProgress(fixture);
    const first = syncNextAction(fixture);
    first.done = true;
    const next = syncNextAction(fixture);
    return {
      progress,
      first: first.text,
      next,
      nextFlags: fixture.todos.map((todo) => Boolean(todo.next)),
      seedFrozen: Object.isFrozen(WORK_SEED) && Object.isFrozen(WORK_SEED[0]),
      selectedId: getSelectedWork().id,
    };
  });
  assert(progressContract.progress.done === 1 && progressContract.progress.total === 2 && progressContract.progress.percent === 50, 'candidate todo changed calculated progress');
  assert(progressContract.first === '다음' && progressContract.next === null, 'next action was not calculated from confirmed incomplete todos');
  assert(progressContract.nextFlags.every((flag) => !flag), 'completed or candidate todo remained marked as next');
  assert(progressContract.seedFrozen, 'work seed is mutable');
  assert(progressContract.selectedId === 'pump-2026', 'selected work did not recover with the seed');

  const sourceIconPayload = '<img src=x onerror="window.__sourceIconXss=1">';
  const sourceTypePayload = "');window.__sourceActionXss=1;//";
  await page.goto(`${baseUrl}#workbench/pump-2026`);
  await page.waitForSelector('#view-workbench.active');
  await page.evaluate(({ icon, type }) => {
    const saved = JSON.parse(localStorage.getItem('jm-workbench-v1'));
    saved.works[0].sources[0].icon = icon;
    saved.works[0].sources[0].type = type;
    localStorage.setItem('jm-workbench-v1', JSON.stringify(saved));
  }, { icon: sourceIconPayload, type: sourceTypePayload });
  await page.reload();
  await page.waitForSelector('#view-workbench.active');
  assert((await page.textContent('.file-icon')).includes(sourceIconPayload), 'stored source icon was not rendered literally');
  assert(!(await page.evaluate(() => window.__sourceIconXss)), 'stored source icon executed as HTML');
  await page.click('.source-open');
  assert(!(await page.evaluate(() => window.__sourceActionXss)), 'stored source action executed from its handler argument');
  await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await page.reload();

  await page.goto(`${baseUrl}#home`);
  await page.fill('#homeInput', '팀장님이 신규 설비 홍보행사 준비하라고 했어');
  await page.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await page.waitForSelector('#view-clarify.active');
  await page.click('.clarify-create');
  await page.waitForSelector('#view-workbench.active');
  const undatedWorkId = await page.evaluate(() => getSelectedWork().id);
  assert(await page.evaluate(() => getSelectedWork().due === null), 'unknown deadline was replaced with a fake calendar date');
  await page.reload();
  assert(await page.evaluate((id) => getWork(id).due === null, undatedWorkId), 'unknown deadline did not persist as null');
  await page.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await page.goto(`${baseUrl}#work/list`);
  await page.reload();
  await page.waitForSelector('#view-work.active');

  for (const emptyIdHash of ['#workbench', '#workbench/', '#draft', '#draft/']) {
    await page.goto(`${baseUrl}#work/list`);
    await page.waitForSelector('#view-work.active');
    await page.goto(`${baseUrl}${emptyIdHash}`);
    await page.waitForSelector('#view-notfound.active');
    assert(new URL(page.url()).hash === emptyIdHash, `${emptyIdHash} did not preserve the requested hash`);
  }

  if (process.env.WORKBENCH_E2E_SCOPE === 'task2') {
    assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
    await browser.close();
    console.log('Work-item workbench state and router flow passed.');
    return;
  }

  await page.goto(appUrl.replace('#home', '#home'));
  await page.waitForSelector('#view-home.active');
  assert(await page.isVisible('#heroSearch'), 'original centered home search is missing');
  assert(await page.isVisible('#homeUrgentObject'), 'original urgent sticky object was removed');
  assert(await page.isVisible('#homeForecastObject'), 'original forecast object was removed');
  assert(await page.isVisible('#homeMemoObject'), 'original memo object was removed');
  assert(await page.isVisible('#homeEvidenceObject'), 'original evidence object was removed');
  assert(await page.isVisible('#openMyWork'), 'home has no explicit My Work entry');
  const heroCopy = await page.textContent('#view-home');
  assert(heroCopy.includes('Hello,') && heroCopy.includes('JARVIS?'), 'original JARVIS greeting was replaced');
  assert(heroCopy.includes('일한 만큼, 준비됩니다.'), 'original home promise was replaced');

  const homeObjectContract = await page.evaluate(() => {
    const priority = findPriorityWork();
    const previousLastVisited = appState.lastVisitedWorkId;
    appState.lastVisitedWorkId = 'audit-2026';
    const lastVisited = getHomeSelectedWork();
    appState.lastVisitedWorkId = 'missing-work';
    const fallback = getHomeSelectedWork();
    appState.lastVisitedWorkId = previousLastVisited;
    renderHomeObjects();
    return {
      priorityId: priority && priority.id,
      lastVisitedId: lastVisited && lastVisited.id,
      fallbackId: fallback && fallback.id,
      urgentWorkId: document.getElementById('homeUrgentObject').dataset.homeWorkId,
    };
  });
  assert(homeObjectContract.priorityId === 'pump-2026', 'home priority work is not the earliest active dated work');
  assert(homeObjectContract.lastVisitedId === 'audit-2026', 'home did not prefer the last valid visited work');
  assert(homeObjectContract.fallbackId === 'pump-2026', 'home did not fall back from an invalid last visited work');
  assert(homeObjectContract.urgentWorkId === 'pump-2026', 'urgent home object is not bound to app state');

  await page.click('#openMyWork');
  await page.waitForSelector('#view-work.active');
  assert(page.url().endsWith('#work/list'), 'My Work entry did not open list mode');
  assert(await page.locator('[data-work-id="pump-2026"]').count() === 1, 'work list does not render work items');
  const workShellWidth = await page.locator('#view-work > .shell').evaluate((node) => node.getBoundingClientRect().width);
  assert(workShellWidth <= 900, `My Work widened beyond the original product width (${workShellWidth}px)`);
  await page.click('[data-work-id="pump-2026"]');
  await page.waitForSelector('#view-workbench.active');
  assert(page.url().endsWith('#workbench/pump-2026'), 'work list item did not open its workbench route');
  await page.click('#navWork');
  await page.waitForSelector('#view-work.active');
  await page.click('#workModeCalendar');
  assert(page.url().endsWith('#work/calendar'), 'calendar mode is not deep linked');
  assert(await page.isHidden('#workList'), 'calendar mode left the work list visible');
  assert(await page.locator('[data-calendar-work="pump-2026"]').count() === 1, 'calendar does not render work items');
  await page.click('[data-calendar-work="pump-2026"]');
  await page.waitForSelector('#view-workbench.active');
  assert(page.url().endsWith('#workbench/pump-2026'), 'calendar work item did not open its workbench route');
  await page.goto(`${baseUrl}#home`);
  await page.waitForSelector('#view-home.active');

  await page.fill('#homeInput', '팀장님이 다음 주까지 순환수 펌프 정비공사 계획 올리래');
  await page.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await page.waitForSelector('#view-workbench.active');
  const connectionFeedback = await page.textContent('#workFeedback');
  assert(connectionFeedback.includes('순환수 펌프 정비공사'), 'home input did not name the connected work');
  assert(connectionFeedback.includes('할 일') && connectionFeedback.includes('자료'), 'connection feedback did not summarize prepared work and evidence');
  assert(await page.isVisible('#relinkButton'), 'home connection cannot be corrected to another work');
  assert(await page.isVisible('#nextActionPanel'), 'next action is not visible in the workbench');
  assert(await page.isVisible('#evidencePanel'), 'evidence is not visible beside the work');
  assert((await page.textContent('#factProgress')).includes('/'), 'progress does not expose completed checklist count');
  assert(await page.isVisible('.todo-source'), 'next actions do not expose their linked evidence');
  await page.locator('.todo-source').first().click();
  assert(await page.isVisible('.source-item.focused'), 'linked evidence was not highlighted from the action');
  assert(await page.locator('.source-item.focused').evaluate((item) => document.activeElement === item), 'linked evidence did not receive focus for assistive technology');
  assert((await page.textContent('#sourceLinkStatus')).includes('근거 자료'), 'linked evidence focus was not announced in a live region');
  const sourceButtonLabel = await page.locator('.source-item.focused .source-open').getAttribute('aria-label');
  assert(sourceButtonLabel && sourceButtonLabel.includes('원문'), 'source action does not have a specific accessible name');
  const todoAriaLabel = await page.locator('.todo-check').first().getAttribute('aria-label');
  assert(todoAriaLabel.includes('최근 진동 측정값 확인'), 'todo checkbox does not identify its action to assistive technology');
  const sourceTextIsSeparated = await page.locator('.source-item').first().evaluate((item) => {
    const name = item.querySelector('.source-name');
    const meta = item.querySelector('.source-meta');
    return getComputedStyle(name).display === 'block' && getComputedStyle(meta).display === 'block';
  });
  assert(sourceTextIsSeparated, 'source title and metadata run together instead of using separate lines');

  const nextActionBefore = await page.textContent('#nextAction');
  await page.click('.todo-item.next .todo-check');
  const nextActionAfter = await page.textContent('#nextAction');
  assert(nextActionAfter !== nextActionBefore, 'completing the current action did not advance the next action');
  assert((await page.locator('.todo-item.next').count()) === 1, 'workbench did not mark exactly one next incomplete action');
  await page.click('#undoButton');
  assert((await page.textContent('#nextAction')) === nextActionBefore, 'undo did not restore the previous next action');

  await page.click('#navWork');
  await page.waitForSelector('#view-work.active');
  const workRowTextIsSeparated = await page.locator('.work-row').first().evaluate((row) => {
    const title = row.querySelector('.work-name');
    const instruction = row.querySelector('.work-instruction');
    const due = row.querySelector('.date-block b');
    return getComputedStyle(title).display === 'block' &&
      getComputedStyle(instruction).display === 'block' &&
      getComputedStyle(due).whiteSpace === 'nowrap';
  });
  assert(workRowTextIsSeparated, 'work title, instruction, or due date collapses into neighboring text');
  await page.click('#workModeCalendar');
  assert(await page.isVisible('#workCalendar'), 'calendar mode did not open');
  await page.click('[data-calendar-work="pump-2026"]');
  await page.waitForSelector('#view-workbench.active');

  const activityBefore = await page.locator('#activityList .activity-item').count();
  await page.fill('#contextInput', '운영부 정지 가능 기간은 5월 둘째 주로 확정');
  await page.locator('#contextForm').evaluate((form) => form.requestSubmit());
  assert((await page.textContent('#workFeedback')).includes('추가했어요'), 'context feedback did not describe the change');
  const activityAfter = await page.locator('#activityList .activity-item').count();
  assert(activityAfter === activityBefore + 1, 'context memo did not stay in the selected work');

  await page.click('#undoButton');
  const activityUndone = await page.locator('#activityList .activity-item').count();
  assert(activityUndone === activityBefore, 'undo did not restore the work activity');

  await page.click('#draftStart');
  await page.waitForSelector('#view-draft.active');
  assert((await page.textContent('#draftWorkTitle')).includes('순환수 펌프'), 'draft lost the selected work title');
  await page.click('#draftBack');
  await page.waitForSelector('#view-workbench.active');

  const ambiguous = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  ambiguous.setDefaultTimeout(5000);
  await ambiguous.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  const ambiguousNotesBefore = await ambiguous.locator('#activityList .activity-item').count();
  await ambiguous.fill('#contextInput', '펌프 최신값');
  await ambiguous.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await ambiguous.waitForSelector('#view-clarify.active');
  assert(await ambiguous.isVisible('[data-intent="question"]'), 'ambiguous input cannot be confirmed as a question');
  assert(await ambiguous.isVisible('[data-intent="note"]'), 'ambiguous input cannot be confirmed as a note');
  await ambiguous.click('[data-intent="note"]');
  await ambiguous.waitForSelector('#view-workbench.active');
  assert(await ambiguous.locator('#activityList .activity-item').count() === ambiguousNotesBefore + 1, 'confirmed note was not added to the selected work');

  const question = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  question.setDefaultTimeout(5000);
  await question.goto(appUrl);
  await question.fill('#homeInput', '펌프 기안 자료 찾아줘');
  await question.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await question.waitForSelector('#view-workbench.active');
  assert(await question.isVisible('#workAnswer'), 'a request to find draft evidence was misrouted away from the answer');

  const mixedQuestion = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  mixedQuestion.setDefaultTimeout(5000);
  await mixedQuestion.goto(appUrl);
  await mixedQuestion.fill('#homeInput', '이번 주 펌프 기안 자료 찾아줘');
  await mixedQuestion.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await mixedQuestion.waitForSelector('#view-workbench.active');
  assert(await mixedQuestion.isVisible('#workAnswer'), 'a targeted question containing a weekly phrase was misrouted to the work overview');

  const draftHome = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  draftHome.setDefaultTimeout(5000);
  await draftHome.goto(appUrl);
  await draftHome.fill('#homeInput', '펌프 추진 보고 기안 작성해줘');
  await draftHome.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await draftHome.waitForSelector('#view-draft.active');
  assert(draftHome.url().endsWith('#draft/pump-2026'), 'clear home draft request did not preserve the target work in the draft URL');
  assert((await draftHome.textContent('#draftWorkTitle')).includes('순환수 펌프'), 'clear home draft request opened the wrong work context');

  const newWork = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  newWork.setDefaultTimeout(5000);
  await newWork.goto(appUrl);
  await newWork.fill('#homeInput', '팀장님이 신규 설비 홍보행사 준비하라고 했어');
  await newWork.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await newWork.waitForSelector('#view-clarify.active');
  await newWork.click('.clarify-create');
  await newWork.waitForSelector('#view-workbench.active');
  assert(await newWork.evaluate(() => getSelectedWork().due === null), 'unknown deadline was replaced with a fake calendar date');
  assert(await newWork.textContent('#summaryActive') === '4', 'new work creation did not update the My Work summary');
  assert(await newWork.isVisible('#undoButton'), 'new work creation cannot be undone');
  await newWork.click('#undoButton');
  await newWork.waitForSelector('#view-home.active');
  assert(await newWork.textContent('#summaryActive') === '3', 'undoing new work creation did not restore the My Work summary');

  const newWorkRelink = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  newWorkRelink.setDefaultTimeout(5000);
  await newWorkRelink.goto(appUrl);
  await newWorkRelink.fill('#homeInput', '팀장님이 신규 설비 홍보행사 준비하라고 했어');
  await newWorkRelink.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await newWorkRelink.waitForSelector('#view-clarify.active');
  await newWorkRelink.click('.clarify-create');
  await newWorkRelink.waitForSelector('#view-workbench.active');
  const temporaryWork = await newWorkRelink.evaluate(() => ({ id: getSelectedWork().id, title: getSelectedWork().shortTitle }));
  await newWorkRelink.click('#relinkButton');
  await newWorkRelink.waitForSelector('#view-clarify.active');
  assert(!(await newWorkRelink.textContent('#clarifyCandidates')).includes(temporaryWork.title), 'relink candidates include the temporary work being replaced');
  await newWorkRelink.evaluate((id) => chooseClarifyWork(id), temporaryWork.id);
  await newWorkRelink.waitForSelector('#view-workbench.active');
  assert(await newWorkRelink.evaluate((id) => getSelectedWork().id === id && WORK_ITEMS.some((work) => work.id === id), temporaryWork.id), 'choosing the same temporary relink target deleted it or corrupted selection');

  const auditDraft = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  auditDraft.setDefaultTimeout(5000);
  await auditDraft.goto(appUrl.replace('#home', '#workbench/audit-2026'));
  await auditDraft.click('#draftStart');
  await auditDraft.waitForSelector('#view-draft.active');
  assert((await auditDraft.textContent('#draftBackground')).includes('감사'), 'audit work opened pump-specific draft content');
  assert(auditDraft.url().endsWith('#draft/audit-2026'), 'draft URL lost the selected work id');
  await auditDraft.fill('#draftIntent', '운영부 미회신 항목을 반영');
  await auditDraft.click('#draftSave');
  await auditDraft.click('#draftBack');
  await auditDraft.click('#draftStart');
  assert(await auditDraft.inputValue('#draftIntent') === '운영부 미회신 항목을 반영', 'draft edits were lost after returning to the workbench');

  const historyFlow = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  historyFlow.setDefaultTimeout(5000);
  await historyFlow.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  await historyFlow.click('#draftStart');
  await historyFlow.waitForSelector('#view-draft.active');
  await historyFlow.goBack();
  await historyFlow.waitForSelector('#view-workbench.active');
  assert(historyFlow.url().endsWith('#workbench/pump-2026'), 'browser Back did not restore the selected workbench from draft');

  const safeText = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  safeText.setDefaultTimeout(5000);
  const xssPayload = '<img src=x onerror="window.__workbenchXss=1"> 메모';
  await safeText.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  await safeText.fill('#contextInput', xssPayload);
  await safeText.locator('#contextForm').evaluate((form) => form.requestSubmit());
  if (await safeText.isVisible('#view-clarify.active')) {
    await safeText.click('[data-intent="note"]');
  }
  await safeText.waitForSelector('#view-workbench.active');
  assert((await safeText.textContent('#activityList')).includes(xssPayload), 'user text was not rendered literally');
  assert(!(await safeText.evaluate(() => window.__workbenchXss)), 'user text executed as HTML before reload');
  await safeText.reload();
  await safeText.waitForSelector('#view-workbench.active');
  assert((await safeText.textContent('#activityList')).includes(xssPayload), 'persisted user text was not rendered literally after reload');
  assert(!(await safeText.evaluate(() => window.__workbenchXss)), 'persisted user text executed as HTML after reload');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.setDefaultTimeout(5000);
  await mobile.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  await mobile.waitForSelector('#view-workbench.active');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `mobile layout overflows horizontally by ${overflow}px`);
  assert(await mobile.isVisible('.sample-badge'), 'mobile hides the sample-data disclosure');
  const nextActionTop = await mobile.locator('#nextActionPanel').evaluate((node) => node.getBoundingClientRect().top);
  assert(nextActionTop < 650, `mobile pushes the next action below the first screen (${nextActionTop}px)`);
  await mobile.goto(appUrl);
  const homeOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(homeOverflow <= 1, `mobile home overflows horizontally by ${homeOverflow}px`);

  assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
  await browser.close();
  console.log('Work-item workbench browser flow passed.');
})().catch((error) => {
  console.error(`Work-item workbench browser flow failed: ${error.message}`);
  process.exit(1);
});
