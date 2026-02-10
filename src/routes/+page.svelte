<script lang="ts">
  import { onMount } from 'svelte';
  import {
    askQuestionCommand,
    getLeaderboardQuery,
    getRound,
    getSessionStateQuery,
    requestHintCommand,
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

  const DEVICE_KEY = 'hverermadurinn:deviceId';
  const LOCAL_TEST_MODE_KEY = 'hverermadurinn:local-test-mode';

  const roundReady = $derived(roundQuery.ready);
  const round = $derived((roundQuery.current?.round as Round | undefined) ?? null);
  const revealFromRound = $derived((roundQuery.current?.revealPerson as RevealPerson | null | undefined) ?? null);
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
  const questionNumber = $derived(Math.min((round?.maxQuestions ?? 20), questionCount + 1));
  const canSubmit = $derived(Boolean(!pending && !solved && isOpenForPlay && inputText.trim()));

  const debugForceRoundOpen = $derived(Boolean((roundQuery.current as any)?.debug?.forceRoundOpen));
  const debugRandomRoundEnabled = $derived(Boolean((roundQuery.current as any)?.debug?.devRandomRoundPerSession));

  $effect(() => {
    if (round?.id && round.id !== leaderboardRoundId) {
      leaderboardRoundId = round.id;
      leaderboardQuery = getLeaderboardQuery({ roundId: round.id });
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
    const deviceId = randomizeRound ? `anon-${randomId()}` : getDeviceId();
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
    if (guessMatch) {
      return { kind: 'guess' as const, value: guessMatch[2].trim() };
    }

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

  function fillSuggestion(value: string) {
    inputText = value;
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
        localTestMode = saved === 'true' || debugForceRoundOpen || debugRandomRoundEnabled;

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

<main class="mx-auto min-h-screen max-w-5xl px-4 py-8">
  <section class="rounded-[32px] border border-zinc-200 bg-white p-6 shadow-sm sm:p-10">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">HVER ER MAÐURINN?</p>
      {#if roundReady && round}
        <div class="flex flex-wrap gap-2 text-xs text-zinc-600">
          <span class="rounded-full bg-zinc-100 px-3 py-1">Staða: <strong>{isOpenForPlay ? 'open' : round.status}</strong></span>
          <span class="rounded-full bg-zinc-100 px-3 py-1">Spurning {questionNumber}/{round.maxQuestions}</span>
          {#if round.status !== 'closed'}
            <span class="rounded-full bg-zinc-100 px-3 py-1">Niðurtalning: <strong class="font-mono">{countdownText}</strong></span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="mt-6 h-2 overflow-hidden rounded-full bg-zinc-100">
      <div class="h-full rounded-full bg-zinc-900 transition-all duration-300" style={`width:${progressPct}%`}></div>
    </div>

    {#if !roundReady}
      <p class="mt-10 text-zinc-700">Hleð stöðu leiks...</p>
    {:else if isOpenForPlay}
      <div class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <h1 class="text-4xl font-semibold leading-tight text-zinc-900 sm:text-5xl">Spyrðu eina spurningu í einu</h1>
          <p class="mt-3 text-zinc-600">Sama form fyrir allt: venjuleg spurning, <strong>gisk: Nafn</strong> eða <strong>vísbending</strong>.</p>

          <form class="mt-8" onsubmit={submitCurrent}>
            <input
              class="w-full rounded-2xl border border-zinc-300 px-5 py-4 text-lg outline-none ring-indigo-200 transition focus:ring"
              bind:value={inputText}
              placeholder="Skrifaðu næsta skref..."
              onkeydown={(e) => e.key === 'Tab' && inputText.trim() === '' && fillSuggestion('vísbending')}
            />
            <button
              class="mt-3 w-full rounded-2xl bg-zinc-900 px-4 py-3 text-base font-medium text-white transition disabled:opacity-40"
              disabled={!canSubmit}
            >
              Halda áfram
            </button>
          </form>

          <div class="mt-3 flex flex-wrap gap-2 text-xs">
            <button class="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700" onclick={() => fillSuggestion('vísbending')}>
              vísbending
            </button>
            <button class="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700" onclick={() => fillSuggestion('gisk: ')}>
              gisk: nafn
            </button>
            <button class="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700" onclick={() => fillSuggestion('Er manneskjan úr tónlist?')}>
              dæmi-spurning
            </button>
          </div>

          {#if hint}
            <p class="mt-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">Vísbending: {hint}</p>
          {/if}

          {#if feedback}
            <p class="mt-4 rounded-xl bg-zinc-100 p-3 text-sm">{feedback}</p>
          {/if}

          {#if latestAnswer}
            <div class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
              <p><strong>Q:</strong> {latestAnswer.question}</p>
              <p class="mt-1"><strong>{latestAnswer.answerLabel}:</strong> {latestAnswer.answerTextIs}</p>
            </div>
          {/if}

          {#if solved}
            <p class="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Þú leystir gátuna! 🎉</p>
          {/if}

          {#if error}
            <p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
          {/if}
        </div>

        <aside class="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
          <h2 class="font-semibold text-zinc-900">Leiðbeiningar</h2>
          <ul class="mt-2 space-y-2">
            <li>• Hámark {round?.maxQuestions ?? 20} spurningar.</li>
            <li>• Skrifaðu <strong>gisk: Nafn</strong> til að giska.</li>
            <li>• Skrifaðu <strong>vísbending</strong> einu sinni.</li>
            <li>• Markmið: leysa sem fyrst.</li>
          </ul>
        </aside>
      </div>
    {:else if round?.status === 'scheduled'}
      <h1 class="mt-8 text-4xl font-semibold leading-tight text-zinc-900 sm:text-5xl">Leikurinn opnar kl. 12:00</h1>
      <p class="mt-3 text-zinc-600">Bíddu aðeins — ný persóna kemur á hádegi.</p>
    {:else}
      <h1 class="mt-8 text-4xl font-semibold leading-tight text-zinc-900 sm:text-5xl">Leiknum er lokið í dag</h1>
      <p class="mt-3 text-zinc-600">Næsti leikur opnar á morgun.</p>
    {/if}
  </section>

  {#if revealPerson}
    <section class="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
      <h2 class="text-xl font-semibold">Maðurinn dagsins</h2>
      <p class="mt-2 text-lg font-medium">{revealPerson.displayName}</p>
      <p class="mt-1 text-zinc-700">{revealPerson.revealTextIs}</p>
      <img class="mt-4 max-h-80 rounded-xl object-cover" src={revealPerson.imageUrl} alt={revealPerson.displayName} />
    </section>
  {/if}

  <details class="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
    <summary class="cursor-pointer text-xl font-semibold">Leaderboard (dagurinn)</summary>
    {#if leaderboard.length === 0}
      <p class="mt-3 text-zinc-600">Enginn búinn að leysa ennþá.</p>
    {:else}
      <ul class="mt-3 space-y-2 text-sm">
        {#each leaderboard as row}
          <li class="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
            <span>#{row.rank}</span>
            <span>{row.questionsUsed} spurningar</span>
            <span>{msToText(row.timeFromStartMs)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </details>

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
</main>
