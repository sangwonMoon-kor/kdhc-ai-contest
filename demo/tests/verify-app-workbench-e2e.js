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
  const openingA11y = await introPage.evaluate(() => {
    const appNodes = [document.querySelector('.topbar'), ...document.querySelectorAll('main')];
    const staged = ['heroSearch', 'openMyWork', 'homeExamples'].map((id) => document.getElementById(id));
    return {
      activeId: document.activeElement && document.activeElement.id,
      inputHasFocus: document.activeElement === document.getElementById('homeInput'),
      appIsHiddenAndInert: appNodes.every((node) => node.inert && node.getAttribute('aria-hidden') === 'true'),
      stagedIsHiddenAndInert: staged.every((node) => node.inert && node.getAttribute('aria-hidden') === 'true'),
    };
  });
  assert(openingA11y.activeId === 'openSkip', 'opening skip does not receive initial focus');
  assert(!openingA11y.inputHasFocus, 'opening moved focus into the hidden home input');
  assert(openingA11y.appIsHiddenAndInert, 'opening did not hide and inert the application shell');
  assert(openingA11y.stagedIsHiddenAndInert, 'unrevealed home actions remain in the accessibility tree');
  await introPage.keyboard.press('Enter');
  await introPage.waitForTimeout(120);
  const earlyIntro = await introPage.evaluate(() => ({
    title: document.getElementById('heroTitle').textContent.replace(/\s+/g, ' ').trim(),
    promiseVisible: document.getElementById('heroPromise').classList.contains('in'),
  }));
  assert(earlyIntro.title !== 'Hello, JARVIS?' && !earlyIntro.promiseVisible, 'opening skip bypassed the original typing intro');
  await introPage.waitForSelector('#opening', { state: 'detached' });
  const releasedApp = await introPage.evaluate(() => [document.querySelector('.topbar'), ...document.querySelectorAll('main')]
    .every((node) => !node.inert && !node.hasAttribute('aria-hidden')));
  assert(releasedApp, 'application shell stayed inert after the opening overlay was removed');
  await introPage.waitForFunction(() => document.getElementById('heroSearch').classList.contains('in'));
  const revealedSearch = await introPage.evaluate(() => {
    const search = document.getElementById('heroSearch');
    return !search.inert && !search.hasAttribute('aria-hidden') && document.activeElement === document.getElementById('homeInput');
  });
  assert(revealedSearch, 'home input was not focused only after the search became available');
  await introPage.waitForFunction(() => ['openMyWork', 'homeExamples'].every((id) => document.getElementById(id).classList.contains('in')));
  const revealedActions = await introPage.evaluate(() => ['heroSearch', 'openMyWork', 'homeExamples']
    .every((id) => { const node = document.getElementById(id); return !node.inert && !node.hasAttribute('aria-hidden'); }));
  assert(revealedActions, 'revealed home actions stayed excluded from keyboard or assistive technology');
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

  const inputPriority = await page.evaluate(() => ({
    overview: routeInput('이번 주 내가 해야 할 일').intent,
    targetedQuestion: routeInput('이번 주 펌프 기안 자료 찾아줘', 'home').intent,
    question: routeInput('펌프 기안 자료 찾아줘', 'home').intent,
    instruction: routeInput('팀장님이 펌프 계획 올리라고 했어', 'home').intent,
    managerRecipientTodo: routeInput('펌프 팀장님에게 보고해야 함', 'home').intent,
    note: routeInput('일정은 5월로 확정', 'workbench').intent,
    draft: routeInput('펌프 추진 보고 기안 작성해줘', 'home').intent,
    compoundDraft: routeInput('펌프 기안 작성해줘. 금요일까지 검토도 해야 해', 'home').intent,
    memoSourceDraft: routeInput('펌프 메모를 바탕으로 보고서 만들어줘', 'home').intent,
    replySourceDraft: routeInput('운영부 회신 내용으로 펌프 보고서 만들어줘', 'home').intent,
    todo: routeInput('안전관리관 작업허가 요청하기', 'workbench').intent,
    replyCheckTodo: routeInput('운영부 회신 확인해야 함', 'workbench').intent,
    draftMaterialTodo: routeInput('기안 자료 확인해야 함', 'workbench').intent,
    reportWritingTodo: routeInput('보고서 작성해야 함', 'workbench').intent,
    ambiguous: routeInput('펌프 최신값', 'workbench').intent,
    fixedTarget: routeInput('예산 자료 찾아줘', 'workbench').targetId,
  }));
  assert(inputPriority.overview === 'overview', 'targetless overview lost first priority');
  assert(inputPriority.targetedQuestion === 'question' && inputPriority.question === 'question', 'question did not outrank weekly or draft wording');
  assert(inputPriority.instruction === 'instruction', 'home instruction was not classified after questions');
  assert(inputPriority.managerRecipientTodo === 'todo', 'a manager mentioned as the action recipient was misclassified as the instruction source');
  assert(inputPriority.note === 'note', 'confirmed schedule was not classified as a progress note');
  assert(inputPriority.draft === 'draft' && inputPriority.compoundDraft === 'draft' && inputPriority.memoSourceDraft === 'draft' && inputPriority.replySourceDraft === 'draft', 'explicit draft creation was not classified as drafting');
  assert(inputPriority.todo === 'todo' && inputPriority.replyCheckTodo === 'todo' && inputPriority.draftMaterialTodo === 'todo' && inputPriority.reportWritingTodo === 'todo', 'action phrasing containing source or draft nouns was misrouted away from todo');
  assert(inputPriority.ambiguous === 'ambiguous', 'ambiguous fallback priority is incorrect');
  assert(inputPriority.fixedTarget === 'pump-2026', 'workbench input lost the selected work target');

  const candidate = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  candidate.setDefaultTimeout(7000);
  await candidate.goto(`${baseUrl}#workbench/pump-2026`);
  await candidate.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await candidate.reload();
  const candidateBaseline = await candidate.evaluate(() => getProgress(getSelectedWork()));
  const candidateBaselineCount = await candidate.textContent('#todoCount');
  await candidate.fill('#contextInput', '안전관리관 작업허가 요청하기');
  await candidate.locator('#contextForm').evaluate((form) => form.requestSubmit());
  const firstCandidate = candidate.locator('.todo-item.candidate', { hasText: '안전관리관 작업허가 요청하기' });
  assert(await firstCandidate.count() === 1, 'todo action was not added as a candidate');
  assert(await firstCandidate.locator('.candidate-confirm').count() === 1 && await firstCandidate.locator('.candidate-delete').count() === 1, 'candidate has no real confirm and delete actions');
  assert(await firstCandidate.locator('.todo-check').count() === 0, 'candidate can be completed before confirmation');
  assert((await candidate.textContent('#workFeedback')).includes('순환수 펌프 정비공사') && (await candidate.textContent('#workFeedback')).includes('할 일 후보'), 'candidate feedback does not name its target and change');
  assert((await candidate.evaluate(() => getProgress(getSelectedWork()))).total === candidateBaseline.total, 'candidate changed progress before confirmation');
  assert(await candidate.textContent('#todoCount') === candidateBaselineCount, 'candidate changed the formal incomplete todo count');
  const candidateAddAction = await candidate.evaluate(() => ({ type: lastAction.type, todoId: lastAction.todoId, hasIndex: Object.prototype.hasOwnProperty.call(lastAction, 'index') }));
  assert(candidateAddAction.type === 'todoAdd' && candidateAddAction.todoId && !candidateAddAction.hasIndex, 'candidate addition undo is not item-ID based');
  assert(await candidate.evaluate(() => JSON.parse(localStorage.getItem('jm-workbench-v1')).works.find((work) => work.id === 'pump-2026').todos.some((todo) => todo.text === '안전관리관 작업허가 요청하기' && todo.candidate)), 'candidate addition was not saved');
  await candidate.click('#undoButton');
  assert(await candidate.locator('.todo-item', { hasText: '안전관리관 작업허가 요청하기' }).count() === 0, 'undo did not remove the newly added candidate');

  await candidate.fill('#contextInput', '계약부 견적서 요청하기');
  await candidate.locator('#contextForm').evaluate((form) => form.requestSubmit());
  const secondCandidate = candidate.locator('.todo-item.candidate', { hasText: '계약부 견적서 요청하기' });
  await secondCandidate.locator('.candidate-confirm').click();
  const confirmedTodo = candidate.locator('.todo-item', { hasText: '계약부 견적서 요청하기' });
  assert(await confirmedTodo.count() === 1 && await confirmedTodo.getAttribute('class').then((value) => !value.includes('candidate')), 'confirm did not promote the candidate to the checklist');
  assert((await candidate.evaluate(() => getProgress(getSelectedWork()))).total === candidateBaseline.total + 1, 'confirmed todo did not enter calculated progress');
  assert(await candidate.evaluate(() => {
    const todo = JSON.parse(localStorage.getItem('jm-workbench-v1')).works.find((work) => work.id === 'pump-2026').todos.find((item) => item.text === '계약부 견적서 요청하기');
    return Boolean(todo && !todo.candidate);
  }), 'todo confirmation was not saved');
  assert((await candidate.textContent('#workFeedback')).includes('체크리스트'), 'confirmation feedback does not describe the checklist change');
  const candidateConfirmAction = await candidate.evaluate(() => ({ type: lastAction.type, todoId: lastAction.todoId, hasIndex: Object.prototype.hasOwnProperty.call(lastAction, 'index'), activeId: document.activeElement.id }));
  assert(candidateConfirmAction.type === 'todoConfirm' && candidateConfirmAction.todoId && !candidateConfirmAction.hasIndex, 'candidate confirmation undo is not item-ID based');
  assert(candidateConfirmAction.activeId === 'workFeedback', 'confirmation rerender dropped focus to the document body');
  await candidate.click('#undoButton');
  assert(await candidate.locator('.todo-item.candidate', { hasText: '계약부 견적서 요청하기' }).count() === 1, 'undo did not restore the confirmed todo to candidate state');
  await candidate.locator('.todo-item.candidate', { hasText: '계약부 견적서 요청하기' }).locator('.candidate-delete').click();
  assert(await candidate.locator('.todo-item', { hasText: '계약부 견적서 요청하기' }).count() === 0, 'candidate delete left the candidate visible');
  assert(await candidate.evaluate(() => !JSON.parse(localStorage.getItem('jm-workbench-v1')).works.find((work) => work.id === 'pump-2026').todos.some((todo) => todo.text === '계약부 견적서 요청하기')), 'candidate deletion was not saved');
  const candidateDeleteAction = await candidate.evaluate(() => ({ type: lastAction.type, todoId: lastAction.todoId, hasSnapshot: Boolean(lastAction.todoSnapshot), hasIndex: Object.prototype.hasOwnProperty.call(lastAction, 'index'), activeId: document.activeElement.id }));
  assert(candidateDeleteAction.type === 'todoDelete' && candidateDeleteAction.todoId && candidateDeleteAction.hasSnapshot && !candidateDeleteAction.hasIndex, 'candidate deletion undo is not ID and snapshot based');
  assert(candidateDeleteAction.activeId === 'workFeedback', 'candidate deletion rerender dropped focus to the document body');
  await candidate.click('#undoButton');
  assert(await candidate.locator('.todo-item.candidate', { hasText: '계약부 견적서 요청하기' }).count() === 1, 'undo did not restore only the deleted candidate');
  const legacyCandidateBaseline = await candidate.evaluate(() => getProgress(getSelectedWork()));
  await candidate.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jm-workbench-v1'));
    const work = saved.works.find((item) => item.id === 'pump-2026');
    const todo = work.todos.find((item) => item.text === '계약부 견적서 요청하기');
    todo.done = true;
    localStorage.setItem('jm-workbench-v1', JSON.stringify(saved));
  });
  await candidate.reload();
  await candidate.waitForSelector('.todo-item.candidate');
  assert(await candidate.evaluate(() => {
    const todo = getSelectedWork().todos.find((item) => item.text === '계약부 견적서 요청하기');
    return Boolean(todo && todo.candidate && !todo.done);
  }), 'legacy persisted candidate stayed completed before confirmation');
  await candidate.locator('.todo-item.candidate', { hasText: '계약부 견적서 요청하기' }).locator('.candidate-confirm').click();
  const legacyConfirmed = await candidate.evaluate(() => ({
    progress: getProgress(getSelectedWork()),
    todo: getSelectedWork().todos.find((item) => item.text === '계약부 견적서 요청하기'),
  }));
  assert(!legacyConfirmed.todo.candidate && !legacyConfirmed.todo.done && legacyConfirmed.progress.done === legacyCandidateBaseline.done, 'legacy candidate confirmation promoted a pre-completed Todo');
  await candidate.click('#undoButton');
  assert(await candidate.evaluate(() => {
    const todo = getSelectedWork().todos.find((item) => item.text === '계약부 견적서 요청하기');
    return Boolean(todo && todo.candidate && !todo.done);
  }), 'legacy candidate confirmation undo did not restore the normalized candidate exactly');
  await candidate.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('jm-workbench-v1'));
    const work = saved.works.find((item) => item.id === 'pump-2026');
    work.todos.unshift(
      { id: 'duplicate-todo', text: '중복 후보 첫 번째', done: false, candidate: true, origin: '저장 복구 테스트', sourceIds: [] },
      { id: 'duplicate-todo', text: '중복 후보 두 번째', done: false, candidate: true, origin: '저장 복구 테스트', sourceIds: [] },
    );
    localStorage.setItem('jm-workbench-v1', JSON.stringify(saved));
  });
  await candidate.reload();
  await candidate.waitForSelector('.todo-item.candidate');
  const repairedDuplicateIds = await candidate.evaluate(() => {
    const live = getSelectedWork().todos.filter((todo) => todo.text.startsWith('중복 후보')).map((todo) => todo.id);
    const saved = JSON.parse(localStorage.getItem('jm-workbench-v1')).works.find((work) => work.id === 'pump-2026').todos
      .filter((todo) => todo.text.startsWith('중복 후보')).map((todo) => todo.id);
    return { live, saved };
  });
  assert(new Set(repairedDuplicateIds.live).size === 2 && new Set(repairedDuplicateIds.saved).size === 2, 'duplicate persisted todo IDs were not repaired and saved');
  const firstDuplicateCandidate = candidate.locator('.todo-item.candidate', { hasText: '중복 후보 첫 번째' });
  const secondDuplicateCandidate = candidate.locator('.todo-item.candidate', { hasText: '중복 후보 두 번째' });
  await secondDuplicateCandidate.locator('.candidate-confirm').click();
  assert(await firstDuplicateCandidate.count() === 1, 'confirming the second repaired candidate changed the first candidate');
  assert(await candidate.locator('.todo-item:not(.candidate)', { hasText: '중복 후보 두 번째' }).count() === 1, 'confirming the second repaired candidate did not change that item');
  await candidate.click('#undoButton');
  assert(await candidate.locator('.todo-item.candidate', { hasText: '중복 후보' }).count() === 2, 'undo did not restore exactly the confirmed repaired candidate');
  await candidate.locator('.todo-item.candidate', { hasText: '중복 후보 두 번째' }).locator('.candidate-delete').click();
  assert(await candidate.locator('.todo-item.candidate', { hasText: '중복 후보 첫 번째' }).count() === 1 && await candidate.locator('.todo-item', { hasText: '중복 후보 두 번째' }).count() === 0, 'deleting the second repaired candidate changed the wrong item');
  await candidate.click('#undoButton');
  assert(await candidate.locator('.todo-item.candidate', { hasText: '중복 후보' }).count() === 2, 'undo did not restore exactly the deleted repaired candidate');
  await candidate.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await candidate.close();
  await page.reload();

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
  await page.click('#homeEvidenceObject', { force: true });
  await page.waitForSelector('#view-workbench.active');
  await page.waitForTimeout(90);
  const homeEvidenceFocus = await page.evaluate(() => {
    const item = document.querySelector('.source-item.focused');
    return {
      active: Boolean(item && document.activeElement === item),
      status: document.getElementById('sourceLinkStatus').textContent,
    };
  });
  assert(homeEvidenceFocus.active && homeEvidenceFocus.status.includes('근거 자료'), 'home evidence object did not land keyboard and assistive-technology focus on its evidence');
  await page.goto(`${baseUrl}#home`);
  await page.waitForSelector('#view-home.active');

  const recentNotes = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  recentNotes.setDefaultTimeout(7000);
  await recentNotes.goto(`${baseUrl}#home`);
  await recentNotes.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await recentNotes.reload();
  const noteFixtures = [
    ['pump-2026', '펌프 생성 순서 메모'],
    ['audit-2026', '감사 생성 순서 메모'],
    ['budget-2026', '예산 생성 순서 메모'],
  ];
  for (const [workId, noteText] of noteFixtures) {
    await recentNotes.goto(`${baseUrl}#workbench/${workId}`);
    await recentNotes.waitForSelector('#view-workbench.active');
    await recentNotes.fill('#contextInput', noteText);
    await recentNotes.locator('#contextForm').evaluate((form) => form.requestSubmit());
    await recentNotes.waitForFunction((text) => document.getElementById('activityList').textContent.includes(text), noteText);
  }
  await recentNotes.goto(`${baseUrl}#home`);
  await recentNotes.reload();
  await recentNotes.waitForSelector('#view-home.active');
  const recentNoteContract = await recentNotes.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-home-memo-index]')];
    const created = appState.works.flatMap((work) => work.notes
      .filter((note) => note.text.includes('생성 순서 메모'))
      .map((note) => ({ workId: work.id, text: note.text, sequence: note.sequence })));
    return {
      rowTexts: rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
      rowWorkIds: rows.map((row) => row.dataset.homeWorkId),
      created,
    };
  });
  assert(recentNoteContract.created.length === 3 && recentNoteContract.created.every((note) => Number.isSafeInteger(note.sequence)), 'new progress notes do not persist a monotonic sequence');
  assert(recentNoteContract.created[0].sequence < recentNoteContract.created[1].sequence && recentNoteContract.created[1].sequence < recentNoteContract.created[2].sequence, 'progress note sequence is not monotonic across works');
  assert(recentNoteContract.rowTexts[0].includes('예산 생성 순서 메모') && recentNoteContract.rowTexts[1].includes('감사 생성 순서 메모'), 'home recent notes are not ordered by actual creation sequence');
  assert(recentNoteContract.rowWorkIds[0] === 'budget-2026' && recentNoteContract.rowWorkIds[1] === 'audit-2026', 'home recent note rows point at the wrong works');
  await recentNotes.click('[data-home-memo-index="0"]');
  await recentNotes.waitForSelector('#view-workbench.active');
  assert(recentNotes.url().endsWith('#workbench/budget-2026'), 'newest home note did not open its own workbench');
  await recentNotes.goto(`${baseUrl}#home`);
  await recentNotes.click('[data-home-memo-index="1"]');
  await recentNotes.waitForSelector('#view-workbench.active');
  assert(recentNotes.url().endsWith('#workbench/audit-2026'), 'second newest home note did not open its own workbench');
  await recentNotes.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await recentNotes.close();

  const zeroWork = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  zeroWork.setDefaultTimeout(5000);
  await zeroWork.goto(`${baseUrl}#home`);
  await zeroWork.evaluate(() => localStorage.setItem('jm-workbench-v1', JSON.stringify({
    version: 1,
    works: [],
    selectedWorkId: null,
    lastVisitedWorkId: null,
    workMode: 'list',
  })));
  await zeroWork.reload();
  await zeroWork.waitForSelector('#view-home.active');
  const zeroWorkEvidence = await zeroWork.evaluate(() => {
    const button = document.getElementById('homeEvidenceObject');
    return {
      disabled: button.disabled,
      label: button.getAttribute('aria-label'),
      title: document.getElementById('homeEvidenceTitle').textContent,
    };
  });
  assert(!zeroWorkEvidence.disabled, 'zero-work evidence fallback is disabled');
  assert(zeroWorkEvidence.label && zeroWorkEvidence.label.includes('내 업무 보기'), 'zero-work evidence fallback has no My Work accessible name');
  assert(zeroWorkEvidence.title.includes('연결된 업무 없음'), 'zero-work evidence object lost its empty-state copy');
  const memoSemantics = await zeroWork.evaluate(() => {
    const memo = document.getElementById('homeMemoObject');
    const fallback = document.getElementById('homeMemoFallback');
    return {
      hasTabIndex: memo.hasAttribute('tabindex'),
      hasClickHandler: memo.hasAttribute('onclick'),
      hasKeyHandler: memo.hasAttribute('onkeydown'),
      rowTags: [...memo.querySelectorAll('[data-home-memo-index]')].map((row) => row.tagName),
      fallbackIsVisibleButton: Boolean(fallback && fallback.tagName === 'BUTTON' && !fallback.hidden),
      nestedButtonCount: memo.querySelectorAll('button button').length,
    };
  });
  assert(!memoSemantics.hasTabIndex && !memoSemantics.hasClickHandler && !memoSemantics.hasKeyHandler, 'recent-note section itself is still interactive');
  assert(memoSemantics.rowTags.length === 2 && memoSemantics.rowTags.every((tag) => tag === 'BUTTON'), 'recent-note rows are not the only record actions');
  assert(memoSemantics.fallbackIsVisibleButton, 'empty recent-note card has no real My Work fallback button');
  assert(memoSemantics.nestedButtonCount === 0, 'recent-note card contains nested buttons');
  await zeroWork.click('#homeMemoFallback', { force: true });
  await zeroWork.waitForSelector('#view-work.active');
  assert(zeroWork.url().endsWith('#work/list'), 'empty recent-note fallback did not open My Work');
  await zeroWork.goto(`${baseUrl}#home`);
  await zeroWork.waitForSelector('#view-home.active');
  await zeroWork.click('#homeEvidenceObject', { force: true });
  await zeroWork.waitForSelector('#view-work.active');
  assert(zeroWork.url().endsWith('#work/list'), 'zero-work evidence fallback did not open My Work');
  await zeroWork.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await zeroWork.reload();
  assert(await zeroWork.locator('[data-work-id="pump-2026"]').count() === 1, 'zero-work fixture was not restored to the seed');
  await zeroWork.close();

  const repeatFilter = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  repeatFilter.setDefaultTimeout(7000);
  await repeatFilter.goto(`${baseUrl}#home`);
  await repeatFilter.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await repeatFilter.reload();
  await repeatFilter.fill('#homeInput', '팀장님이 신규 설비 홍보행사 준비하라고 했어');
  await repeatFilter.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await repeatFilter.waitForSelector('#view-clarify.active');
  await repeatFilter.click('.clarify-create');
  await repeatFilter.waitForSelector('#view-workbench.active');
  const repeatFixtureNewId = await repeatFilter.evaluate(() => getSelectedWork().id);
  await repeatFilter.goto(`${baseUrl}#home`);
  await repeatFilter.waitForSelector('#view-home.active');
  await repeatFilter.click('#homeForecastObject', { force: true });
  await repeatFilter.waitForSelector('#view-work.active');
  assert(repeatFilter.url().endsWith('#work/list'), 'repeat forecast did not open the work list route');
  assert(await repeatFilter.isVisible('#workFilterBar'), 'repeat forecast has no visible active-filter UI');
  assert((await repeatFilter.textContent('#workFilterBar')).includes('반복 업무만') && (await repeatFilter.textContent('#workFilterBar')).includes('전체 업무 보기'), 'repeat filter cannot be understood or cleared from visible copy');
  assert(await repeatFilter.locator(`[data-work-id="${repeatFixtureNewId}"]`).count() === 0, 'repeat forecast left a new non-repeat work in the list');
  const repeatListIds = await repeatFilter.locator('#workList [data-work-id]').evaluateAll((rows) => rows.map((row) => row.dataset.workId));
  assert(repeatListIds.includes('pump-2026'), `repeat forecast removed a repeat work (${repeatListIds.join(', ')})`);
  await repeatFilter.click('#workModeCalendar');
  assert(await repeatFilter.isVisible('#workFilterBar') && await repeatFilter.evaluate(() => appState.workFilter === 'repeat'), 'calendar mode did not preserve the repeat filter');
  await repeatFilter.click('#listModeBtn');
  assert(await repeatFilter.locator(`[data-work-id="${repeatFixtureNewId}"]`).count() === 0, 'list mode switch cleared the repeat filter');
  await repeatFilter.click('#clearWorkFilter');
  assert(await repeatFilter.isHidden('#workFilterBar'), 'clear-filter action left the repeat filter visible');
  assert(await repeatFilter.locator(`[data-work-id="${repeatFixtureNewId}"]`).count() === 1, 'clear-filter action did not restore new work');
  await repeatFilter.goto(`${baseUrl}#home`);
  await repeatFilter.click('#homeForecastObject', { force: true });
  await repeatFilter.waitForSelector('#view-work.active');
  await repeatFilter.click('#navWork');
  assert(await repeatFilter.isHidden('#workFilterBar') && await repeatFilter.locator(`[data-work-id="${repeatFixtureNewId}"]`).count() === 1, 'general My Work navigation did not reset the repeat filter');
  await repeatFilter.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await repeatFilter.close();

  await page.click('#openMyWork');
  await page.waitForSelector('#view-work.active');
  assert(page.url().endsWith('#work/list'), 'My Work entry did not open list mode');
  assert(await page.locator('[data-work-id="pump-2026"]').count() === 1, 'work list does not render work items');
  const listModeAria = await page.evaluate(() => ({
    listPressed: document.getElementById('listModeBtn').getAttribute('aria-pressed'),
    listControls: document.getElementById('listModeBtn').getAttribute('aria-controls'),
    calendarPressed: document.getElementById('workModeCalendar').getAttribute('aria-pressed'),
    calendarControls: document.getElementById('workModeCalendar').getAttribute('aria-controls'),
  }));
  assert(listModeAria.listPressed === 'true' && listModeAria.calendarPressed === 'false', 'list mode pressed state is not exposed to assistive technology');
  assert(listModeAria.listControls === 'workList' && listModeAria.calendarControls === 'workCalendar', 'work mode buttons do not identify their controlled panels');
  const workShellWidth = await page.locator('#view-work > .shell').evaluate((node) => node.getBoundingClientRect().width);
  assert(workShellWidth <= 900, `My Work widened beyond the original product width (${workShellWidth}px)`);
  const findButtonLayout = await page.locator('#workSearchForm button[type="submit"]').evaluate((button) => ({
    flexShrink: getComputedStyle(button).flexShrink,
    whiteSpace: getComputedStyle(button).whiteSpace,
  }));
  assert(findButtonLayout.flexShrink === '0' && findButtonLayout.whiteSpace === 'nowrap', 'My Work find button can shrink or wrap onto two lines');
  await page.click('[data-work-id="pump-2026"]');
  await page.waitForSelector('#view-workbench.active');
  assert(page.url().endsWith('#workbench/pump-2026'), 'work list item did not open its workbench route');
  await page.click('#navWork');
  await page.waitForSelector('#view-work.active');
  await page.click('#workModeCalendar');
  assert(page.url().endsWith('#work/calendar'), 'calendar mode is not deep linked');
  assert(await page.isHidden('#workList'), 'calendar mode left the work list visible');
  assert(await page.getAttribute('#listModeBtn', 'aria-pressed') === 'false' && await page.getAttribute('#workModeCalendar', 'aria-pressed') === 'true', 'calendar mode pressed state did not follow the visible panel');
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
  const workbenchLayout = await page.evaluate(() => {
    const shell = document.querySelector('#view-workbench > .workbench-shell');
    const ids = ['workContext', 'nextActionPanel', 'todoPanel', 'activityPanel', 'deliverablePanel'];
    return {
      width: shell && shell.getBoundingClientRect().width,
      tops: ids.map((id) => document.getElementById(id).getBoundingClientRect().top),
    };
  });
  assert(workbenchLayout.width <= 900, `workbench widened beyond the approved reading width (${workbenchLayout.width}px)`);
  assert(workbenchLayout.tops.every((top, index, values) => index === 0 || top > values[index - 1]), 'workbench sections do not follow context, next action, checklist, activity, deliverable order');
  assert((await page.textContent('#factProgress')).includes('/'), 'progress does not expose completed checklist count');
  assert(await page.isVisible('.todo-source'), 'next actions do not expose their linked evidence');
  const todoSourceLabel = await page.locator('#todoList .todo-source').first().getAttribute('aria-label');
  assert(todoSourceLabel && todoSourceLabel.includes('최근 진동 측정값 확인') && todoSourceLabel.includes('2025년 순환수 펌프 정비공사 추진 보고'), 'evidence link does not name both the action and source');
  await page.locator('.todo-source').first().click();
  assert(await page.isVisible('.source-item.focused'), 'linked evidence was not highlighted from the action');
  assert(await page.locator('.source-item.focused').evaluate((item) => document.activeElement === item), 'linked evidence did not receive focus for assistive technology');
  assert((await page.textContent('#sourceLinkStatus')).includes('근거 자료'), 'linked evidence focus was not announced in a live region');
  const sourceButtonLabel = await page.locator('.source-item.focused .source-open').getAttribute('aria-label');
  assert(sourceButtonLabel && sourceButtonLabel.includes('2025년 순환수 펌프 정비공사 추진 보고') && sourceButtonLabel.includes('원문'), 'source action does not have a specific accessible name');
  const todoAriaLabel = await page.locator('.todo-check').first().getAttribute('aria-label');
  assert(todoAriaLabel.includes('최근 진동 측정값 확인'), 'todo checkbox does not identify its action to assistive technology');
  const sourceTextIsSeparated = await page.locator('.source-item').first().evaluate((item) => {
    const name = item.querySelector('.source-name');
    const meta = item.querySelector('.source-meta');
    return getComputedStyle(name).display === 'block' && getComputedStyle(meta).display === 'block';
  });
  assert(sourceTextIsSeparated, 'source title and metadata run together instead of using separate lines');

  const darkSourceSurface = await page.evaluate(() => {
    applyTheme('dark');
    const source = document.querySelector('.source-item:not(.focused)');
    const root = getComputedStyle(document.documentElement);
    const sourceStyle = getComputedStyle(source);
    const result = {
      sourceSurface: sourceStyle.getPropertyValue('--surface-2').trim(),
      rootSurface: root.getPropertyValue('--surface-2').trim(),
      background: sourceStyle.backgroundColor,
    };
    applyTheme('light');
    return result;
  });
  assert(darkSourceSurface.sourceSurface === darkSourceSurface.rootSurface && darkSourceSurface.background === 'rgb(26, 34, 48)', `dark workbench source card keeps the light surface and loses text contrast (${JSON.stringify(darkSourceSurface)})`);

  const nextActionBefore = await page.textContent('#nextAction');
  await page.locator('.todo-item.next .todo-check').focus();
  await page.keyboard.press('Enter');
  const nextActionAfter = await page.textContent('#nextAction');
  assert(nextActionAfter !== nextActionBefore, 'completing the current action did not advance the next action');
  assert((await page.locator('.todo-item.next').count()) === 1, 'workbench did not mark exactly one next incomplete action');
  assert(await page.locator('#workFeedback').evaluate((feedback) => document.activeElement === feedback), 'keyboard Todo completion discarded focus instead of announcing its feedback');
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
  assert((await page.textContent('#workFeedback')).includes('순환수 펌프 정비공사') && (await page.textContent('#workFeedback')).includes('결정 기록'), 'context feedback did not name the selected work and decision change');
  const activityAfter = await page.locator('#activityList .activity-item').count();
  assert(activityAfter === activityBefore + 1, 'context memo did not stay in the selected work');

  await page.click('#undoButton');
  const activityUndone = await page.locator('#activityList .activity-item').count();
  assert(activityUndone === activityBefore, 'undo did not restore the work activity');

  const relink = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  relink.setDefaultTimeout(7000);
  await relink.goto(`${baseUrl}#home`);
  await relink.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await relink.reload();
  const relinkBefore = await relink.evaluate(() => ({
    pump: getWork('pump-2026').notes.length,
    audit: getWork('audit-2026').notes.length,
  }));
  await relink.fill('#homeInput', '펌프 일정은 5월로 확정');
  await relink.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await relink.waitForSelector('#view-workbench.active');
  assert(await relink.isVisible('#relinkButton'), 'a newly applied home decision cannot change targets');
  assert(await relink.evaluate((before) => getWork('pump-2026').notes.length === before + 1, relinkBefore.pump), 'initial decision was not applied once to the detected work');
  await relink.click('#relinkButton');
  await relink.waitForSelector('#view-clarify.active');
  await relink.click('[data-work-id="audit-2026"]');
  await relink.waitForSelector('#view-workbench.active');
  const relinkAfter = await relink.evaluate((before) => ({
    selected: getSelectedWork().id,
    pump: getWork('pump-2026').notes.length,
    audit: getWork('audit-2026').notes.length,
    copies: WORK_ITEMS.flatMap((work) => work.notes).filter((note) => note.text === '펌프 일정은 5월로 확정').length,
    pumpBefore: before.pump,
    auditBefore: before.audit,
  }), relinkBefore);
  assert(relinkAfter.selected === 'audit-2026', 'target change did not select the new work');
  assert(relinkAfter.pump === relinkAfter.pumpBefore && relinkAfter.audit === relinkAfter.auditBefore + 1 && relinkAfter.copies === 1, 'target change did not roll back only the last change and apply it exactly once');
  assert((await relink.textContent('#workFeedback')).includes('감사 지적사항 조치결과') && (await relink.textContent('#workFeedback')).includes('결정 기록'), 'relinked feedback does not name the new target and change');
  await relink.click('#undoButton');
  assert(await relink.evaluate((before) => getWork('pump-2026').notes.length === before.pump && getWork('audit-2026').notes.length === before.audit, relinkBefore), 'undo after relink changed pre-existing notes');
  await relink.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await relink.close();

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
  await draftHome.goto(appUrl);
  await draftHome.fill('#homeInput', '펌프 기안 작성해줘. 금요일까지 검토도 해야 해');
  await draftHome.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await draftHome.waitForSelector('#view-draft.active');
  assert(draftHome.url().endsWith('#draft/pump-2026'), 'an explicit draft clause followed by a todo clause was demoted from drafting');
  assert(await draftHome.evaluate(() => !getWork('pump-2026').todos.some((todo) => todo.text.includes('금요일까지 검토'))), 'compound draft request was added as a todo instead of opening drafting');
  for (const sourceDraftText of ['펌프 메모를 바탕으로 보고서 만들어줘', '운영부 회신 내용으로 펌프 보고서 만들어줘']) {
    await draftHome.goto(appUrl);
    await draftHome.fill('#homeInput', sourceDraftText);
    await draftHome.locator('#homeForm').evaluate((form) => form.requestSubmit());
    await draftHome.waitForSelector('#view-draft.active');
    assert(draftHome.url().endsWith('#draft/pump-2026'), `source material noun demoted drafting: ${sourceDraftText}`);
  }

  const managerRecipient = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  managerRecipient.setDefaultTimeout(5000);
  await managerRecipient.goto(appUrl);
  await managerRecipient.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await managerRecipient.reload();
  const originalInstruction = await managerRecipient.evaluate(() => getWork('pump-2026').instruction);
  await managerRecipient.fill('#homeInput', '펌프 팀장님에게 보고해야 함');
  await managerRecipient.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await managerRecipient.waitForSelector('#view-workbench.active');
  assert(await managerRecipient.locator('.todo-item.candidate', { hasText: '팀장님에게 보고해야 함' }).count() === 1, 'manager-recipient action was not added as a todo candidate');
  assert(await managerRecipient.evaluate((expected) => getWork('pump-2026').instruction === expected, originalInstruction), 'manager-recipient action overwrote the original instruction');
  await managerRecipient.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await managerRecipient.close();

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
  assert((await auditDraft.textContent('#draftEvidence')).includes('감사'), 'audit draft evidence lost the selected work context');
  assert(auditDraft.url().endsWith('#draft/audit-2026'), 'draft URL lost the selected work id');
  assert(await auditDraft.locator('.draft-shell').evaluate((node) => node.getBoundingClientRect().width <= 900), 'draft escaped the approved centered reading width');
  const draftTableText = await auditDraft.textContent('#draftTable');
  assert(draftTableText.includes('작년 자료 참고') && draftTableText.includes('올해 확인 필요'), 'draft values do not distinguish prior evidence from values requiring confirmation');
  assert(await auditDraft.getAttribute('#draftNotice', 'role') === 'status' && await auditDraft.getAttribute('#draftNotice', 'aria-live') === 'polite', 'draft save and check notice is not announced');
  await auditDraft.fill('#draftIntent', '운영부 미회신 항목을 반영');
  assert((await auditDraft.textContent('#draftState')).includes('저장 필요'), 'editing the draft did not mark it as unsaved');
  await auditDraft.click('#draftSave');
  assert((await auditDraft.textContent('#draftState')).includes('임시 저장됨'), 'saving the draft did not update its visible state');
  await auditDraft.reload();
  await auditDraft.waitForSelector('#view-draft.active');
  assert(await auditDraft.inputValue('#draftIntent') === '운영부 미회신 항목을 반영', 'draft edits did not persist across reload');
  await auditDraft.goBack();
  await auditDraft.waitForSelector('#view-workbench.active');
  assert(auditDraft.url().endsWith('#workbench/audit-2026'), 'draft reload and Back lost the selected audit workbench');
  await auditDraft.close();

  const historyFlow = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  historyFlow.setDefaultTimeout(5000);
  await historyFlow.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  await historyFlow.click('#draftStart');
  await historyFlow.waitForSelector('#view-draft.active');
  await historyFlow.goBack();
  await historyFlow.waitForSelector('#view-workbench.active');
  assert(historyFlow.url().endsWith('#workbench/pump-2026'), 'browser Back did not restore the selected workbench from draft');
  await historyFlow.close();

  const homeDraftHistory = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  homeDraftHistory.setDefaultTimeout(5000);
  await homeDraftHistory.goto(appUrl);
  await homeDraftHistory.fill('#homeInput', '펌프 추진 보고 기안 작성해줘');
  await homeDraftHistory.locator('#homeForm').evaluate((form) => form.requestSubmit());
  await homeDraftHistory.waitForSelector('#view-draft.active');
  await homeDraftHistory.goBack();
  await homeDraftHistory.waitForSelector('#view-workbench.active');
  assert(homeDraftHistory.url().endsWith('#workbench/pump-2026'), 'Home draft history skipped the selected workbench');
  await homeDraftHistory.goBack();
  await homeDraftHistory.waitForSelector('#view-home.active');
  assert(new URL(homeDraftHistory.url()).hash === '#home', 'Home draft history did not return Home on the second Back');
  await homeDraftHistory.close();

  const calendarDraftHistory = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  calendarDraftHistory.setDefaultTimeout(5000);
  await calendarDraftHistory.goto(appUrl.replace('#home', '#work/calendar'));
  await calendarDraftHistory.click('[data-calendar-work="audit-2026"]');
  await calendarDraftHistory.click('#draftStart');
  await calendarDraftHistory.waitForSelector('#view-draft.active');
  await calendarDraftHistory.goBack();
  await calendarDraftHistory.waitForSelector('#view-workbench.active');
  await calendarDraftHistory.goBack();
  await calendarDraftHistory.waitForSelector('#view-work.active');
  assert(calendarDraftHistory.url().endsWith('#work/calendar'), 'draft flow lost the originating calendar view');
  await calendarDraftHistory.close();

  const directDraft = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  directDraft.setDefaultTimeout(5000);
  await directDraft.goto(appUrl.replace('#home', '#draft/audit-2026'));
  await directDraft.waitForSelector('#view-draft.active');
  const directHistoryBefore = await directDraft.evaluate(() => history.length);
  await directDraft.waitForTimeout(120);
  assert(await directDraft.evaluate(() => history.length) === directHistoryBefore, 'direct draft deep link synthesized a workbench history entry');
  await directDraft.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
  assert(!directDraft.url().endsWith('#workbench/audit-2026'), 'direct draft deep link invented a prior workbench on Back');
  await directDraft.close();

  for (const emptyDraftHash of ['#draft', '#draft/']) {
    const invalidDraft = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await invalidDraft.goto(`${baseUrl}${emptyDraftHash}`);
    await invalidDraft.waitForSelector('#view-notfound.active');
    assert(new URL(invalidDraft.url()).hash === emptyDraftHash, `empty draft deep link changed its requested hash: ${emptyDraftHash}`);
    await invalidDraft.close();
  }

  const resetPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  resetPage.setDefaultTimeout(5000);
  await resetPage.goto(appUrl);
  assert(await resetPage.isVisible('#resetSample'), 'Home has no visible sample reset control');
  const resetFixture = await resetPage.evaluate(() => {
    const pump = getWork('pump-2026');
    pump.draftText = '초기화할 임시 기안';
    pump.notes.unshift({ id: 'reset-note', tag: '메모', time: '방금', text: '초기화 대상 메모' });
    const added = JSON.parse(JSON.stringify(getWork('budget-2026')));
    added.id = 'new-reset-check';
    added.title = added.shortTitle = '초기화 대상 신규 업무';
    WORK_ITEMS.push(added);
    appState.lastVisitedWorkId = 'audit-2026';
    appState.workMode = workMode = 'calendar';
    appState.workFilter = 'repeat';
    lastAction = { type: 'answer', workId: 'pump-2026', previous: '' };
    pendingHomeText = '초기화 대상 입력';
    pendingHomeResult = { text: pendingHomeText, intent: 'todo', context: 'home', targetId: 'pump-2026' };
    pendingIntentResult = pendingHomeResult;
    pendingRelinkAction = lastAction;
    lastInputConnection = { text: pendingHomeText, result: pendingHomeResult, workId: 'pump-2026', action: lastAction };
    saveState();
    return localStorage.getItem('jm-workbench-v1');
  });
  resetPage.once('dialog', (dialog) => dialog.dismiss());
  await resetPage.click('#resetSample');
  assert(await resetPage.evaluate(() => getWork('pump-2026').draftText) === '초기화할 임시 기안', 'canceling sample reset changed the draft');
  assert(await resetPage.evaluate(() => localStorage.getItem('jm-workbench-v1')) === resetFixture, 'canceling sample reset changed persisted state');
  resetPage.once('dialog', (dialog) => dialog.accept());
  await resetPage.click('#resetSample');
  await resetPage.waitForSelector('#view-home.active');
  const resetState = await resetPage.evaluate(() => ({
    draftText: getWork('pump-2026').draftText,
    hasNote: getWork('pump-2026').notes.some((note) => note.id === 'reset-note'),
    workCount: WORK_ITEMS.length,
    seedCount: WORK_SEED.length,
    lastVisited: appState.lastVisitedWorkId,
    mode: appState.workMode,
    filter: appState.workFilter,
    transientClear: [lastAction, lastInputConnection, pendingRelinkAction, pendingHomeResult, pendingIntentResult].every((value) => value === null) && pendingHomeText === '',
    stored: localStorage.getItem('jm-workbench-v1'),
  }));
  assert(resetState.draftText === '' && !resetState.hasNote && resetState.workCount === resetState.seedCount, 'sample reset did not restore the immutable seed');
  assert(resetState.lastVisited === null && resetState.mode === 'list' && resetState.filter === 'all', 'sample reset kept navigation preferences or the last visited work');
  assert(resetState.transientClear && resetState.stored === null, 'sample reset kept transient actions or persisted sample changes');
  await resetPage.reload();
  assert(await resetPage.evaluate(() => getWork('pump-2026').draftText === '' && WORK_ITEMS.length === WORK_SEED.length), 'sample reset did not survive reload');
  await resetPage.close();

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

  const engine = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  engine.setDefaultTimeout(7000);
  const engineRequests = [];
  await engine.route('http://localhost:8399/api/ask', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON();
    engineRequests.push({ url: request.url(), payload });
    const questionText = payload.question;
    if (questionText.includes('첫 번째')) await new Promise((resolve) => setTimeout(resolve, 360));
    if (questionText.includes('취소할')) await new Promise((resolve) => setTimeout(resolve, 360));
    if (questionText.includes('뒤늦을')) await new Promise((resolve) => setTimeout(resolve, 360));
    if (questionText.includes('포커스')) await new Promise((resolve) => setTimeout(resolve, 360));
    const answer = questionText.includes('포커스') ? 'engine-focus-answer' :
      questionText.includes('두 번째') ? 'engine-two-answer' :
      questionText.includes('취소할') ? 'engine-cancelled-answer' :
      questionText.includes('결정 자료') ? 'engine-late-note-answer' :
      questionText.includes('할 일 자료') ? 'engine-late-todo-answer' : 'engine-one-answer';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ answer }),
    });
  });
  const engineUrl = `${baseUrl}?engine=${encodeURIComponent('http://localhost:8399')}#workbench/pump-2026`;
  await engine.goto(engineUrl);
  await engine.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await engine.reload();
  const engineUrlContract = await engine.evaluate(() => ({
    local: normalizeEngineUrl('http://localhost:8399/'),
    ipv4: normalizeEngineUrl('https://127.0.0.1:8399'),
    ipv6: normalizeEngineUrl('http://[::1]:8399'),
    remote: normalizeEngineUrl('https://example.com'),
    credentials: normalizeEngineUrl('http://user:secret@localhost:8399'),
    script: normalizeEngineUrl('javascript:alert(1)'),
  }));
  assert(engineUrlContract.local && engineUrlContract.ipv4 && engineUrlContract.ipv6, 'loopback engine URLs were rejected');
  assert(!engineUrlContract.remote && !engineUrlContract.credentials && !engineUrlContract.script, 'unsafe engine URL was accepted');
  await engine.fill('#contextInput', '첫 번째 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.waitForSelector('#workAnswer:not([hidden])');
  await engine.fill('#contextInput', '두 번째 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('engine-two-answer'));
  await engine.waitForTimeout(450);
  const racedAnswer = await engine.textContent('#workAnswer');
  assert(racedAnswer.includes('engine-two-answer') && !racedAnswer.includes('engine-one-answer'), 'late engine response overwrote a newer question');
  assert(engineRequests.length === 2 && engineRequests.every((request) => new URL(request.url).pathname === '/api/ask'), 'engine used an endpoint other than /api/ask');
  assert(engineRequests.every((request) => request.payload.work_id === 'pump-2026' && request.payload.title.includes('순환수 펌프')), 'engine request lost the selected work context');
  const storedEngineState = await engine.evaluate(() => localStorage.getItem('jm-workbench-v1'));
  assert(!storedEngineState.includes('localhost:8399') && !storedEngineState.includes('첫 번째 자료 찾아줘') && !storedEngineState.includes('두 번째 자료 찾아줘'), 'engine URL or question was persisted');
  await engine.fill('#contextInput', '포커스 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.locator('.todo-source').first().click();
  const focusedEvidence = await engine.locator('.source-item.focused').evaluate((item) => ({
    sourceId: item.dataset.sourceId,
    status: document.getElementById('sourceLinkStatus').textContent,
    active: document.activeElement === item,
  }));
  assert(focusedEvidence.active && focusedEvidence.status.includes('근거 자료'), 'evidence focus was not established while the engine response was pending');
  await engine.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('engine-focus-answer'));
  const focusAfterEngine = await engine.evaluate((sourceId) => {
    const item = document.querySelector(`.source-item[data-source-id="${sourceId}"]`);
    return {
      focused: Boolean(item && item.classList.contains('focused')),
      active: document.activeElement === item,
      status: document.getElementById('sourceLinkStatus').textContent,
    };
  }, focusedEvidence.sourceId);
  assert(focusAfterEngine.focused && focusAfterEngine.active && focusAfterEngine.status === focusedEvidence.status, 'engine response discarded the user\'s evidence focus or live announcement');
  await engine.fill('#contextInput', '취소할 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.waitForFunction(() => document.getElementById('workAnswer').textContent.includes('취소할 자료 찾아줘'));
  await engine.click('#undoButton');
  await engine.waitForTimeout(450);
  assert(!(await engine.textContent('#workAnswer')).includes('engine-cancelled-answer'), 'engine response survived undo and replaced the restored answer');

  const noteRaceBaseline = await engine.locator('#activityList .activity-item').count();
  await engine.fill('#contextInput', '뒤늦을 결정 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.fill('#contextInput', '일정은 6월로 확정');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.waitForTimeout(450);
  assert(!(await engine.textContent('#workAnswer')).includes('engine-late-note-answer'), 'late question response survived a newer note input');
  assert((await engine.textContent('#workFeedback')).includes('결정 기록') && await engine.isVisible('#undoButton'), 'late question replaced the newer note feedback or undo action');
  await engine.click('#undoButton');
  assert(await engine.locator('#activityList .activity-item').count() === noteRaceBaseline, 'undo after a question-to-note race did not undo the note');

  await engine.fill('#contextInput', '뒤늦을 할 일 자료 찾아줘');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.fill('#contextInput', '품질관리부 검수 요청하기');
  await engine.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await engine.waitForTimeout(450);
  assert(!(await engine.textContent('#workAnswer')).includes('engine-late-todo-answer'), 'late question response survived a newer todo input');
  assert((await engine.textContent('#workFeedback')).includes('할 일 후보') && await engine.isVisible('#undoButton'), 'late question replaced the newer todo feedback or undo action');
  await engine.click('#undoButton');
  assert(await engine.locator('.todo-item', { hasText: '품질관리부 검수 요청하기' }).count() === 0, 'undo after a question-to-todo race did not undo the candidate');
  await engine.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await engine.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.setDefaultTimeout(5000);
  await mobile.goto(appUrl.replace('#home', '#workbench/pump-2026'));
  await mobile.waitForSelector('#view-workbench.active');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `mobile layout overflows horizontally by ${overflow}px`);
  assert(await mobile.isVisible('.sample-badge'), 'mobile hides the sample-data disclosure');
  assert(await mobile.isVisible('#benchTitle') && await mobile.isVisible('#benchDue'), 'mobile first screen hides the work title or due date');
  const mobileContextBounds = await mobile.evaluate(() => ({
    titleBottom: document.getElementById('benchTitle').getBoundingClientRect().bottom,
    dueBottom: document.querySelector('.due-state').getBoundingClientRect().bottom,
    viewport: innerHeight,
  }));
  assert(mobileContextBounds.titleBottom <= mobileContextBounds.viewport && mobileContextBounds.dueBottom <= mobileContextBounds.viewport, 'mobile title or due date ends below the first viewport');
  const nextActionBounds = await mobile.locator('#nextActionPanel').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight };
  });
  assert(nextActionBounds.top < 650, `mobile pushes the next action below the first screen (${nextActionBounds.top}px)`);
  assert(nextActionBounds.bottom <= nextActionBounds.viewport, `mobile cuts off the next action below the first viewport (${nextActionBounds.bottom}px)`);
  await mobile.fill('#contextInput', '안전관리관 작업허가 요청하기');
  await mobile.locator('#contextForm').evaluate((form) => form.requestSubmit());
  await mobile.waitForSelector('.todo-item.candidate');
  const candidateMobileBounds = await mobile.locator('#nextActionPanel').evaluate((node) => ({
    bottom: node.getBoundingClientRect().bottom,
    viewport: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert(candidateMobileBounds.bottom <= candidateMobileBounds.viewport, `candidate feedback pushed the next action below the first viewport (${candidateMobileBounds.bottom}px)`);
  assert(candidateMobileBounds.overflow <= 1, `candidate state overflows mobile horizontally by ${candidateMobileBounds.overflow}px`);
  await mobile.evaluate(() => localStorage.removeItem('jm-workbench-v1'));
  await mobile.goto(appUrl);
  const homeOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(homeOverflow <= 1, `mobile home overflows horizontally by ${homeOverflow}px`);
  assert(await mobile.isVisible('#resetSample'), 'mobile Home hides the sample reset control');

  const mobileDraft = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobileDraft.setDefaultTimeout(5000);
  await mobileDraft.goto(appUrl.replace('#home', '#draft/pump-2026'));
  await mobileDraft.waitForSelector('#view-draft.active');
  const mobileDraftLayout = await mobileDraft.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shellWidth: document.querySelector('.draft-shell').getBoundingClientRect().width,
    viewportWidth: innerWidth,
    backBottom: document.getElementById('draftBack').getBoundingClientRect().bottom,
    saveBottom: document.getElementById('draftSave').getBoundingClientRect().bottom,
  }));
  assert(mobileDraftLayout.overflow <= 1 && mobileDraftLayout.shellWidth <= mobileDraftLayout.viewportWidth, 'mobile draft overflows horizontally');
  assert(mobileDraftLayout.backBottom < 260 && mobileDraftLayout.saveBottom < 360, 'mobile draft hides navigation or save actions too far below the first screen');
  await mobileDraft.close();

  assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
  await browser.close();
  console.log('Work-item workbench browser flow passed.');
})().catch((error) => {
  console.error(`Work-item workbench browser flow failed: ${error.message}`);
  process.exit(1);
});
