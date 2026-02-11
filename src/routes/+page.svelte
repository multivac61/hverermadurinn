<script lang="ts">
  import { blur } from 'svelte/transition';
  import { onMount, tick } from 'svelte';
  import {
    getDebugRoundInfoQuery,
    getLeaderboardQuery,
    getRound,
    getSessionStateQuery,
    getUsernameQuery,
    handleInputCommand,
    setUsernameCommand,
    startSessionCommand
  } from './game.remote';
  import { randomId } from '$lib/shared/id';

  type Round = {
    id: string;
    status: 'scheduled' | 'open' | 'closed';
    opensAt: number;
    closesAt: number;
    maxQuestions: number;
  };

  type RevealPerson = { displayName: string; revealTextIs: string; imageUrl: string };

  let inputText = $state('');
  let hint = $state('');
  let feedback = $state('');
  let error = $state('');
  let sessionId = $state('');
  let countdownText = $state('');

  let roundQuery = $state(getRound());
  let leaderboardQuery = $state(getLeaderboardQuery({}));
  let sessionStateQuery = $state<ReturnType<typeof getSessionStateQuery> | null>(null);
  let debugRoundInfoQuery = $state<ReturnType<typeof getDebugRoundInfoQuery> | null>(null);
  let revealedFromGuess = $state<RevealPerson | null>(null);
  let leaderboardRoundId = $state('');
  let localTestMode = $state(false);
  let revealImageFailed = $state(false);
  let currentDeviceId = $state('');
  let username = $state('');
  let usernameInput = $state('');
  let usernameError = $state('');
  let hasSubmitted = $state(false);
  let showIntro = $state(true);
  let shareStatus = $state('');
  let sharePreviewUrl = $state('');
  let sharePreviewError = $state('');
  let showEndLeaderboard = $state(false);
  let usernameConfirmed = $state(false);
  let sessionReady = $state(false);
  let localQuestionCount = $state(0);
  let showAdminConsole = $state(false);
  let usernameInputEl = $state<HTMLInputElement | null>(null);
  let questionInputEl = $state<HTMLInputElement | null>(null);
  let focusTimer: ReturnType<typeof setTimeout> | null = null;

  const DEVICE_KEY = 'hverermadurinn:deviceId';
  const LOCAL_TEST_MODE_KEY = 'hverermadurinn:local-test-mode';

  const round = $derived((roundQuery.current?.round as Round | undefined) ?? null);
  const roundReady = $derived(Boolean(round));
  const revealFromRound = $derived(
    (roundQuery.current?.revealPerson as RevealPerson | null | undefined) ?? null
  );
  const revealPerson = $derived(revealedFromGuess ?? revealFromRound);
  const leaderboard = $derived((leaderboardQuery.current?.leaderboard as any[]) ?? []);
  const myLeaderboardEntry = $derived(leaderboard.find((row) => row.sessionId === sessionId) ?? null);
  const sessionState = $derived(sessionStateQuery?.current ?? null);
  const sessionRoundId = $derived(String(sessionState?.session?.roundId ?? ''));
  const questionCount = $derived(sessionState?.session?.questionCount ?? 0);
  const solved = $derived(sessionState?.session?.solved ?? false);
  const questions = $derived(sessionState?.questions ?? []);
  const effectiveQuestionCount = $derived(Math.max(questionCount, questions.length, localQuestionCount));
  const latestAnswerText = $derived(
    questions.length > 0 ? String(questions[questions.length - 1]?.answerTextIs ?? '') : ''
  );
  const remainingQuestions = $derived(round ? Math.max(0, round.maxQuestions - effectiveQuestionCount) : 0);
  const isOpenForPlay = $derived(Boolean(localTestMode || round?.status === 'open'));
  const pending = $derived(handleInputCommand.pending > 0);
  const progressPct = $derived(round ? Math.min(100, (effectiveQuestionCount / round.maxQuestions) * 100) : 0);
  const displayProgressPct = $derived.by(() => {
    if (!round) return 0;
    if (solved) return 100;
    if (!sessionReady) return 2;
    if (showIntro) return 6;
    if (!usernameConfirmed) return 10;
    return Math.min(99, 10 + progressPct * 0.9);
  });
  const questionNumber = $derived(Math.min(round?.maxQuestions ?? 20, questionCount + 1));
  const canSubmit = $derived(Boolean(!pending && !solved && isOpenForPlay && inputText.trim()));

  const debugForceRoundOpen = $derived(Boolean((roundQuery.current as any)?.debug?.forceRoundOpen));
  const debugRandomRoundEnabled = $derived(
    Boolean((roundQuery.current as any)?.debug?.devRandomRoundPerSession)
  );
  const debugCurrentPersonName = $derived(String(debugRoundInfoQuery?.current?.personName ?? ''));
  const debugCurrentPersonId = $derived(String(debugRoundInfoQuery?.current?.personId ?? ''));
  const showLocalTestControls = $derived(debugForceRoundOpen || debugRandomRoundEnabled);

  const viewStep = $derived.by(() => {
    if (!roundReady) return 'loading';
    if (!isOpenForPlay) return round?.status === 'scheduled' ? 'scheduled' : 'closed';
    if (!sessionReady) return 'loading';
    if (showIntro) return 'intro';
    if (!usernameConfirmed) return 'username';
    if (solved && showEndLeaderboard) return 'leaderboard';
    if (solved) return 'solved';
    return 'question';
  });

  async function focusStepInput(step: string) {
    await tick();

    if (focusTimer) clearTimeout(focusTimer);

    focusTimer = setTimeout(() => {
      const el = step === 'username' ? usernameInputEl : step === 'question' ? questionInputEl : null;
      if (!el) return;

      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }, 180);
  }

  $effect(() => {
    const step = viewStep;
    if (step === 'username' || step === 'question') {
      void focusStepInput(step);
    }
  });

  $effect(() => {
    const targetRoundId = sessionRoundId || round?.id || '';
    if (targetRoundId && targetRoundId !== leaderboardRoundId) {
      leaderboardRoundId = targetRoundId;
      leaderboardQuery = getLeaderboardQuery({ roundId: targetRoundId });
    }
  });

  $effect(() => {
    if (showLocalTestControls && sessionRoundId) {
      debugRoundInfoQuery = getDebugRoundInfoQuery({ roundId: sessionRoundId });
    }
  });

  $effect(() => {
    const imageUrl = revealPerson?.imageUrl;
    revealImageFailed = false;
    void imageUrl;
  });

  $effect(() => {
    if (viewStep === 'solved') {
      void updateSharePreview();
    }
  });

  function getDeviceId() {
    let existing = localStorage.getItem(DEVICE_KEY);
    if (!existing) {
      existing = randomId();
      localStorage.setItem(DEVICE_KEY, existing);
    }
    return existing;
  }

  function msToText(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function refreshCountdown() {
    if (!round) return;
    const now = Date.now();
    const target = round.status === 'scheduled' ? round.opensAt : round.status === 'open' ? round.closesAt : null;
    countdownText = target ? msToText(target - now) : '';
  }

  async function initializeSession(randomizeRound = false) {
    sessionReady = false;
    const persistentDeviceId = getDeviceId();
    const sessionDeviceId = randomizeRound ? `anon-${randomId()}` : persistentDeviceId;
    currentDeviceId = persistentDeviceId;

    const result = await startSessionCommand({
      deviceId: sessionDeviceId,
      randomizeRound,
      freshDevice: randomizeRound,
      forceRoundOpen: localTestMode
    });

    sessionId = result.session.id;
    sessionStateQuery = getSessionStateQuery({ sessionId });
    revealedFromGuess = null;
    hint = '';
    feedback = '';
    inputText = '';
    showEndLeaderboard = false;
    usernameConfirmed = false;
    localQuestionCount = 0;

    const usernameResult = await getUsernameQuery({ deviceId: persistentDeviceId });
    username = usernameResult.username ?? '';
    usernameInput = username;
    usernameError = '';

    await sessionStateQuery;
    await leaderboardQuery.refresh();
    sessionReady = true;
  }

  async function submitCurrent(event?: SubmitEvent) {
    event?.preventDefault();
    if (!sessionId || !inputText.trim() || !isOpenForPlay || solved) return;

    showIntro = false;
    error = '';

    try {
      if (remainingQuestions <= 0) throw new Error('Spurningamark náð.');

      const result = await handleInputCommand({
        sessionId,
        input: inputText,
        forceRoundOpen: localTestMode
      });

      if (result.kind === 'hint') {
        hint = result.hint;
        feedback = result.answerTextIs;
      } else if (result.kind === 'guess') {
        feedback = result.answerTextIs;
        if (result.revealPerson) revealedFromGuess = result.revealPerson;
      } else {
        localQuestionCount = Math.max(localQuestionCount + 1, result.questionCount ?? 0);
        feedback = result.answerTextIs;
      }

      hasSubmitted = true;
      inputText = '';
      await sessionStateQuery?.refresh();
      await leaderboardQuery.refresh();
      await roundQuery.refresh();
    } catch (e) {
      const message = (e as Error).message;
      if (message === 'LLM_RATE_LIMITED') {
        error = 'Kerfið er upptekið núna (hátt álag). Reyndu aftur eftir smástund.';
      } else if (message === 'LLM_UPSTREAM_ERROR') {
        error = 'Villa hjá svarþjónustu. Reyndu aftur.';
      } else {
        error = message;
      }
    }
  }

  async function confirmUsername(event?: Event) {
    event?.preventDefault();
    usernameError = '';
    if (!currentDeviceId) {
      usernameError = 'Villa: auðkenni tækis fannst ekki. Endurhlaðið síðuna.';
      return;
    }

    let candidate = usernameInput.trim();
    if (!candidate) {
      const formEl =
        event?.currentTarget instanceof HTMLFormElement
          ? event.currentTarget
          : event?.target instanceof HTMLElement
            ? event.target.closest('form')
            : null;
      if (formEl) {
        const fd = new FormData(formEl);
        candidate = String(fd.get('username') ?? '').trim();
      }
    }

    if (!candidate) {
      if (username) {
        usernameConfirmed = true;
        return;
      }
      usernameError = 'Sláðu inn notendanafn.';
      return;
    }

    if (candidate === username) {
      usernameConfirmed = true;
      return;
    }

    const result = await setUsernameCommand({ deviceId: currentDeviceId, username: candidate });
    if (!result.ok) {
      usernameError =
        result.error === 'USERNAME_TAKEN'
          ? 'Þetta notendanafn er þegar tekið.'
          : 'Ekki tókst að vista notendanafn. Reyndu aftur.';
      return;
    }

    username = result.username;
    usernameInput = result.username;
    usernameConfirmed = true;
    await leaderboardQuery.refresh();
  }

  function startGame() {
    showIntro = false;
  }

  async function createShareImageBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#111111';
    ctx.font = '700 66px Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Hver er maðurinn?', 70, 140);

    ctx.font = '500 44px Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`Ég leysti leik dagsins í ${effectiveQuestionCount} giskum.`, 70, 250);

    ctx.font = '400 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Getur þú giskað á persónu dagsins?', 70, 330);

    ctx.fillStyle = '#27272a';
    ctx.font = '600 40px Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Prófaðu á hverermadurinn.is', 70, 530);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  async function updateSharePreview(blob?: Blob | null) {
    sharePreviewError = '';

    try {
      const imageBlob = blob ?? (await createShareImageBlob());
      if (!imageBlob) throw new Error('NO_BLOB');

      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
      sharePreviewUrl = URL.createObjectURL(imageBlob);
    } catch {
      sharePreviewError = 'Ekki tókst að búa til deilimynd.';
    }
  }

  function getSharePayload() {
    const g = Math.max(1, effectiveQuestionCount);
    const url = `https://hverermadurinn.is/?g=${g}`;
    const text = `Ég leysti Hver er maðurinn? í ${effectiveQuestionCount} giskum í dag. Prófaðu sjálf(ur) á hverermadurinn.is`;
    return { url, text };
  }

  function getSocialShareLink(platform: 'facebook' | 'x' | 'linkedin' | 'whatsapp') {
    const { url, text } = getSharePayload();
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(text);

    if (platform === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
    if (platform === 'x') return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    if (platform === 'linkedin') return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  }

  async function shareResult() {
    const { url, text } = getSharePayload();

    try {
      const imageBlob = await createShareImageBlob();
      await updateSharePreview(imageBlob);

      if (navigator.share) {
        if (imageBlob) {
          const file = new File([imageBlob], 'hverermadurinn-result.png', { type: 'image/png' });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({
              title: 'Hver er maðurinn?',
              text,
              url,
              files: [file]
            });
            shareStatus = 'Deilt!';
            return;
          }
        }

        await navigator.share({ title: 'Hver er maðurinn?', text, url });
        shareStatus = 'Deilt!';
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        shareStatus = 'Afritað í klippiborð';
      }
    } catch {
      shareStatus = 'Ekki tókst að deila';
    }
  }

  async function showLeaderboardForDay() {
    showEndLeaderboard = true;
    await leaderboardQuery.refresh();
  }

  function backToSolved() {
    showEndLeaderboard = false;
  }

  async function startRandomTestRound() {
    error = '';
    try {
      await initializeSession(true);
      await roundQuery.refresh();
      refreshCountdown();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function toggleLocalTestMode() {
    localTestMode = !localTestMode;
    localStorage.setItem(LOCAL_TEST_MODE_KEY, String(localTestMode));
    await initializeSession(true);
    await roundQuery.refresh();
    refreshCountdown();
  }

  onMount(() => {
    let disposed = false;

    void (async () => {
      try {
        const saved = localStorage.getItem(LOCAL_TEST_MODE_KEY);
        localTestMode = showLocalTestControls && (saved === 'true' || debugForceRoundOpen || debugRandomRoundEnabled);

        await roundQuery.refresh();
        await initializeSession();
        refreshCountdown();
      } catch (e) {
        if (!disposed) error = (e as Error).message;
      }
    })();

    const timer = setInterval(async () => {
      if (!round) return;
      refreshCountdown();

      const now = Date.now();
      const shouldRefresh =
        (round.status === 'scheduled' && now >= round.opensAt) ||
        (round.status === 'open' && now >= round.closesAt);

      if (shouldRefresh) {
        await roundQuery.refresh();
        await leaderboardQuery.refresh();
      }
    }, 1000);

    return () => {
      disposed = true;
      clearInterval(timer);
      if (focusTimer) clearTimeout(focusTimer);
      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl);
    };
  });
</script>

<div class="fixed inset-x-0 top-0 z-40 h-[2px] bg-zinc-200/80">
  <div class="h-full bg-zinc-900 transition-all duration-500" style={`width:${displayProgressPct}%`}></div>
</div>

<main class="min-h-screen bg-zinc-50 px-4 py-4 text-zinc-900 sm:px-8 sm:py-8">
  <div class="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-7xl items-center sm:min-h-[calc(100vh-4rem)]">
    <section class="w-full px-2 py-2 sm:px-12 lg:px-28">
      <div class="relative min-h-[68vh] w-full sm:min-h-[58vh]">
        {#key viewStep}
          <div
            class="absolute inset-0 flex flex-col justify-center"
            in:blur={{ duration: 360, amount: 16, opacity: 0.2 }}
            out:blur={{ duration: 280, amount: 12, opacity: 0.14 }}
          >
          {#if viewStep === 'loading'}
            <div class="mt-6 flex items-center justify-center">
              <svg
                class="h-14 w-14 animate-spin text-zinc-900"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="Hleð"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.5" />
                <path
                  d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                />
              </svg>
            </div>
          {:else if viewStep === 'username'}
            <h1 class="mt-4 text-3xl font-semibold leading-[1.08] sm:mt-8 sm:text-6xl">Hvað á ég að kalla þig?</h1>
            <p class="mt-4 text-xl text-zinc-600 sm:text-2xl">
              {username ? 'Staðfestu notendanafnið þitt eða breyttu því.' : 'Veldu notendanafn áður en þú byrjar.'}
            </p>

            <form class="mt-8" onsubmit={confirmUsername}>
              <input
                id="username"
                name="username"
                class="w-full rounded-none border-0 border-b-2 border-zinc-300 bg-transparent px-0 py-3 text-2xl font-medium outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 sm:text-4xl"
                bind:value={usernameInput}
                placeholder="notendanafn"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                bind:this={usernameInputEl}
              />
              <div class="mt-6 flex items-center gap-4">
                <button
                  class="w-full rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-40 sm:w-auto"
                  disabled={setUsernameCommand.pending > 0}
                >
                  {username ? 'Staðfesta' : 'Vista nafn'}
                </button>
              </div>
            </form>

            {#if usernameError}
              <p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{usernameError}</p>
            {/if}
          {:else if viewStep === 'intro'}
            <h1 class="mt-4 text-3xl font-semibold leading-[1.08] sm:mt-8 sm:text-6xl">Hver er maðurinn?</h1>
            <p class="mt-4 text-xl text-zinc-600 sm:text-2xl">Þú hefur 20 spurningar.</p>
            <button class="mt-8 w-full rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white sm:mt-10 sm:w-auto" onclick={startGame}>
              Byrja
            </button>
          {:else if viewStep === 'question'}
            <h1 class="mt-4 min-h-[3.2rem] text-3xl font-semibold leading-[1.08] sm:mt-8 sm:min-h-[5rem] sm:text-6xl">
              {latestAnswerText || feedback || 'Hver er maðurinn?'}
            </h1>

            <form class={`mt-8 transition-opacity duration-200 ${pending ? 'opacity-90' : 'opacity-100'}`} onsubmit={submitCurrent}>
              <input
                class="w-full rounded-none border-0 border-b-2 border-zinc-300 bg-transparent px-0 py-3 text-2xl font-medium outline-none transition placeholder:text-zinc-400 focus:border-zinc-900 sm:text-4xl"
                bind:value={inputText}
                placeholder="Skrifaðu svar..."
                bind:this={questionInputEl}
              />

              <div class="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center sm:gap-4">
                <button
                  class="w-full rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-40 sm:w-auto"
                  disabled={!canSubmit}
                >
                  Áfram
                </button>
                <span class="text-xs text-zinc-500">ENTER ↵</span>
              </div>
            </form>

            {#if hint}
              <p class="mt-3 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-800">Vísbending: {hint}</p>
            {/if}

            {#if error}
              <p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            {/if}
          {:else if viewStep === 'solved'}
            <p class="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 sm:mt-8 sm:text-sm">Svarið er</p>
            <h1 class="mt-2 text-4xl font-semibold leading-[1.08] sm:text-7xl">{revealPerson?.displayName ?? 'Leik lokið'}</h1>
            {#if revealPerson?.revealTextIs}
              <p class="mt-4 text-zinc-600">{revealPerson.revealTextIs}</p>
            {/if}
            <p class="mt-2 text-lg text-zinc-600">Þú leystir leik dagsins í {effectiveQuestionCount} spurningum.</p>

            {#if revealPerson?.imageUrl && !revealImageFailed}
              <div class="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
                <img
                  class="max-h-[24rem] w-full object-contain"
                  src={revealPerson.imageUrl}
                  alt={revealPerson.displayName}
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  onerror={() => {
                    revealImageFailed = true;
                  }}
                />
              </div>
            {/if}

            <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button class="w-full rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white sm:w-auto" onclick={shareResult}>
                Deila niðurstöðu
              </button>
              <button class="w-full rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 sm:w-auto" onclick={showLeaderboardForDay}>
                Sjá stigatöflu dagsins
              </button>
              {#if shareStatus}
                <span class="text-sm text-zinc-600">{shareStatus}</span>
              {/if}
            </div>

            {#if sharePreviewUrl}
              <div class="mt-6 rounded-2xl border border-zinc-200 bg-white p-3">
                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Deilimynd</p>
                <button class="block w-full" onclick={shareResult}>
                  <img class="w-full rounded-xl" src={sharePreviewUrl} alt="Deilimynd fyrir niðurstöðu" />
                </button>
                <p class="mt-2 text-xs text-zinc-500">Smelltu á myndina til að opna deilingu.</p>

                <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <a
                    class="rounded-lg border border-zinc-300 px-3 py-2 text-center text-xs font-semibold text-zinc-700"
                    href={getSocialShareLink('facebook')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Facebook
                  </a>
                  <a
                    class="rounded-lg border border-zinc-300 px-3 py-2 text-center text-xs font-semibold text-zinc-700"
                    href={getSocialShareLink('x')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    X / Twitter
                  </a>
                  <a
                    class="rounded-lg border border-zinc-300 px-3 py-2 text-center text-xs font-semibold text-zinc-700"
                    href={getSocialShareLink('linkedin')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    LinkedIn
                  </a>
                  <a
                    class="rounded-lg border border-zinc-300 px-3 py-2 text-center text-xs font-semibold text-zinc-700"
                    href={getSocialShareLink('whatsapp')}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>
            {:else if sharePreviewError}
              <p class="mt-4 text-sm text-zinc-600">{sharePreviewError}</p>
            {/if}
          {:else if viewStep === 'leaderboard'}
            <p class="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 sm:mt-8 sm:text-sm">Stigatafla</p>
            <h1 class="mt-2 text-4xl font-semibold leading-[1.08] sm:text-7xl">Stigatafla dagsins</h1>

            {#if myLeaderboardEntry}
              <p class="mt-4 text-base font-semibold text-zinc-700">Þín staða í dag: #{myLeaderboardEntry.rank}</p>
            {/if}

            {#if leaderboard.length === 0}
              <p class="mt-4 text-zinc-600">Enginn búinn að leysa ennþá.</p>
            {:else}
              <ul class="mt-5 space-y-2 text-sm sm:text-base">
                {#each leaderboard as row}
                  <li class="flex items-center justify-between rounded-lg bg-white px-4 py-3 ring-1 ring-zinc-200">
                    <span>#{row.rank} {row.username ? `@${row.username}` : ''}</span>
                    <span>{row.questionsUsed}</span>
                  </li>
                {/each}
              </ul>
            {/if}

            <div class="mt-8">
              <button class="rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900" onclick={backToSolved}>
                Til baka
              </button>
            </div>
          {:else if viewStep === 'scheduled'}
            <h1 class="mt-4 text-3xl font-semibold leading-[1.08] sm:mt-8 sm:text-6xl">Leikurinn opnar kl. 12:00</h1>
            <p class="mt-4 text-zinc-600">Ný persóna kemur á hádegi.</p>
          {:else}
            <h1 class="mt-4 text-3xl font-semibold leading-[1.08] sm:mt-8 sm:text-6xl">Leiknum er lokið í dag</h1>
            <p class="mt-4 text-zinc-600">Næsti leikur opnar á morgun.</p>
          {/if}
          </div>
        {/key}
      </div>
    </section>
  </div>

  {#if showLocalTestControls}
    <div class="fixed bottom-4 right-4 z-50">
      <button
        class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm"
        onclick={() => {
          showAdminConsole = !showAdminConsole;
        }}
      >
        {showAdminConsole ? 'Fela admin' : 'Admin console'}
      </button>

      {#if showAdminConsole}
        <div class="mt-2 w-72 space-y-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
          <div class="rounded-md bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700">
            <p><strong>Round:</strong> {round?.id ?? '—'}</p>
            <p><strong>Persona:</strong> {debugCurrentPersonName || 'Falinn (ekki debug)'}</p>
            {#if debugCurrentPersonId}
              <p class="text-zinc-500">{debugCurrentPersonId}</p>
            {/if}
          </div>
          <a class="block rounded-md bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800" href="/admin">
            Opna /admin
          </a>
          <button
            class="w-full rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"
            onclick={toggleLocalTestMode}
          >
            {localTestMode ? 'Slökkva local test mode' : 'Kveikja local test mode'}
          </button>
          <button
            class="w-full rounded-md bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800"
            onclick={startRandomTestRound}
          >
            Ný random prófunarlota
          </button>
        </div>
      {/if}
    </div>
  {/if}
</main>
