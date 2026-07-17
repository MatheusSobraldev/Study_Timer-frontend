"use client";

import type { CSSProperties } from "react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import "./page.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333/api";
const completionSoundPath = "/audio/completion.mp3";

type AuthMode = "login" | "register";
type TimerStatus = "idle" | "running" | "paused";

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface StudySession {
  id: string;
  userId: string;
  title: string;
  subject?: string;
  durationInMinutes: number;
  startedAt: string;
  finishedAt: string;
  notes?: string;
  createdAt: string;
}

interface SessionsResponse {
  sessions: StudySession[];
  summary: {
    totalSessions: number;
    totalMinutes: number;
  };
}

interface AuthResponse {
  user: User;
  token: string;
}

const tokenStorageKey = "timer-estudo-token";
const userStorageKey = "timer-estudo-user";

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours}h ${minutes.toString().padStart(2, "0")}min`;
}

function getTimerStatusLabel(status: TimerStatus) {
  const labels: Record<TimerStatus, string> = {
    idle: "Pronto",
    running: "Rodando",
    paused: "Pausado"
  };

  return labels[status];
}

function validateAuthForm(
  mode: AuthMode,
  values: { name: string; email: string; password: string }
) {
  const trimmedName = values.name.trim();
  const trimmedEmail = values.email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (mode === "register" && trimmedName.length < 3) {
    return "Informe um nome com pelo menos 3 caracteres.";
  }

  if (!trimmedEmail) {
    return "Informe seu e-mail.";
  }

  if (!emailRegex.test(trimmedEmail)) {
    return "Informe um e-mail válido.";
  }

  if (!values.password) {
    return "Informe sua senha.";
  }

  if (values.password.length < 6) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }

  if (/\s/.test(values.password)) {
    return "A senha nao pode ter espaços.";
  }

  return "";
}

async function requestApi<T>(
  path: string,
  options: RequestInit = {},
  token?: string
) {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique se o backend esta rodando e se a URL da API está correta."
    );
  }

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? "Não foi possível concluir a operação.");
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export default function Home() {
  const completionHandledRef = useRef(false);
  const completionAudioRef = useRef<HTMLAudioElement | null>(null);
  const pauseAlertTimeoutRef = useRef<number | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [summary, setSummary] = useState<SessionsResponse["summary"]>({
    totalSessions: 0,
    totalMinutes: 0
  });
  const [title, setTitle] = useState("Sessão de foco");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [timerStatus, setTimerStatus] = useState<TimerStatus>("idle");
  const [showPauseAlert, setShowPauseAlert] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const progress = useMemo(() => {
    const totalSeconds = timerMinutes * 60;

    if (totalSeconds <= 0) {
      return 0;
    }

    return Math.round(((totalSeconds - secondsLeft) / totalSeconds) * 100);
  }, [secondsLeft, timerMinutes]);

  async function loadSessions(currentToken: string) {
    const data = await requestApi<SessionsResponse>(
      "/study-sessions",
      {},
      currentToken
    );

    setSessions(data.sessions);
    setSummary(data.summary);
  }

  useEffect(() => {
    completionAudioRef.current = new Audio(completionSoundPath);
    completionAudioRef.current.preload = "auto";
    completionAudioRef.current.volume = 0.75;
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(tokenStorageKey);
    const storedUser = localStorage.getItem(userStorageKey);

    if (!storedToken || !storedUser) {
      return;
    }

    setToken(storedToken);
    setUser(JSON.parse(storedUser) as User);
    loadSessions(storedToken).catch(() => {
      localStorage.removeItem(tokenStorageKey);
      localStorage.removeItem(userStorageKey);
      setToken(null);
      setUser(null);
    });
  }, []);

  useEffect(() => {
    if (timerStatus !== "running") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);

          if (completionHandledRef.current) {
            return 0;
          }

          completionHandledRef.current = true;
          setTimerStatus("idle");
          void playCompletionSound();
          void saveSession(timerMinutes, startedAt ?? new Date());
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [startedAt, timerMinutes, timerStatus]);

  useEffect(() => {
    if (timerStatus === "idle") {
      setSecondsLeft(timerMinutes * 60);
    }
  }, [timerMinutes, timerStatus]);

  useEffect(() => {
    return () => clearPauseAlertTimeout();
  }, []);

  function clearPauseAlertTimeout() {
    if (pauseAlertTimeoutRef.current !== null) {
      window.clearTimeout(pauseAlertTimeoutRef.current);
      pauseAlertTimeoutRef.current = null;
    }
  }

  function schedulePauseAlert() {
    clearPauseAlertTimeout();
    pauseAlertTimeoutRef.current = window.setTimeout(() => {
      setShowPauseAlert(true);
      pauseAlertTimeoutRef.current = null;
    }, 5 * 60 * 1000);
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const validationError = validateAuthForm(authMode, {
      name,
      email,
      password
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);

    try {
      const payload =
        authMode === "register"
          ? { name: name.trim(), email: email.trim(), password }
          : { email: email.trim(), password };
      const data = await requestApi<AuthResponse>(
        authMode === "register" ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      localStorage.setItem(tokenStorageKey, data.token);
      localStorage.setItem(userStorageKey, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setPassword("");
      setMessage("Sessao iniciada com sucesso.");
      await loadSessions(data.token);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Erro ao autenticar usuario."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(userStorageKey);
    setToken(null);
    setUser(null);
    setSessions([]);
    setSummary({ totalSessions: 0, totalMinutes: 0 });
    setTimerStatus("idle");
    setStartedAt(null);
    completionHandledRef.current = false;
    clearPauseAlertTimeout();
    setShowPauseAlert(false);
    setMessage("");
    setError("");
  }

  function startTimer() {
    setError("");
    setMessage("");

    if (!title.trim()) {
      setError("Informe um título para iniciar o timer e conseguir salvar seu processo.");
      return;
    }

    completionHandledRef.current = false;
    clearPauseAlertTimeout();
    setShowPauseAlert(false);
    setStartedAt(new Date());
    setSecondsLeft(timerMinutes * 60);
    setTimerStatus("running");
  }

  function pauseTimer() {
    setTimerStatus("paused");
    setShowPauseAlert(false);
    schedulePauseAlert();
  }

  function resumeTimer() {
    clearPauseAlertTimeout();
    setShowPauseAlert(false);
    setTimerStatus("running");
  }

  function resetTimer() {
    setTimerStatus("idle");
    setStartedAt(null);
    setSecondsLeft(timerMinutes * 60);
    completionHandledRef.current = false;
    clearPauseAlertTimeout();
    setShowPauseAlert(false);
  }

  function keepPaused() {
    setShowPauseAlert(false);
    clearPauseAlertTimeout();
  }

  async function playCompletionSound() {
    const audio = completionAudioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = 0;

    try {
      await audio.play();
    } catch {
      setMessage("Tempo concluído. O navegador bloqueou o som automaticamente.");
    }
  }

  async function saveSession(duration: number, sessionStartedAt?: Date) {
    if (!token) {
      setError("Faça login para salvar seu estudo.");
      return;
    }

    if (!title.trim()) {
      setError("Informe um título para o estudo.");
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      const start = sessionStartedAt ?? new Date();
      const finished = new Date(start.getTime() + duration * 60 * 1000);

      await requestApi<StudySession>(
        "/study-sessions",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            subject,
            durationInMinutes: duration,
            startedAt: start.toISOString(),
            finishedAt: finished.toISOString(),
            notes
          })
        },
        token
      );

      await loadSessions(token);
      setNotes("");
      setMessage("Estudo registrado no histórico.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Erro ao salvar registro."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteSession(id: string) {
    if (!token) {
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      await requestApi<null>(
        `/study-sessions/${id}`,
        {
          method: "DELETE"
        },
        token
      );
      await loadSessions(token);
      setMessage("Registro removido.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Erro ao remover registro."
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (!user || !token) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <div className="brand-block">
            <span className="brand-mark">TE</span>
            <div>
              <h1>Timer Estudo</h1>
              <p>Site para ajudar a registrar as horas do seu foco de estudos diários. Aproveite, meu amor!!</p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleAuth}>
            <div className="mode-tabs" aria-label="Modo de acesso">
              <button
                className={authMode === "login" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("login")}
              >
                Login
              </button>
              <button
                className={authMode === "register" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("register")}
              >
                Cadastro
              </button>
            </div>

            {authMode === "register" && (
              <label>
                Nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Seu nome"
                  required
                />
              </label>
            )}

            <label>
              E-mail
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Seuemail@email.com"
                required
                type="email"
              />
            </label>

            <label>
              Senha
              <input
                value={password}
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                type="password"
              />
            </label>

            {error && <p className="feedback error">{error}</p>}
            {message && <p className="feedback success">{message}</p>}

            <button className="primary-button" disabled={isLoading} type="submit">
              {isLoading
                ? "Aguarde..."
                : authMode === "register"
                  ? "Criar conta"
                  : "Entrar"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      {showPauseAlert && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="pause-modal">
            <div className="alert-icon" aria-hidden="true">
              !
            </div>
            <div>
              <span className="eyebrow">Pausa longa</span>
              <h2>Hora de voltar aos estudos</h2>
              <p>
                Voce esta com o timer pausado ha mais de 5 minutos. Retome a
                sessao para nao perder o ritmo.
              </p>
            </div>
            <div className="modal-actions">
              <button className="primary-button" onClick={resumeTimer} type="button">
                Retomar
              </button>
              <button className="ghost-button" onClick={keepPaused} type="button">
                Continuar pausado
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="topbar">
        <div>
          <span className="eyebrow">Timer Estudo</span>
          <h1>Boa sessão, {user.name}!</h1>
        </div>
        <button className="ghost-button" onClick={logout} type="button">
          Sair
        </button>
      </header>

      <section className="summary-grid">
        <article>
          <span>Sessões</span>
          <strong>{summary.totalSessions}</strong>
        </article>
        <article>
          <span>Tempo total</span>
          <strong>{formatMinutes(summary.totalMinutes)}</strong>
        </article>
        <article>
          <span>Progresso atual</span>
          <strong>{progress}%</strong>
        </article>
      </section>

      <section className="work-area">
        <div className="timer-panel">
          <div className="timer-header">
            <div>
              <span className="eyebrow">Foco ativo</span>
              <h2>Sessão principal</h2>
            </div>
            <div className={`status-pill ${timerStatus}`}>
              {getTimerStatusLabel(timerStatus)}
            </div>
          </div>

          <div
            className={`timer-orbit ${timerStatus}`}
            style={{ "--progress": `${progress}%` } as CSSProperties}
          >
            <div className="timer-core">
              <span>{timerMinutes} min</span>
              <strong>{formatClock(secondsLeft)}</strong>
              <small>{progress}% completo</small>
            </div>
          </div>

          <div className="progress-track" aria-label="Progresso do timer">
            <div style={{ width: `${progress}%` }} />
          </div>

          <div className="timer-controls">
            <label>
              Minutos
              <input
                disabled={timerStatus !== "idle"}
                min={1}
                onChange={(event) => setTimerMinutes(Number(event.target.value))}
                type="number"
                value={timerMinutes}
              />
            </label>
            <label>
              Título
              <input
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label>
              Matéria
              <input
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Opcional"
                value={subject}
              />
            </label>
            <label className="wide-field">
              Observações
              <textarea
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Opcional"
                rows={3}
                value={notes}
              />
            </label>
          </div>

          <div className="action-row">
            {timerStatus === "idle" && (
              <button className="primary-button" onClick={startTimer} type="button">
                Iniciar timer
              </button>
            )}
            {timerStatus === "running" && (
              <button className="secondary-button" onClick={pauseTimer} type="button">
                Pausar
              </button>
            )}
            {timerStatus === "paused" && (
              <button className="primary-button" onClick={resumeTimer} type="button">
                Continuar
              </button>
            )}
            <button className="ghost-button" onClick={resetTimer} type="button">
              Reiniciar
            </button>
            <button
              className="secondary-button"
              disabled={isLoading}
              onClick={() => saveSession(timerMinutes)}
              type="button"
            >
              Salvar manual
            </button>
          </div>

          {error && <p className="feedback error">{error}</p>}
          {message && <p className="feedback success">{message}</p>}
        </div>

        <aside className="history-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Histórico</span>
              <h2>Registros de estudo</h2>
            </div>
          </div>

          <div className="session-list">
            {sessions.length === 0 ? (
              <p className="empty-state">Nenhum estudo registrado ainda.</p>
            ) : (
              sessions.map((session) => (
                <article className="session-card" key={session.id}>
                  <div>
                    <h3>{session.title}</h3>
                    <p>
                      {session.subject || "Sem matéria"} -{" "}
                      {formatMinutes(session.durationInMinutes)}
                    </p>
                    {session.notes && (
                      <p className="session-notes">
                        <strong>Observação:</strong> {session.notes}
                      </p>
                    )}
                    <span>{formatDateTime(session.startedAt)}</span>
                  </div>
                  <button
                    aria-label={`Remover ${session.title}`}
                    className="delete-button"
                    onClick={() => deleteSession(session.id)}
                    type="button"
                  >
                    X
                  </button>
                </article>
              ))
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
