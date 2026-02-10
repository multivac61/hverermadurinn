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

  const DEVICE_KEY = 'hverermadurinn:deviceId';
  const LOCAL_TEST_MODE_KEY = 'hverermadurinn:local-test-mode';

  const roundReady = $derived(roundQuery.ready);
  const round = $derived((roundQuery.current?.round as Round | undefined) ?? null);
  const revealFromRound = $derived(
    (roundQuery.current?.revealPerson as RevealPerson | null | undefined) ?? null
  );
  const revealPerson = $derived(revealedFromGuess ?? revealFromRound);
  const leaderboard = $derived((leaderboardQuery.current?.leaderboard as any[]) ?? []);
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
  const latestAnswer = $derived(questions.length > 0 ? questions[questions.length - 1] : null);
  const questionNumber = $derived(Math.min(round?.maxQuestions ?? 20, questionCount + 1));
  const canSubmit = $derived(Boolean(!pending && !solved && isOpenForPlay && inputText.trim()));
  const hasInteracted = $derived(questionCount > 0 || solved);
  const canSaveUsername = $derived(Boolean(usernameInput.trim().length >= 3));

  const debugForceRoundOpen = $derived(Boolean((roundQuery.current as any)?.debug?.forceRoundOpen));
  const debugRandomRoundEnabled = $derived(
    Boolean((roundQuery.current as any)?.debug?.devRandomRoundPerSession)
  );
  const showLocalTestControls = $derived(debugForceRoundOpen || debugRandomRoundEnabled);

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

    const usernameResult = await getUsernameQuery({ deviceId });
    username = usernameResult.username ?? '';
    usernameInput = username;
    usernameError = '';

    await sessionStateQuery;
    await leaderboardQuery.refresh();
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
        feedback = result.correct ? 'Rétt hjá þér! 🎉' : 'Ekki rétt — reyndu aftur.';
        if (result.revealPerson) revealedFromGuess = result.revealPerson;
      } else {
        if (remainingQuestions <= 0) throw new Error('Spurningamark náð. Notaðu gisk: Nafn');
        const result = await askQuestionCommand({
          sessionId,
          question: parsed.value,
          forceRoundOpen: localTestMode
        });
        feedback = `${result.answerLabel}: ${result.answerTextIs}`;
      }

      inputText = '';
      await sessionStateQuery?.refresh();
      await leaderboardQuery.refresh();
      await roundQuery.refresh();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function saveUsername() {
    if (!currentDeviceId || !canSaveUsername) return;
    usernameError = '';

    try {
      const result = await setUsernameCommand({ deviceId: currentDeviceId, username: usernameInput });
      username = result.username;
      usernameInput = result.username;
      await leaderboardQuery.refresh();
    } catch (e) {
      usernameError = (e as Error).message;
    }
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

<main class="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-10">
  <section class="rounded-[28px] border border-zinc-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-12">
    <div class="h-1.5 overflow-hidden rounded-full bg-zinc-100">
      <div class="h-full rounded-full bg-zinc-900 transition-all duration-500" style={`width:${progressPct}%`}></div>
    </div>

    <div class="mt-7 space-y-2">
      <p class="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">HVER ER MAÐURINN?</p>
      {#if roundReady && isOpenForPlay}
        <p class="text-sm text-zinc-500">Spurning {questionNumber} af {round?.maxQuestions ?? 20}</p>
      {/if}
    </div>

    <div class="mt-5 flex flex-wrap items-end gap-2 rounded-xl bg-zinc-50 p-3">
      <div class="min-w-44 flex-1">
        <label class="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500" for="username-input">Username</label>
        <input
          id="username-input"
          class="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          bind:value={usernameInput}
          placeholder="settu nafn (3-24)"
        />
      </div>
      <button
        class="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        onclick={saveUsername}
        disabled={!canSaveUsername || setUsernameCommand.pending > 0}
      >
        Vista
      </button>
      {#if username}
        <span class="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">@{username}</span>
      {/if}
    </div>
    {#if usernameError}
      <p class="mt-2 text-xs text-red-600">{usernameError}</p>
    {/if}

    {#if !roundReady}
      <h1 class="mt-10 text-4xl font-semibold text-zinc-900 sm:text-6xl">Hleð stöðu leiks...</h1>
    {:else if isOpenForPlay}
      <h1 class="mt-8 text-4xl font-semibold leading-[1.08] text-zinc-900 sm:text-6xl">Hver er manneskjan?</h1>
      <p class="mt-4 text-zinc-600">Skrifaðu spurningu, <strong>gisk: Nafn</strong> eða <strong>vísbending</strong>.</p>

      <form class="mt-10" onsubmit={submitCurrent}>
        <input
          class="w-full rounded-none border-0 border-b-2 border-zinc-300 bg-transparent px-0 py-3 text-3xl font-medium text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-900"
          bind:value={inputText}
          placeholder="Skrifaðu hér..."
        />

        <div class="mt-6 flex items-center justify-between gap-4">
          <button
            class="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-40"
            disabled={!canSubmit}
          >
            Halda áfram
          </button>
          <span class="text-xs text-zinc-500">ENTER ↵</span>
        </div>
      </form>

      <div class="mt-5 flex flex-wrap gap-2">
        <button class="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600" onclick={() => (inputText = 'vísbending')}>
          vísbending
        </button>
        <button class="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600" onclick={() => (inputText = 'gisk: ')}>
          gisk: nafn
        </button>
      </div>

      {#if feedback}
        <p class="mt-5 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-700">{feedback}</p>
      {/if}

      {#if hint}
        <p class="mt-3 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900">Vísbending: {hint}</p>
      {/if}

      {#if latestAnswer}
        <p class="mt-4 text-sm text-zinc-600"><strong>Síðasta:</strong> {latestAnswer.answerLabel} — {latestAnswer.answerTextIs}</p>
      {/if}

      {#if solved}
        <p class="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Þú leystir gátuna! 🎉</p>
      {/if}

      {#if error}
        <p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      {/if}
    {:else if round?.status === 'scheduled'}
      <h1 class="mt-8 text-4xl font-semibold leading-tight text-zinc-900 sm:text-6xl">Leikurinn opnar kl. 12:00</h1>
      <p class="mt-4 text-zinc-600">Ný persóna kemur á hádegi.</p>
    {:else}
      <h1 class="mt-8 text-4xl font-semibold leading-tight text-zinc-900 sm:text-6xl">Leiknum er lokið í dag</h1>
      <p class="mt-4 text-zinc-600">Næsti leikur opnar á morgun.</p>
    {/if}

    {#if roundReady && round}
      <div class="mt-8 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span class="rounded-full bg-zinc-100 px-3 py-1">Staða: <strong>{isOpenForPlay ? 'open' : round.status}</strong></span>
        <span class="rounded-full bg-zinc-100 px-3 py-1">Spurningar: <strong>{questionCount}/{round.maxQuestions}</strong></span>
        {#if round.status !== 'closed'}
          <span class="rounded-full bg-zinc-100 px-3 py-1">Niðurtalning: <strong class="font-mono">{countdownText}</strong></span>
        {/if}
      </div>
    {/if}
  </section>

  {#if revealPerson}
    <section class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 class="text-xl font-semibold">Maðurinn dagsins</h2>
      <p class="mt-2 text-lg font-medium">{revealPerson.displayName}</p>
      <p class="mt-1 text-zinc-700">{revealPerson.revealTextIs}</p>

      {#if !revealImageFailed && revealPerson.imageUrl}
        <div class="mt-4 overflow-hidden rounded-xl bg-zinc-100">
          <img
            class="max-h-[28rem] w-full object-contain"
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
      {:else}
        <div class="mt-4 rounded-xl bg-zinc-100 p-4 text-sm text-zinc-600">Mynd ekki tiltæk eins og er.</div>
      {/if}
    </section>
  {/if}

  {#if solved || round?.status === 'closed'}
    <section class="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 class="text-xl font-semibold">Leaderboard (dagurinn)</h2>
      {#if leaderboard.length === 0}
        <p class="mt-3 text-zinc-600">Enginn búinn að leysa ennþá.</p>
      {:else}
        <ul class="mt-3 space-y-2 text-sm">
          {#each leaderboard as row}
            <li class="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
              <span>#{row.rank} {row.username ? `@${row.username}` : ''}</span>
              <span>{row.questionsUsed} spurningar</span>
              <span>{msToText(row.timeFromStartMs)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  {#if showLocalTestControls}
    <details class="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <summary class="cursor-pointer font-semibold">Local test controls</summary>
      <p class="mt-2 text-xs">
        Local toggle: {String(localTestMode)} | Env FORCE_ROUND_OPEN={String(debugForceRoundOpen)} | Env DEV_RANDOM_ROUND_PER_SESSION={String(debugRandomRoundEnabled)}
      </p>
      <div class="mt-2 flex gap-2">
        <button class="rounded-lg bg-amber-200 px-3 py-1 text-xs font-semibold" onclick={toggleLocalTestMode}>
          {localTestMode ? 'Slökkva local test mode' : 'Kveikja local test mode'}
        </button>
        <button class="rounded-lg bg-amber-200 px-3 py-1 text-xs font-semibold" onclick={startRandomTestRound}>
          Ný random prófunarlota
        </button>
      </div>
    </details>
  {/if}
</main>
