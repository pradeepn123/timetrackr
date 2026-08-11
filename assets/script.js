(function(){
  let entries = [];
  let timerState = null; // {startTs, project, task, remark, segmentStartTs, accumulatedMs}
  let tickHandle = null;

  // Project status is a property of the project itself (one row per
  // user+project name in the `projects` table), not of each logged entry —
  // changing it here updates what's shown for every entry under that project.
  const STATUS_META = {
    in_progress: { label: 'In Progress', cls: 'status-in_progress' },
    on_hold: { label: 'On Hold', cls: 'status-on_hold' },
    completed: { label: 'Completed', cls: 'status-completed' }
  };
  let projectsStatus = {}; // { [projectName]: 'in_progress' | 'on_hold' | 'completed' }

  const clockDisplay = document.getElementById('clockDisplay');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const projectInput = document.getElementById('project');
  const projectStatusSelect = document.getElementById('projectStatus');
  const taskInput = document.getElementById('task');
  const remarkInput = document.getElementById('remark');
  const deck = document.getElementById('deck');
  const hintText = document.getElementById('hintText');
  const tableWrap = document.getElementById('tableWrap');
  const totalLine = document.getElementById('totalLine');
  const projectDropdown = document.getElementById('projectDropdown');
  const statsRow = document.getElementById('statsRow');
  const yearFilter = document.getElementById('yearFilter');
  const monthFilter = document.getElementById('monthFilter');
  const screenshotInput = document.getElementById('screenshotInput');
  const screenshotPreview = document.getElementById('screenshotPreview');
  const urlInput = document.getElementById('urlInput');
  const addUrlBtn = document.getElementById('addUrlBtn');
  const urlChips = document.getElementById('urlChips');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalShots = document.getElementById('modalShots');
  const modalUrls = document.getElementById('modalUrls');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  // Persistence: plain localStorage, since this file is opened directly in a
  // real browser (no window.storage host API is available there).
  function storageGet(key){
    try{ return localStorage.getItem(key); }catch(e){ console.error('Storage read failed', e); return null; }
  }
  function storageSet(key, value){
    try{ localStorage.setItem(key, value); }catch(e){ console.error('Storage write failed', e); }
  }
  function storageRemove(key){
    try{ localStorage.removeItem(key); }catch(e){ console.error('Storage remove failed', e); }
  }

  // Screenshots live in the private Supabase Storage bucket "screenshots",
  // one folder per user (`${userId}/${screenshotId}`) — storage RLS policies
  // enforce that a user can only read/write objects under their own folder.
  const SCREENSHOT_BUCKET = 'screenshots';

  function screenshotPath(id){
    return WorkLogAuth.currentUser.id + '/' + id;
  }

  async function saveScreenshotBlob(id, blob){
    const { error } = await supabaseClient.storage
      .from(SCREENSHOT_BUCKET)
      .upload(screenshotPath(id), blob);
    if(error) throw error;
  }

  async function getScreenshotBlob(id){
    const { data, error } = await supabaseClient.storage
      .from(SCREENSHOT_BUCKET)
      .download(screenshotPath(id));
    if(error) return null;
    return data;
  }

  async function deleteScreenshotBlob(id){
    const { error } = await supabaseClient.storage
      .from(SCREENSHOT_BUCKET)
      .remove([screenshotPath(id)]);
    if(error) throw error;
  }

  async function clearAllScreenshotBlobs(){
    const userId = WorkLogAuth.currentUser.id;
    const { data, error } = await supabaseClient.storage.from(SCREENSHOT_BUCKET).list(userId);
    if(error) throw error;
    if(!data || data.length === 0) return;
    const paths = data.map(f => userId + '/' + f.name);
    const { error: removeError } = await supabaseClient.storage.from(SCREENSHOT_BUCKET).remove(paths);
    if(removeError) throw removeError;
  }

  // Pending attachments accumulate while a task is being filled in / timed,
  // and get attached to the entry once it's logged (see stopTimerInternal).
  let pendingScreenshots = []; // {id, file, previewUrl}
  let pendingUrls = [];

  function renderScreenshotPreview(){
    screenshotPreview.innerHTML = pendingScreenshots.map(s=>`
      <div class="thumb">
        <img src="${s.previewUrl}" alt="">
        <button type="button" data-remove="${s.id}" title="Remove">✕</button>
      </div>
    `).join('');
  }

  screenshotInput.addEventListener('change', (e)=>{
    const files = Array.from(e.target.files || []);
    files.forEach(file=>{
      const id = 'shot_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      pendingScreenshots.push({ id, file, previewUrl: URL.createObjectURL(file) });
    });
    e.target.value = '';
    renderScreenshotPreview();
  });

  screenshotPreview.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-remove]');
    if(!btn) return;
    const id = btn.getAttribute('data-remove');
    const idx = pendingScreenshots.findIndex(s=>s.id === id);
    if(idx > -1){
      URL.revokeObjectURL(pendingScreenshots[idx].previewUrl);
      pendingScreenshots.splice(idx, 1);
    }
    renderScreenshotPreview();
  });

  function renderUrlChips(){
    urlChips.innerHTML = pendingUrls.map((u,i)=>`
      <div class="url-chip">
        <span title="${escapeAttr(u)}">${escapeHtml(u)}</span>
        <button type="button" data-remove-url="${i}" title="Remove">✕</button>
      </div>
    `).join('');
  }

  function addPendingUrl(){
    let val = urlInput.value.trim();
    if(!val) return;
    if(!/^https?:\/\//i.test(val)) val = 'https://' + val;
    pendingUrls.push(val);
    urlInput.value = '';
    renderUrlChips();
  }
  addUrlBtn.addEventListener('click', addPendingUrl);
  urlInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); addPendingUrl(); }
  });
  urlChips.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-remove-url]');
    if(!btn) return;
    pendingUrls.splice(Number(btn.getAttribute('data-remove-url')), 1);
    renderUrlChips();
  });

  function clearPendingAttachments(){
    pendingScreenshots.forEach(s=> URL.revokeObjectURL(s.previewUrl));
    pendingScreenshots = [];
    pendingUrls = [];
    renderScreenshotPreview();
    renderUrlChips();
  }

  function pad(n){return n.toString().padStart(2,'0');}

  function fmtDate(d){
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }
  function fmtDisplayDate(d){
    return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
  }
  function fmtTime(d){
    let h = d.getHours(), m = pad(d.getMinutes());
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12; if(h===0) h = 12;
    return pad(h)+':'+m+' '+ampm;
  }
  function fmtDuration(ms){
    const totalSec = Math.floor(ms/1000);
    const h = Math.floor(totalSec/3600);
    const m = Math.floor((totalSec%3600)/60);
    return h + ':' + pad(m);
  }
  function fmtClock(ms){
    const totalSec = Math.floor(ms/1000);
    const h = pad(Math.floor(totalSec/3600));
    const m = pad(Math.floor((totalSec%3600)/60));
    const s = pad(totalSec%60);
    return h+':'+m+':'+s;
  }

  document.getElementById('todayLabel').textContent = fmtDisplayDate(new Date());

  // Maps a Supabase `entries` row (snake_case columns) to the in-memory
  // entry shape the rest of this file already works with (camelCase) —
  // this is the only boundary that needs to know about the DB schema.
  function mapRowToEntry(row){
    return {
      id: row.id,
      date: row.date,
      dateDisplay: row.date_display,
      project: row.project,
      task: row.task,
      remark: row.remark || '',
      screenshots: row.screenshots || [],
      urls: row.urls || [],
      startTs: row.start_ts,
      endTs: row.end_ts,
      start: row.start_time,
      end: row.end_time,
      totalMs: row.total_ms,
      isBreak: !!row.is_break
    };
  }

  function mapEntryToRow(entry){
    return {
      id: entry.id,
      user_id: WorkLogAuth.currentUser.id,
      date: entry.date,
      date_display: entry.dateDisplay,
      project: entry.project,
      task: entry.task,
      remark: entry.remark || '',
      screenshots: entry.screenshots || [],
      urls: entry.urls || [],
      start_ts: entry.startTs,
      end_ts: entry.endTs,
      start_time: entry.start,
      end_time: entry.end,
      total_ms: entry.totalMs,
      is_break: !!entry.isBreak
    };
  }

  async function loadEntries(){
    try{
      const { data, error } = await supabaseClient
        .from('entries')
        .select('*')
        .order('start_ts', { ascending: false });
      if(error) throw error;
      entries = (data || []).map(mapRowToEntry);
    }catch(e){
      console.error('Could not load entries', e);
      entries = [];
    }
    renderTable();
  }

  async function loadProjectsStatus(){
    try{
      const { data, error } = await supabaseClient.from('projects').select('name, status');
      if(error) throw error;
      projectsStatus = {};
      (data || []).forEach(row => { projectsStatus[row.name] = row.status; });
    }catch(e){
      console.error('Could not load project statuses', e);
      projectsStatus = {};
    }
  }

  function syncStatusSelectToProject(){
    const name = projectInput.value.trim();
    projectStatusSelect.value = (name && projectsStatus[name]) || 'in_progress';
  }

  async function saveProjectStatus(name, status){
    if(!name) return;
    try{
      const { error } = await supabaseClient
        .from('projects')
        .upsert({ user_id: WorkLogAuth.currentUser.id, name, status }, { onConflict: 'user_id,name' });
      if(error) throw error;
      projectsStatus[name] = status;
      renderTable(); // reflect the change on every entry row under this project
    }catch(e){
      console.error('Could not save project status', e);
    }
  }

  projectStatusSelect.addEventListener('change', ()=>{
    saveProjectStatus(projectInput.value.trim(), projectStatusSelect.value);
  });

  async function loadTimerState(){
    try{
      const raw = storageGet('work-log-active-timer');
      if(raw){
        timerState = JSON.parse(raw);
        // A refresh happened while a timer was active — just restore it
        // exactly as it was (running or paused) and keep going. No entry is
        // logged here; only pressing Stop logs an entry.
        projectInput.value = timerState.project;
        taskInput.value = timerState.task;
        remarkInput.value = timerState.remark || '';
        setRunningUI(true, timerState.isBreak);
        if(timerState.segmentStartTs != null){
          startTick();
        }else{
          deck.classList.add('paused');
          pauseTick();
          hintText.textContent = (timerState.isBreak ? 'Break paused at ' : 'Timer paused at ') + fmtClock(timerState.accumulatedMs) + '. Click anywhere to log it and start a new one.';
        }
      }
    }catch(e){ /* no active timer */ }
  }

  async function saveTimerState(){
    if(timerState){
      storageSet('work-log-active-timer', JSON.stringify(timerState));
    }else{
      storageRemove('work-log-active-timer');
    }
  }

  function setRunningUI(isRunning, isBreak){
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    lunchBreakBtn.disabled = isRunning && isBreak; // can't start a break while already on one
    teaBreakBtn.disabled = isRunning && isBreak;
    projectInput.disabled = isRunning;
    projectStatusSelect.disabled = isRunning;
    taskInput.disabled = isRunning;
    remarkInput.disabled = isRunning;
    deck.classList.toggle('running', isRunning);
    deck.classList.toggle('on-break', isRunning && !!isBreak);
    hintText.textContent = isRunning
      ? (isBreak ? 'On "' + timerState.task + '" — press Stop when you\'re back.' : 'Timer running — press Stop when you finish this task.')
      : 'Enter a project and task, then press Start. Stopping logs the entry below automatically.';
  }

  // Elapsed time = time accumulated from earlier active segments, plus time
  // in the segment currently running (if any). While paused, segmentStartTs
  // is null, so the clock simply stops advancing instead of resetting —
  // resuming starts a new segment from "now" without losing what's counted.
  function currentElapsedMs(){
    if(!timerState) return 0;
    return timerState.accumulatedMs + (timerState.segmentStartTs != null ? Date.now() - timerState.segmentStartTs : 0);
  }

  // Office hours end at 8:00 pm — any timer (task or break) still running at
  // that point gets logged and stopped automatically, clipped to end exactly
  // at the cutoff rather than whenever this check happens to notice.
  const OFFICE_END_HOUR = 20;

  function officeCutoffTsFor(ts){
    const d = new Date(ts);
    d.setHours(OFFICE_END_HOUR, 0, 0, 0);
    return d.getTime();
  }

  async function enforceOfficeHoursCutoff(){
    if(!timerState) return;
    const cutoff = officeCutoffTsFor(timerState.startTs);
    if(Date.now() < cutoff) return;
    const wasBreak = timerState.isBreak;
    if(timerState.segmentStartTs != null){
      const segmentEnd = Math.min(Date.now(), cutoff);
      timerState.accumulatedMs += segmentEnd - timerState.segmentStartTs;
      timerState.segmentStartTs = null;
    }
    await stopTimerInternal(cutoff);
    hintText.textContent = 'Office hours ended at 8:00 pm — ' + (wasBreak ? 'your break' : 'this task') + ' was logged and stopped automatically.';
    hintText.style.color = '';
  }

  function refreshClockDisplay(){
    clockDisplay.textContent = fmtClock(currentElapsedMs());
    enforceOfficeHoursCutoff();
  }

  function startTick(){
    if(tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(refreshClockDisplay, 1000);
    refreshClockDisplay();
  }

  function pauseTick(){
    if(tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    refreshClockDisplay(); // freeze the display at the accumulated value
  }

  function stopTick(){
    if(tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    clockDisplay.textContent = '00:00:00';
  }

  async function beginTimer(project, task, remark, isBreak){
    const now = Date.now();
    timerState = { startTs: now, project, task, remark, segmentStartTs: now, accumulatedMs: 0, isBreak: !!isBreak };
    setRunningUI(true, isBreak);
    startTick();
    await saveTimerState();
    ensureIdleDetector();
    await enforceOfficeHoursCutoff(); // in case it's already past 8pm the moment this starts
  }

  startBtn.addEventListener('click', async ()=>{
    const project = projectInput.value.trim();
    const task = taskInput.value.trim();
    const remark = remarkInput.value.trim();
    if(!project || !task){
      hintText.textContent = 'Add both a project and a task description before starting.';
      hintText.style.color = 'var(--red)';
      return;
    }
    hintText.style.color = '';
    hideProjectDropdown();
    if(!projectsStatus[project]) await saveProjectStatus(project, projectStatusSelect.value);
    await beginTimer(project, task, remark, false);
  });

  const lunchBreakBtn = document.getElementById('lunchBreakBtn');
  const teaBreakBtn = document.getElementById('teaBreakBtn');

  async function startBreak(label){
    if(timerState && !timerState.isBreak){
      await stopTimerInternal(); // log whatever task was running before starting the break
    }
    if(!timerState){
      await beginTimer('Break', label, '', true);
    }
  }

  lunchBreakBtn.addEventListener('click', ()=> startBreak('Lunch Break'));
  teaBreakBtn.addEventListener('click', ()=> startBreak('Tea Break'));

  function getUniqueProjects(){
    return [...new Set(entries.map(e=>e.project))];
  }

  function showProjectDropdown(){
    const all = getUniqueProjects();
    if(all.length <= 1){ hideProjectDropdown(); return; }
    const filter = projectInput.value.trim().toLowerCase();
    const matches = filter ? all.filter(p=>p.toLowerCase().includes(filter)) : all;
    if(matches.length === 0){ hideProjectDropdown(); return; }
    projectDropdown.innerHTML = matches.map(p=>`<div data-project="${escapeAttr(p)}">${escapeHtml(p)}</div>`).join('');
    projectDropdown.hidden = false;
  }

  function hideProjectDropdown(){
    projectDropdown.hidden = true;
    projectDropdown.innerHTML = '';
  }

  projectInput.addEventListener('focus', showProjectDropdown);
  projectInput.addEventListener('input', showProjectDropdown);
  projectInput.addEventListener('blur', ()=>{
    setTimeout(hideProjectDropdown, 150);
    syncStatusSelectToProject();
  });
  projectDropdown.addEventListener('mousedown', (e)=>{
    e.preventDefault();
    const target = e.target.closest('[data-project]');
    if(!target) return;
    projectInput.value = target.getAttribute('data-project');
    hideProjectDropdown();
    syncStatusSelectToProject();
  });

  async function stopTimerInternal(endTsOverride){
    if(!timerState) return;
    const endTs = endTsOverride != null ? endTsOverride : Date.now();
    const startDate = new Date(timerState.startTs);
    const endDate = new Date(endTs);
    const totalMs = currentElapsedMs(); // excludes any paused (screen-off) intervals
    const { project, task, remark, startTs, isBreak } = timerState;

    // Finalize state synchronously (before any await) so a concurrent event —
    // e.g. the click-anywhere resume listener firing while the screenshot
    // upload below is in flight — can't see a stale "still running/paused"
    // timerState and incorrectly resume it mid-stop.
    timerState = null;
    stopTick();
    deck.classList.remove('paused');
    setRunningUI(false);

    const screenshots = [];
    for(const shot of pendingScreenshots){
      try{
        await saveScreenshotBlob(shot.id, shot.file);
        screenshots.push({ id: shot.id, name: shot.file.name });
      }catch(e){ console.error('Could not save screenshot', e); }
    }
    const urls = [...pendingUrls];
    clearPendingAttachments();

    const entry = {
      id: crypto.randomUUID(),
      date: fmtDate(startDate),
      dateDisplay: fmtDisplayDate(startDate),
      project,
      task,
      remark: remark || '',
      screenshots,
      urls,
      startTs,
      endTs,
      start: fmtTime(startDate),
      end: fmtTime(endDate),
      totalMs,
      isBreak: !!isBreak
    };
    try{
      const { data, error } = await supabaseClient
        .from('entries')
        .insert(mapEntryToRow(entry))
        .select()
        .single();
      if(error) throw error;
      entries.push(mapRowToEntry(data));
    }catch(e){
      console.error('Could not save entry', e);
      hintText.textContent = 'Could not save this entry — check your connection and try again.';
      hintText.style.color = 'var(--red)';
    }
    await saveTimerState(); // timerState is already null here, so this clears storage
    renderTable();
  }

  // Only worth recording as its own entry past a minimum length — a quick
  // tab switch or accidental click shouldn't clutter the log with a
  // 2-second "break".
  const MIN_BREAK_MS = 30 * 1000;

  // Writes a standalone break entry directly (no timerState involved) — used
  // to represent a screen-off gap after the fact, once we're already back.
  async function logBreakEntry(task, startTs, endTs){
    if(endTs - startTs < MIN_BREAK_MS) return;
    const startDate = new Date(startTs);
    const endDate = new Date(endTs);
    const entry = {
      id: crypto.randomUUID(),
      date: fmtDate(startDate),
      dateDisplay: fmtDisplayDate(startDate),
      project: 'Break',
      task,
      remark: '',
      screenshots: [],
      urls: [],
      startTs,
      endTs,
      start: fmtTime(startDate),
      end: fmtTime(endDate),
      totalMs: endTs - startTs,
      isBreak: true
    };
    try{
      const { data, error } = await supabaseClient
        .from('entries')
        .insert(mapEntryToRow(entry))
        .select()
        .single();
      if(error) throw error;
      entries.push(mapRowToEntry(data));
      renderTable();
    }catch(e){
      console.error('Could not log break entry', e);
    }
  }

  stopBtn.addEventListener('click', async ()=>{
    if(!timerState) return;
    await stopTimerInternal();
    projectInput.value = '';
    taskInput.value = '';
    remarkInput.value = '';
  });

  // Screen lock/off detection. Two layers:
  //  1) Idle Detection API — precise (reports actual OS lock state, ignores
  //     tab switches) but Chrome/Edge only, and needs a granted permission.
  //     Safari and Firefox don't implement it at all: `IdleDetector` is
  //     simply undefined there, so this layer silently does nothing.
  //  2) Page Visibility API fallback — works in every browser. Locking the
  //     screen reliably makes the page "hidden" everywhere, so this is used
  //     whenever the Idle Detection API isn't active. Its trade-off is that
  //     switching tabs/apps also counts as "hidden".
  // On top of both, clicking anywhere after the screen comes back on is a
  // safety net that logs/restarts the timer even if the automatic handling
  // missed.
  //
  // Screen-off only freezes the clock locally (accumulatedMs/segmentStartTs,
  // a synchronous localStorage write) — it deliberately does NOT touch the
  // network. Mobile OSes commonly suspend a locked screen's tab within a
  // second or two, which was cutting off the Supabase insert/upload before
  // it could finish (entries silently failing to log). Instead, the actual
  // logging happens at screen-ON, when the tab is guaranteed to be running
  // and online: the frozen segment is saved as its own finished entry
  // (ending at the moment the screen went off, not "now"), and a brand-new
  // timer starts for the same task from the moment the screen came back on.
  // The gap between off and on is never counted in either entry — i.e. it's
  // treated as a break.
  let idleDetector = null;
  let idlePermissionRequested = false;
  let usingIdleDetector = false;

  // A page refresh/navigation also fires visibilitychange(hidden) right
  // before the page tears down — indistinguishable from a real screen lock
  // by that event alone. beforeunload/pagehide fire earlier in that specific
  // sequence, so flagging them lets the visibilitychange handler below tell
  // "actually leaving the page" apart from "screen locked" and skip pausing.
  let isUnloading = false;
  window.addEventListener('beforeunload', ()=>{ isUnloading = true; });
  window.addEventListener('pagehide', ()=>{ isUnloading = true; });

  async function pauseForScreenOff(reason){
    if(!timerState || timerState.segmentStartTs == null) return; // nothing running to pause
    timerState.accumulatedMs += Date.now() - timerState.segmentStartTs;
    timerState.segmentStartTs = null;
    timerState.pausedAt = Date.now(); // the real "end time" of this segment, used when we log it at resume
    pauseTick();
    deck.classList.add('paused');
    hintText.textContent = 'Timer paused at ' + fmtClock(timerState.accumulatedMs) + ' — screen ' + reason + '. This task will be logged and a new one started once the screen is back on.';
    await saveTimerState();
  }

  async function resumeForScreenOn(){
    if(!timerState || timerState.segmentStartTs !== null) return; // not paused
    const { project, task, remark, pausedAt, isBreak } = timerState;
    const screenOnAt = Date.now();
    await stopTimerInternal(pausedAt); // logs the frozen segment, ending at the actual screen-off moment

    if(!isBreak){
      // The screen-off gap itself becomes its own visible Break entry, so the
      // log clearly shows why there's a hole between this task and the next
      // — it wasn't already a break, so there's nothing else representing it.
      await logBreakEntry('Screen off', pausedAt, screenOnAt);
    }

    projectInput.value = project;
    taskInput.value = task;
    remarkInput.value = remark;
    await beginTimer(project, task, remark, isBreak);
    hintText.textContent = isBreak
      ? 'Screen back on — resumed your break.'
      : 'Screen back on — logged the previous segment (with a break for the time the screen was off) and started a new timer for "' + task + '".';
  }

  async function ensureIdleDetector(){
    if(idleDetector || !('IdleDetector' in window)) return;
    try{
      if(!idlePermissionRequested){
        idlePermissionRequested = true;
        const state = await IdleDetector.requestPermission();
        if(state !== 'granted') return;
      }
      idleDetector = new IdleDetector();
      idleDetector.addEventListener('change', onIdleChange);
      await idleDetector.start({ threshold: 60000 });
      usingIdleDetector = true;
    }catch(e){
      console.warn('Idle Detection API unavailable, using tab-visibility fallback instead:', e);
    }
  }

  async function onIdleChange(){
    const screenState = idleDetector.screenState; // 'locked' | 'unlocked'
    if(screenState === 'locked') await pauseForScreenOff('was locked');
    else if(screenState === 'unlocked') await resumeForScreenOn();
  }

  document.addEventListener('visibilitychange', async ()=>{
    if(usingIdleDetector) return; // handled more precisely by the Idle Detection API instead
    if(isUnloading) return; // this hidden event is from a refresh/navigation, not a real screen lock
    if(document.hidden) await pauseForScreenOff('turned off');
    else await resumeForScreenOn();
  });

  // Fallback restart trigger: clicking anywhere restarts an auto-stopped
  // timer if it hasn't already restarted automatically.
  document.addEventListener('click', ()=>{ resumeForScreenOn(); });

  async function deleteEntry(id){
    const entry = entries.find(e=>e.id === id);
    if(entry && entry.screenshots){
      for(const s of entry.screenshots){
        try{ await deleteScreenshotBlob(s.id); }catch(e){ /* ignore */ }
      }
    }
    try{
      const { error } = await supabaseClient.from('entries').delete().eq('id', id);
      if(error) throw error;
      entries = entries.filter(e=>e.id !== id);
    }catch(e){
      console.error('Could not delete entry', e);
      alert('Could not delete this entry — check your connection and try again.');
    }
    renderTable();
  }

  document.getElementById('clearBtn').addEventListener('click', async ()=>{
    if(entries.length === 0) return;
    if(!confirm('Clear all logged entries? This cannot be undone.')) return;
    try{ await clearAllScreenshotBlobs(); }catch(e){ console.error('Could not clear screenshots', e); }
    try{
      const { error } = await supabaseClient
        .from('entries')
        .delete()
        .eq('user_id', WorkLogAuth.currentUser.id);
      if(error) throw error;
      entries = [];
    }catch(e){
      console.error('Could not clear entries', e);
      alert('Could not clear entries — check your connection and try again.');
    }
    renderTable();
  });

  // Screenshots live in a private Storage bucket, so there's no public URL
  // to just drop into the spreadsheet — a signed URL has to be minted per
  // screenshot at export time. 7 days gives plenty of time to actually open
  // the exported file without the links going stale immediately.
  const SCREENSHOT_LINK_TTL_SECONDS = 60 * 60 * 24 * 7;

  async function getScreenshotLinksText(screenshots){
    if(!screenshots || screenshots.length === 0) return '';
    const userId = WorkLogAuth.currentUser.id;
    const links = [];
    for(const s of screenshots){
      try{
        const { data, error } = await supabaseClient.storage
          .from('screenshots')
          .createSignedUrl(userId + '/' + s.id, SCREENSHOT_LINK_TTL_SECONDS);
        if(error) throw error;
        links.push((s.name || 'screenshot') + ': ' + data.signedUrl);
      }catch(e){
        console.error('Could not create signed URL for screenshot', s.id, e);
        links.push((s.name || 'screenshot') + ': (link unavailable)');
      }
    }
    return links.join('\n');
  }

  const HEADER_FILL = 'FF1B5E20';
  const BREAK_FILL = 'FFD6D6D6';
  const PROJECT_COLOR_PALETTE = ['FFA8E6E6','FFB8E6B0','FFFFD9A8','FFE0E6A8','FFD5B8F0','FFF0B8D0','FFB8D0F0'];
  const THIN_BORDER = { style: 'thin', color: { argb: 'FFB0B0B0' } };
  const CELL_BORDER = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

  function colorForProject(project){
    let hash = 0;
    for(let i = 0; i < project.length; i++){
      hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
    }
    return PROJECT_COLOR_PALETTE[hash % PROJECT_COLOR_PALETTE.length];
  }

  async function buildWorkbook(){
    const sorted = [...entries].sort((a,b)=> a.startTs - b.startTs);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Work Log');
    sheet.columns = [
      { header: '#', key: 'num', width: 6 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Start Time', key: 'start', width: 12 },
      { header: 'Project', key: 'project', width: 20 },
      { header: 'Project Status', key: 'projectStatus', width: 14 },
      { header: 'Work/Task Description', key: 'task', width: 45 },
      { header: 'End Time', key: 'end', width: 12 },
      { header: 'Duration', key: 'duration', width: 10 },
      { header: 'Entry Type', key: 'status', width: 12 },
      { header: 'Remark', key: 'remark', width: 30 },
      { header: 'Screenshots', key: 'screenshots', width: 50 },
      { header: 'URLs', key: 'urls', width: 30 }
    ];

    sheet.getRow(1).eachCell(cell=>{
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = CELL_BORDER;
    });

    let previousDate = null;
    let groupStartRow = null;
    const dateGroups = [];

    for(let i = 0; i < sorted.length; i++){
      const e = sorted[i];
      const rowNumber = i + 2; // row 1 is the header
      const showDate = e.dateDisplay !== previousDate;
      if(showDate){
        if(groupStartRow != null) dateGroups.push([groupStartRow, rowNumber - 1]);
        groupStartRow = rowNumber;
      }
      previousDate = e.dateDisplay;

      const row = sheet.addRow({
        num: i + 1,
        date: showDate ? e.dateDisplay : '',
        start: e.start,
        project: e.project,
        projectStatus: e.isBreak ? '' : (STATUS_META[projectsStatus[e.project] || 'in_progress'].label),
        task: e.task,
        end: e.end,
        duration: fmtDuration(e.totalMs),
        status: e.isBreak ? 'Break' : '',
        remark: e.remark || '',
        screenshots: await getScreenshotLinksText(e.screenshots),
        urls: (e.urls || []).join(', ')
      });

      row.eachCell(cell=>{
        cell.border = CELL_BORDER;
        cell.alignment = { vertical: 'top', wrapText: true };
        if(e.isBreak) cell.font = { italic: true, color: { argb: 'FF707070' } };
      });

      const projectCell = row.getCell('project');
      projectCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: e.isBreak ? BREAK_FILL : colorForProject(e.project) } };
      projectCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    if(groupStartRow != null) dateGroups.push([groupStartRow, sorted.length + 1]);

    dateGroups.forEach(([start, end])=>{
      if(end > start){
        sheet.mergeCells(start, 2, end, 2);
        sheet.getCell(start, 2).alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });

    return workbook;
  }

  async function downloadWorkbook(workbook, filename){
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const exportBtn = document.getElementById('exportBtn');
  const googleSheetsBtn = document.getElementById('googleSheetsBtn');

  exportBtn.addEventListener('click', async ()=>{
    if(entries.length === 0) return;
    exportBtn.disabled = true;
    try{
      await downloadWorkbook(await buildWorkbook(), 'work-log.xlsx');
    }finally{
      exportBtn.disabled = false;
    }
  });

  googleSheetsBtn.addEventListener('click', async ()=>{
    if(entries.length === 0) return;
    googleSheetsBtn.disabled = true;
    try{
      await downloadWorkbook(await buildWorkbook(), 'work-log.xlsx');
      window.open('https://docs.google.com/spreadsheets/u/0/create', '_blank', 'noopener');
      alert('"work-log.xlsx" was downloaded, and a blank Google Sheet just opened in a new tab.\n\nIn that tab: File → Import → Upload, then choose the downloaded file.');
    }finally{
      googleSheetsBtn.disabled = false;
    }
  });

  // --- Month/year filtering + dashboard stats ---
  let filterYear = 'all';
  let filterMonth = 'all';
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function entryYear(e){ return e.date.slice(0,4); }
  function entryMonth(e){ return e.date.slice(5,7); }

  function getFilteredEntries(){
    return entries.filter(e=>{
      if(filterYear !== 'all' && entryYear(e) !== filterYear) return false;
      if(filterMonth !== 'all' && entryMonth(e) !== filterMonth) return false;
      return true;
    });
  }

  function populateFilters(){
    const years = new Set(entries.map(entryYear));
    years.add(String(new Date().getFullYear()));
    const sortedYears = [...years].sort((a,b)=> Number(b) - Number(a));
    if(!sortedYears.includes(filterYear)) filterYear = 'all';
    yearFilter.innerHTML = '<option value="all">All years</option>' +
      sortedYears.map(y=>`<option value="${y}">${y}</option>`).join('');
    yearFilter.value = filterYear;

    if(!monthFilter.dataset.built){
      monthFilter.innerHTML = '<option value="all">All months</option>' +
        MONTH_NAMES.map((name,idx)=>`<option value="${pad(idx+1)}">${name}</option>`).join('');
      monthFilter.dataset.built = '1';
    }
    monthFilter.value = filterMonth;
  }

  yearFilter.addEventListener('change', ()=>{ filterYear = yearFilter.value; renderTable(); });
  monthFilter.addEventListener('change', ()=>{ filterMonth = monthFilter.value; renderTable(); });

  function computeStats(){
    const now = new Date();
    const todayStr = fmtDate(now);
    const curYear = String(now.getFullYear());
    const curMonth = pad(now.getMonth()+1);
    let todayMs=0, todayCount=0, monthMs=0, monthCount=0, yearMs=0, yearCount=0, allMs=0, allCount=0;
    let todayBreakMs=0;
    const projectTotals = {};

    entries.forEach(e=>{
      if(e.isBreak){
        if(e.date === todayStr) todayBreakMs += e.totalMs;
        return; // breaks are tracked separately, not counted as worked time
      }
      allMs += e.totalMs;
      allCount++;
      projectTotals[e.project] = (projectTotals[e.project]||0) + e.totalMs;
      if(e.date === todayStr){ todayMs += e.totalMs; todayCount++; }
      if(entryYear(e) === curYear){
        yearMs += e.totalMs; yearCount++;
        if(entryMonth(e) === curMonth){ monthMs += e.totalMs; monthCount++; }
      }
    });

    const projectCount = Object.keys(projectTotals).length;
    return { todayMs, todayCount, monthMs, monthCount, yearMs, yearCount, allMs, allCount, projectCount, todayBreakMs };
  }

  function renderStats(){
    const s = computeStats();
    const tile = (label, value, sub) => `<div class="stat-tile">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
    const todaySub = s.todayCount + ' entr' + (s.todayCount===1?'y':'ies') +
      (s.todayBreakMs > 0 ? ' · ' + fmtDuration(s.todayBreakMs) + ' break' : '');
    statsRow.innerHTML =
      tile('Today', fmtDuration(s.todayMs), todaySub) +
      tile('This Month', fmtDuration(s.monthMs), s.monthCount + ' entr' + (s.monthCount===1?'y':'ies')) +
      tile('This Year', fmtDuration(s.yearMs), s.yearCount + ' entr' + (s.yearCount===1?'y':'ies')) +
      tile('All Time', fmtDuration(s.allMs), s.allCount + ' entr' + (s.allCount===1?'y':'ies') + ' · ' + s.projectCount + ' project' + (s.projectCount===1?'':'s'));
  }

  function renderTable(){
    renderStats();
    populateFilters();

    if(entries.length === 0){
      tableWrap.innerHTML = '<div class="empty">No entries yet. Start the timer above to begin your log.</div>';
      totalLine.textContent = '';
      return;
    }

    const filtered = getFilteredEntries();
    if(filtered.length === 0){
      tableWrap.innerHTML = '<div class="empty">No entries for this period. Try a different month or year.</div>';
      totalLine.textContent = '';
      return;
    }

    const sorted = [...filtered].sort((a,b)=>b.startTs - a.startTs);
    let totalMs = 0;
    let breakMs = 0;
    const rows = sorted.map((e,i)=>{
      if(e.isBreak) breakMs += e.totalMs; else totalMs += e.totalMs;
      const shotCount = (e.screenshots && e.screenshots.length) || 0;
      const urlCount = (e.urls && e.urls.length) || 0;
      const parts = [];
      if(shotCount) parts.push(shotCount + ' img');
      if(urlCount) parts.push(urlCount + ' link' + (urlCount===1?'':'s'));
      const attachCell = parts.length
        ? `<button type="button" class="view-attach" data-id="${e.id}">${parts.join(', ')}</button>`
        : `<span class="none">—</span>`;
      const projectLabel = e.isBreak ? '☕ ' + escapeHtml(e.project) : escapeHtml(e.project);
      const breakTypeCell = e.isBreak ? escapeHtml(e.task) : `<span class="none">—</span>`;
      const statusMeta = e.isBreak ? null : STATUS_META[projectsStatus[e.project] || 'in_progress'];
      const statusCell = statusMeta
        ? `<span class="status-badge ${statusMeta.cls}">${statusMeta.label}</span>`
        : `<span class="none">—</span>`;
      return `<tr${e.isBreak ? ' class="break-row"' : ''}>
        <td class="num">${i+1}</td>
        <td class="time">${escapeHtml(e.dateDisplay)}</td>
        <td>${projectLabel}</td>
        <td>${statusCell}</td>
        <td>${breakTypeCell}</td>
        <td>${escapeHtml(e.task)}</td>
        <td>${escapeHtml(e.remark || '')}</td>
        <td class="attach">${attachCell}</td>
        <td class="time">${escapeHtml(e.start)}</td>
        <td class="time">${escapeHtml(e.end)}</td>
        <td class="total">${fmtDuration(e.totalMs)}</td>
        <td class="del"><button title="Delete entry" data-id="${e.id}">✕</button></td>
      </tr>`;
    }).join('');
    tableWrap.innerHTML = `<table>
      <thead><tr>
        <th>#</th><th>Date</th><th>Project</th><th>Status</th><th>Break Type</th><th>Task Description</th><th>Remark</th><th>Attachments</th>
        <th>Start</th><th>End</th><th>Total</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    const filterNote = filtered.length !== entries.length ? ' (filtered)' : '';
    const breakNote = breakMs > 0 ? ' + ' + fmtDuration(breakMs) + ' break' : '';
    totalLine.innerHTML = 'Showing: <strong>' + fmtDuration(totalMs) + '</strong>' + breakNote + ' across ' + filtered.length + ' entr' + (filtered.length===1?'y':'ies') + filterNote;

    tableWrap.querySelectorAll('td.del button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!confirm('Delete this entry? This cannot be undone.')) return;
        deleteEntry(btn.getAttribute('data-id'));
      });
    });
    tableWrap.querySelectorAll('.view-attach').forEach(btn=>{
      btn.addEventListener('click', ()=> openAttachmentModal(btn.getAttribute('data-id')));
    });
  }

  function escapeHtml(s){
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function escapeAttr(s){
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  let modalObjectUrls = [];

  function closeAttachmentModal(){
    modalOverlay.hidden = true;
    modalObjectUrls.forEach(u=> URL.revokeObjectURL(u));
    modalObjectUrls = [];
    modalShots.innerHTML = '';
    modalUrls.innerHTML = '';
  }
  modalCloseBtn.addEventListener('click', closeAttachmentModal);
  modalOverlay.addEventListener('click', (e)=>{ if(e.target === modalOverlay) closeAttachmentModal(); });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && !modalOverlay.hidden) closeAttachmentModal();
  });

  async function openAttachmentModal(entryId){
    const entry = entries.find(e=>e.id === entryId);
    if(!entry) return;
    modalShots.innerHTML = '';
    modalUrls.innerHTML = (entry.urls || []).map(u=>
      `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a>`
    ).join('') || (entry.screenshots && entry.screenshots.length ? '' : '<div class="modal-empty">No attachments for this entry.</div>');
    modalOverlay.hidden = false;

    for(const s of (entry.screenshots || [])){
      try{
        const blob = await getScreenshotBlob(s.id);
        if(!blob) continue;
        const url = URL.createObjectURL(blob);
        modalObjectUrls.push(url);
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = url; img.alt = s.name || '';
        a.appendChild(img);
        modalShots.appendChild(a);
      }catch(e){ console.error('Could not load screenshot', e); }
    }
  }

  function resetAppState(){
    entries = [];
    timerState = null;
    projectsStatus = {};
    stopTick();
    deck.classList.remove('running', 'paused');
    projectInput.value = '';
    projectStatusSelect.value = 'in_progress';
    taskInput.value = '';
    remarkInput.value = '';
    setRunningUI(false);
    renderTable();
  }

  document.addEventListener('worklog:auth-change', (e)=>{
    if(e.detail.user){
      Promise.all([loadEntries(), loadProjectsStatus()]).then(loadTimerState);
    }else{
      resetAppState();
    }
  });

  // Startup race: on a refresh with an already-valid session, auth.js's
  // initial "still logged in" check can resolve (and dispatch the event
  // above) before this script has even finished loading and attached the
  // listener — the signal fires into empty air and gets missed, silently
  // leaving entries unloaded. WorkLogAuth.currentUser is set synchronously
  // as part of that same dispatch, so if it's already populated by the time
  // we get here, we know we missed it and load directly instead of waiting
  // for an event that already happened.
  if(window.WorkLogAuth && WorkLogAuth.currentUser){
    Promise.all([loadEntries(), loadProjectsStatus()]).then(loadTimerState);
  }

  // Fired by migrate-local.js after it's pushed local entries into Supabase,
  // so the table reflects them without waiting for a manual refresh.
  document.addEventListener('worklog:reload-entries', ()=>{ loadEntries(); });
})();
