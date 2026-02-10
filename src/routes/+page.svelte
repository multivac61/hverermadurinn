<script lang="ts">
  import { onMount } from 'svelte';
  import {
    askQuestionCommand,
    getLeaderboardQuery,
    getRound,
    getSessionStateQuery,
    getUsernameQuery,
    requestHintCommand,
    setUsernameCommand,
    startSessionCommand,
    submitGuessCommand
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
  let showEndLeaderboard = $state(false);
  let usernameConfirmed = $state(false);
  let sessionReady = $state(false);

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
  const questionCount = $derived(sessionState?.session?.questionCount ?? 0);
  const solved = $derived(sessionState?.session?.solved ?? false);
  const questions = $derived(sessionState?.questions ?? []);
  const remainingQuestions = $derived(round ? Math.max(0, round.maxQuestions - questionCount) : 0);
  const isOpenForPlay = $derived(Boolean(localTestMode || round?.status === 'open'));
  const pending = $derived(
    askQuestionCommand.pending + submitGuessCommand.pending + requestHintCommand.pending > 0
  );
  const progressPct = $derived(round ? Math.min(100, (questionCount / round.maxQuestions) * 100) : 0);
  const questionNumber = $derived(Math.min(round?.maxQuestions ?? 20, questionCount + 1));
  const canSubmit = $derived(Boolean(!pending && !solved && isOpenForPlay && inputText.trim()));

  const debugForceRoundOpen = $derived(Boolean((roundQuery.current as any)?.debug?.forceRoundOpen));
  const debugRandomRoundEnabled = $derived(
    Boolean((roundQuery.current as any)?.debug?.devRandomRoundPerSession)
  );
  const showLocalTestControls = $derived(debugForceRoundOpen || debugRandomRoundEnabled);

  const viewStep = $derived.by(() => {
    if (!roundReady) return 'loading';
    if (!isOpenForPlay) return round?.status === 'scheduled' ? 'scheduled' : 'closed';
    if (!sessionReady) return 'loading';
    if (showIntro) return 'intro';
    if (!usernameConfirmed) return 'username';
    if (solved) return 'solved';
    return 'question';
  });

  $effect(() => {
    if (round?.id && round.id !== leaderboardRoundId) {
      leaderboardRoundId = round.id;
      leaderboardQuery = getLeaderboardQuery({ roundId: round.id });
    }
  });

  $effect(() => {
    const imageUrl = revealPerson?.imageUrl;
    revealImageFailed = false;
    void imageUrl;
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
    const deviceId = randomizeRound ? `anon-${randomId()}` : getDeviceId();
    currentDeviceId = deviceId;

    const result = await startSessionCommand({
      deviceId,
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

    const usernameResult = await getUsernameQuery({ deviceId });
    username = usernameResult.username ?? '';
    usernameInput = username;
    usernameError = '';

    await sessionStateQuery;
    await leaderboardQuery.refresh();
    sessionReady = true;
  }

  function parseSingleInput(raw: string) {
    const input = raw.trim();
    const lower = input.toLowerCase();

    if (['vísbending', 'visbending', 'hint', 'hjálp', 'hjalp'].includes(lower)) {
      return { kind: 'hint' as const, value: '' };
    }

    const guessMatch = input.match(/^(gisk|giska|guess)\s*:\s*(.+)$/i);
    if (guessMatch) return { kind: 'guess' as const, value: guessMatch[2].trim() };

    return { kind: 'question' as const, value: input };
  }

  async function submitCurrent(event?: SubmitEvent) {
    event?.preventDefault();
    if (!sessionId || !inputText.trim() || !isOpenForPlay || solved) return;

    showIntro = false;
    error = '';
    feedback = '';

    const parsed = parseSingleInput(inputText);

    try {
      if (parsed.kind === 'hint') {
        const result = await requestHintCommand({ sessionId, forceRoundOpen: localTestMode });
        hint = result.hint;
        feedback = 'Vísbending móttekin.';
      } else if (parsed.kind === 'guess') {
        if (!parsed.value) throw new Error('Notaðu: gisk: Nafn Persónu');
        const result = await submitGuessCommand({
          sessionId,
          guess: parsed.value,
          forceRoundOpen: localTestMode
        });
        feedback = result.correct ? 'Rétt hjá þér! 🎉' : 'Nei.';
        if (result.revealPerson) revealedFromGuess = result.revealPerson;
      } else {
        if (remainingQuestions <= 0) throw new Error('Spurningamark náð. Notaðu gisk: Nafn');
        const result = await askQuestionCommand({
          sessionId,
          question: parsed.value,
          forceRoundOpen: localTestMode
        });
        feedback = result.answerTextIs;
      }

      hasSubmitted = true;
      inputText = '';
      await sessionStateQuery?.refresh();
      await leaderboardQuery.refresh();
      await roundQuery.refresh();
    } catch (e) {
      error = (e as Error).message;
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

  async function shareResult() {
    const text = `Ég leysti "Hver er maðurinn?" í ${questionCount} spurningum! #hverermadurinn`;
    try {
      if (navigator.share) {
        await navigator.share({ text, url: window.location.origin });
        shareStatus = 'Deilt!';
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
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
    };
  });
</script>

<div class="fixed inset-x-0 top-0 z-40 h-1.5 bg-zinc-200/80">
  <div class="h-full bg-zinc-900 transition-all duration-500" style={`width:${progressPct}%`}></div>
</div>

<main class="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-900 sm:px-10">
  <div class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl items-center justify-center">
    <section class="min-h-[70vh] w-full rounded-[34px] bg-white px-8 py-10 shadow-[0_30px_90px_-36px_rgba(0,0,0,0.35)] ring-1 ring-zinc-200 sm:px-12 sm:py-14">
      <div class="flex min-h-[52vh] flex-col justify-center">
          {#if viewStep === 'loading'}
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Hleð stöðu leiks...</h1>
          {:else if viewStep === 'username'}
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Hvað á ég að kalla þig?</h1>
            <p class="mt-4 text-xl text-zinc-600 sm:text-2xl">
              {username ? 'Staðfestu notendanafnið þitt eða breyttu því.' : 'Veldu notendanafn áður en þú byrjar.'}
            </p>

            <form class="mt-10" onsubmit={confirmUsername}>
              <input
                id="username"
                name="username"
                class="w-full rounded-none border-0 border-b-2 border-zinc-300 bg-transparent px-0 py-4 text-4xl font-medium outline-none transition placeholder:text-zinc-400 focus:border-zinc-900"
                bind:value={usernameInput}
                placeholder="notendanafn"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
              />
              <div class="mt-8 flex items-center gap-4">
                <button
                  class="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-40"
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
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Hver er maðurinn?</h1>
            <p class="mt-4 text-xl text-zinc-600 sm:text-2xl">Þú hefur 20 spurningar.</p>
            <button class="mt-10 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white" onclick={startGame}>
              Byrja
            </button>
          {:else if viewStep === 'question'}
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Hver er maðurinn?</h1>

            <form class="mt-12" onsubmit={submitCurrent}>
              <input
                class="w-full rounded-none border-0 border-b-2 border-zinc-300 bg-transparent px-0 py-4 text-4xl font-medium outline-none transition placeholder:text-zinc-400 focus:border-zinc-900"
                bind:value={inputText}
                placeholder="Skrifaðu svar..."
              />

              <div class="mt-8 flex items-center gap-4">
                <button
                  class="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-40"
                  disabled={!canSubmit}
                >
                  Áfram
                </button>
                <span class="text-xs text-zinc-500">ENTER ↵</span>
              </div>
            </form>

            {#if feedback}
              <p class="mt-8 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{feedback}</p>
            {/if}

            {#if hint}
              <p class="mt-3 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">Vísbending: {hint}</p>
            {/if}

            {#if error}
              <p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            {/if}
          {:else if viewStep === 'solved'}
            <p class="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Svarið er</p>
            <h1 class="mt-2 text-5xl font-semibold leading-[1.04] sm:text-7xl">{revealPerson?.displayName ?? 'Leik lokið'}</h1>
            <p class="mt-4 text-lg text-zinc-600">Þú leystir leik dagsins í {questionCount} spurningum.</p>
            {#if revealPerson?.revealTextIs}
              <p class="mt-2 text-zinc-600">{revealPerson.revealTextIs}</p>
            {/if}

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

            <div class="mt-8 flex flex-wrap items-center gap-3">
              <button class="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white" onclick={shareResult}>
                Deila niðurstöðu
              </button>
              <button class="rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-semibold text-zinc-900" onclick={showLeaderboardForDay}>
                Sjá stigatöflu dagsins
              </button>
              {#if shareStatus}
                <span class="text-sm text-zinc-600">{shareStatus}</span>
              {/if}
            </div>

            {#if showEndLeaderboard}
              <div class="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
                {#if myLeaderboardEntry}
                  <p class="text-sm font-semibold text-zinc-700">Þín staða í dag: #{myLeaderboardEntry.rank}</p>
                {/if}
                <h2 class="mt-2 text-base font-semibold">Leaderboard</h2>
                {#if leaderboard.length === 0}
                  <p class="mt-2 text-sm text-zinc-600">Enginn búinn að leysa ennþá.</p>
                {:else}
                  <ul class="mt-2 space-y-2 text-sm">
                    {#each leaderboard as row}
                      <li class="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                        <span>#{row.rank} {row.username ? `@${row.username}` : ''}</span>
                        <span>{row.questionsUsed}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
          {:else if viewStep === 'scheduled'}
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Leikurinn opnar kl. 12:00</h1>
            <p class="mt-4 text-zinc-600">Ný persóna kemur á hádegi.</p>
          {:else}
            <h1 class="mt-10 text-5xl font-semibold leading-[1.04] sm:text-7xl">Leiknum er lokið í dag</h1>
            <p class="mt-4 text-zinc-600">Næsti leikur opnar á morgun.</p>
          {/if}
        </div>
    </section>
  </div>
</main>
