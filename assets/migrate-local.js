(function(){
  const migrateBanner = document.getElementById('migrateBanner');
  const migrateStatus = document.getElementById('migrateStatus');
  const importBtn = document.getElementById('migrateImportBtn');
  const dismissBtn = document.getElementById('migrateDismissBtn');

  // Self-contained copy of the legacy (pre-Supabase) IndexedDB screenshot
  // store — the app itself no longer reads from IndexedDB, this is only
  // here so a user's old local screenshots can be pulled across once.
  const LEGACY_DB_NAME = 'work-log-db';
  const LEGACY_DB_STORE = 'screenshots';
  let legacyDbPromise = null;

  function openLegacyDb(){
    if(legacyDbPromise) return legacyDbPromise;
    legacyDbPromise = new Promise((resolve, reject)=>{
      const req = indexedDB.open(LEGACY_DB_NAME, 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore(LEGACY_DB_STORE, { keyPath: 'id' }); };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
    return legacyDbPromise;
  }

  async function getLegacyScreenshotBlob(id){
    const db = await openLegacyDb();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(LEGACY_DB_STORE, 'readonly');
      const req = tx.objectStore(LEGACY_DB_STORE).get(id);
      req.onsuccess = ()=> resolve(req.result ? req.result.blob : null);
      req.onerror = ()=> reject(req.error);
    });
  }

  let pendingOldEntries = [];
  let currentUserId = null;

  function setStatus(message, isError){
    migrateStatus.textContent = message;
    migrateStatus.style.color = isError ? 'var(--red)' : '';
  }

  function showBanner(count){
    migrateBanner.hidden = false;
    importBtn.disabled = false;
    importBtn.textContent = 'Import';
    setStatus('Found ' + count + ' local entr' + (count === 1 ? 'y' : 'ies') + ' from this browser. Import ' + (count === 1 ? 'it' : 'them') + ' into your account?', false);
  }

  function hideBanner(){
    migrateBanner.hidden = true;
  }

  async function importEntry(oldEntry, userId){
    const screenshots = [];
    for(const shot of (oldEntry.screenshots || [])){
      try{
        const blob = await getLegacyScreenshotBlob(shot.id);
        if(blob){
          const { error } = await supabaseClient.storage
            .from('screenshots')
            .upload(userId + '/' + shot.id, blob, { upsert: true });
          if(error) throw error;
        }
      }catch(e){
        // One bad screenshot shouldn't sink the whole entry — the
        // reference is kept so it's still visible it once had an attachment.
        console.error('Could not migrate screenshot', shot.id, e);
      }
      screenshots.push(shot);
    }

    const row = {
      id: crypto.randomUUID(),
      user_id: userId,
      date: oldEntry.date,
      date_display: oldEntry.dateDisplay,
      project: oldEntry.project,
      task: oldEntry.task,
      remark: oldEntry.remark || '',
      screenshots,
      urls: oldEntry.urls || [],
      start_ts: oldEntry.startTs,
      end_ts: oldEntry.endTs,
      start_time: oldEntry.start,
      end_time: oldEntry.end,
      total_ms: oldEntry.totalMs
    };
    const { error } = await supabaseClient.from('entries').insert(row);
    if(error) throw error;
  }

  async function runImport(entriesToImport){
    importBtn.disabled = true;
    setStatus('Importing ' + entriesToImport.length + ' entr' + (entriesToImport.length === 1 ? 'y' : 'ies') + '…', false);

    const failed = [];
    for(const oldEntry of entriesToImport){
      try{
        await importEntry(oldEntry, currentUserId);
      }catch(e){
        console.error('Could not import entry', oldEntry, e);
        failed.push(oldEntry);
      }
    }

    document.dispatchEvent(new CustomEvent('worklog:reload-entries'));
    importBtn.disabled = false;

    if(failed.length === 0){
      localStorage.setItem('work-log-migrated-' + currentUserId, '1');
      hideBanner();
    }else{
      pendingOldEntries = failed;
      importBtn.textContent = 'Retry ' + failed.length + ' failed';
      setStatus(failed.length + ' of ' + entriesToImport.length + ' entries failed to import. Check your connection and try again.', true);
    }
  }

  importBtn.addEventListener('click', ()=> runImport(pendingOldEntries));
  dismissBtn.addEventListener('click', hideBanner);

  function handleAuthChange(user){
    if(!user){
      currentUserId = null;
      hideBanner();
      return;
    }
    currentUserId = user.id;

    if(localStorage.getItem('work-log-migrated-' + user.id)){ hideBanner(); return; }

    let oldEntries;
    try{
      oldEntries = JSON.parse(localStorage.getItem('work-log-entries') || '[]');
    }catch(e){
      oldEntries = [];
    }
    if(!Array.isArray(oldEntries) || oldEntries.length === 0){ hideBanner(); return; }

    pendingOldEntries = oldEntries;
    showBanner(oldEntries.length);
  }

  document.addEventListener('worklog:auth-change', (e)=> handleAuthChange(e.detail.user));

  // Startup race: on a refresh with an already-valid session, auth.js's
  // initial dispatch can fire before this script has attached the listener
  // above — self-heal the same way script.js does, by checking whether the
  // sign-in already happened by the time we get here.
  if(window.WorkLogAuth && WorkLogAuth.currentUser){
    handleAuthChange(WorkLogAuth.currentUser);
  }
})();
