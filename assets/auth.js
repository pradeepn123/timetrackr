(function(){
  const authPanel = document.getElementById('authPanel');
  const authedContent = document.getElementById('authedContent');
  const userStatus = document.getElementById('userStatus');
  const userEmail = document.getElementById('userEmail');
  const logoutBtn = document.getElementById('logoutBtn');

  const authTabs = document.getElementById('authTabs');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const authHeading = document.getElementById('authHeading');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const forgotForm = document.getElementById('forgotForm');
  const newPasswordForm = document.getElementById('newPasswordForm');
  const authHint = document.getElementById('authHint');

  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const togglePassword = document.getElementById('togglePassword');
  const loginBtn = document.getElementById('loginBtn');
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');

  const authFirstName = document.getElementById('authFirstName');
  const authLastName = document.getElementById('authLastName');
  const authSignupEmail = document.getElementById('authSignupEmail');
  const authSignupPassword = document.getElementById('authSignupPassword');
  const toggleSignupPassword = document.getElementById('toggleSignupPassword');
  const signupBtn = document.getElementById('signupBtn');

  const resetEmail = document.getElementById('resetEmail');
  const sendResetBtn = document.getElementById('sendResetBtn');
  const backToSignInBtn = document.getElementById('backToSignInBtn');

  const newPassword = document.getElementById('newPassword');
  const toggleNewPassword = document.getElementById('toggleNewPassword');
  const setNewPasswordBtn = document.getElementById('setNewPasswordBtn');

  window.WorkLogAuth = { currentUser: null };

  function setAuthHint(message, isError){
    authHint.textContent = message;
    authHint.style.color = isError ? 'var(--red)' : '';
  }

  function setMode(mode){
    tabSignIn.classList.toggle('active', mode === 'signin');
    tabSignUp.classList.toggle('active', mode === 'signup');
    authTabs.hidden = (mode === 'forgot' || mode === 'newpassword');
    authHeading.hidden = (mode === 'forgot' || mode === 'newpassword');
    signInForm.hidden = mode !== 'signin';
    signUpForm.hidden = mode !== 'signup';
    forgotForm.hidden = mode !== 'forgot';
    newPasswordForm.hidden = mode !== 'newpassword';
    if(mode === 'signin'){
      authTitle.textContent = 'Welcome back';
      authSubtitle.textContent = 'Log in to keep tracking your work.';
    }else if(mode === 'signup'){
      authTitle.textContent = 'Create your account';
      authSubtitle.textContent = 'Sign up to start your own private work log.';
    }
    setAuthHint('', false);
  }

  tabSignIn.addEventListener('click', ()=> setMode('signin'));
  tabSignUp.addEventListener('click', ()=> setMode('signup'));
  forgotPasswordBtn.addEventListener('click', ()=>{
    resetEmail.value = authEmail.value;
    setMode('forgot');
  });
  backToSignInBtn.addEventListener('click', ()=> setMode('signin'));

  function wireShowHide(toggleBtn, input){
    toggleBtn.addEventListener('click', ()=>{
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggleBtn.textContent = showing ? 'Show' : 'Hide';
    });
  }
  wireShowHide(togglePassword, authPassword);
  wireShowHide(toggleSignupPassword, authSignupPassword);
  wireShowHide(toggleNewPassword, newPassword);

  function setAuthedUI(user){
    window.WorkLogAuth.currentUser = user;
    if(user){
      authPanel.hidden = true;
      authedContent.hidden = false;
      userStatus.hidden = false;
      const firstName = user.user_metadata && user.user_metadata.first_name;
      userEmail.textContent = firstName ? ('Hi, ' + firstName) : user.email;
    }else{
      authPanel.hidden = false;
      authedContent.hidden = true;
      userStatus.hidden = true;
      userEmail.textContent = '';
      setMode('signin');
      authEmail.value = '';
      authPassword.value = '';
      authFirstName.value = '';
      authLastName.value = '';
      authSignupEmail.value = '';
      authSignupPassword.value = '';
    }
    document.dispatchEvent(new CustomEvent('worklog:auth-change', { detail: { user } }));
  }

  loginBtn.addEventListener('click', async ()=>{
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if(!email || !password){
      setAuthHint('Enter both an email and a password.', true);
      return;
    }
    setAuthHint('Signing in…', false);
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error){
      setAuthHint(error.message, true);
      return;
    }
    authPassword.value = '';
  });

  signupBtn.addEventListener('click', async ()=>{
    const firstName = authFirstName.value.trim();
    const lastName = authLastName.value.trim();
    const email = authSignupEmail.value.trim();
    const password = authSignupPassword.value;
    if(!email || !password){
      setAuthHint('Enter both an email and a password.', true);
      return;
    }
    if(password.length < 6){
      setAuthHint('Password must be at least 6 characters.', true);
      return;
    }
    setAuthHint('Creating account…', false);
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } }
    });
    if(error){
      setAuthHint(error.message, true);
      return;
    }
    if(!data.session){
      setAuthHint('Account created — check your email to confirm it, then sign in.', false);
    }
    authSignupPassword.value = '';
  });

  sendResetBtn.addEventListener('click', async ()=>{
    const email = resetEmail.value.trim();
    if(!email){
      setAuthHint('Enter your email first.', true);
      return;
    }
    setAuthHint('Sending reset link…', false);
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if(error){
      setAuthHint(error.message, true);
      return;
    }
    setAuthHint('Check your email for a link to reset your password.', false);
  });

  setNewPasswordBtn.addEventListener('click', async ()=>{
    const password = newPassword.value;
    if(!password || password.length < 6){
      setAuthHint('Password must be at least 6 characters.', true);
      return;
    }
    setAuthHint('Updating password…', false);
    const { error } = await supabaseClient.auth.updateUser({ password });
    if(error){
      setAuthHint(error.message, true);
      return;
    }
    newPassword.value = '';
    const { data } = await supabaseClient.auth.getSession();
    setAuthedUI(data.session ? data.session.user : null);
  });

  logoutBtn.addEventListener('click', async ()=>{
    await supabaseClient.auth.signOut();
  });

  [authEmail, authPassword].forEach(input=>{
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); loginBtn.click(); }
    });
  });
  [authFirstName, authLastName, authSignupEmail, authSignupPassword].forEach(input=>{
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); signupBtn.click(); }
    });
  });

  supabaseClient.auth.onAuthStateChange((event, session)=>{
    if(event === 'PASSWORD_RECOVERY'){
      // A reset-link click lands here with a session already established,
      // but the app should stay locked behind the auth panel until the user
      // actually picks a new password, rather than unlocking immediately.
      authPanel.hidden = false;
      authedContent.hidden = true;
      userStatus.hidden = true;
      setMode('newpassword');
      return;
    }
    setAuthedUI(session ? session.user : null);
  });
})();
