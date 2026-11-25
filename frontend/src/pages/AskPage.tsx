import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { askVault, isAbortError } from '../api/books';
import { BookCard } from '../components/BookCard';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Spinner } from '../components/Spinner';
import { describeAiError } from '../lib/errors';
import { EMPTY_FILTERS, filtersToParams } from '../lib/filters';
import { QUESTION_MAX_LENGTH, type AiSearchResult, type SearchPlan } from '../types';

const EXAMPLES = [
  'Unread fantasy with found family',
  'Sci-fi I rated five stars',
  'My favourite mysteries',
];

type AskState =
  | { status: 'idle' }
  | { status: 'asking'; question: string }
  | { status: 'done'; question: string; result: AiSearchResult }
  | { status: 'error'; question: string; error: unknown };

/** The plan as short chips: what the AI understood. */
function planChips(plan: SearchPlan): string[] {
  const chips: string[] = [];
  if (plan.genre) chips.push(plan.genre);
  if (plan.read_status) chips.push(plan.read_status === 'read' ? 'Read' : 'Unread');
  if (plan.min_rating !== null) chips.push(`${plan.min_rating}★ and up`);
  if (plan.trope) chips.push(`Trope: ${plan.trope}`);
  if (plan.text) chips.push(`“${plan.text}”`);
  return chips;
}

/** The same search as list filters, when it can be one (title/author text can't). */
function listLink(plan: SearchPlan): string | null {
  if (plan.text) return null;
  const params = filtersToParams({
    ...EMPTY_FILTERS,
    genre: plan.genre ?? '',
    read: plan.read_status ?? 'all',
    minRating: plan.min_rating,
    trope: plan.trope ?? '',
  });
  const query = params.toString();
  return query ? `/?${query}` : null;
}

/** Ask your vault in plain English; the AI service turns it into a search. */
export function AskPage() {
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<AskState>({ status: 'idle' });
  const inflight = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cancel a pending question when leaving the page.
  useEffect(() => () => inflight.current?.abort(), []);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) {
      setInputError('Type a question first.');
      inputRef.current?.focus();
      return;
    }
    setInputError(null);
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setState({ status: 'asking', question: trimmed });
    try {
      const result = await askVault(trimmed, controller.signal);
      setState({ status: 'done', question: trimmed, result });
    } catch (error) {
      if (isAbortError(error)) return;
      setState({ status: 'error', question: trimmed, error });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(text);
  }

  const asking = state.status === 'asking';

  return (
    <section aria-labelledby="ask-heading">
      <div className="page-head">
        <h1 id="ask-heading">Ask your vault</h1>
        <Link to="/" className="btn btn--ghost">
          Back to books
        </Link>
      </div>

      <form className="card ask-form" onSubmit={onSubmit} noValidate>
        <div className={inputError ? 'field field--invalid' : 'field'}>
          <label htmlFor="ask-q" className="label">
            Your question
          </label>
          <div className="ask-form__row">
            <input
              id="ask-q"
              ref={inputRef}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={QUESTION_MAX_LENGTH}
              placeholder="e.g. unread fantasy with found family"
              autoComplete="off"
              disabled={asking}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? 'ask-q-error ask-q-hint' : 'ask-q-hint'}
            />
            <button type="submit" className="btn btn--primary" disabled={asking}>
              {asking ? 'Asking…' : 'Ask'}
            </button>
          </div>
          {inputError && (
            <p id="ask-q-error" className="field-error">
              {inputError}
            </p>
          )}
          <p id="ask-q-hint" className="hint">
            Genre, read or unread, rating, a trope, an author or title. Only your own books are
            searched.
          </p>
        </div>
        <div className="ask-form__examples">
          <span className="muted small">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="btn btn--small btn--ghost"
              disabled={asking}
              onClick={() => {
                setText(example);
                void ask(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      {asking && <Spinner label="Asking the AI…" />}

      {state.status === 'error' && (
        <ErrorBanner
          error={state.error}
          describe={describeAiError}
          onRetry={() => void ask(state.question)}
        />
      )}

      {state.status === 'done' && <AskResult question={state.question} result={state.result} />}
    </section>
  );
}

function AskResult({ question, result }: { question: string; result: AiSearchResult }) {
  const { plan, books } = result;
  const chips = planChips(plan);
  const link = listLink(plan);
  return (
    <div className="ask-result" aria-labelledby="ask-result-heading">
      <div className="card ask-plan">
        <h2 id="ask-result-heading" className="card__title">
          “{question}”
        </h2>
        <p aria-live="polite">{plan.explanation}</p>
        {chips.length > 0 && (
          <ul className="chips chips--small" aria-label="Understood as">
            {chips.map((chip) => (
              <li key={chip} className="chip">
                {chip}
              </li>
            ))}
          </ul>
        )}
        {link && (
          <Link to={link} className="btn btn--link">
            Open these filters in your list
          </Link>
        )}
      </div>

      {books.length === 0 ? (
        <EmptyState title="No books match" icon="🔍">
          Nothing in your vault matches that. Try asking another way.
        </EmptyState>
      ) : (
        <>
          <p className="result-count muted">
            {books.length} {books.length === 1 ? 'book' : 'books'}
          </p>
          <ul className="book-grid" aria-label="Matching books">
            {books.map((book) => (
              <li key={book.id}>
                <BookCard book={book} fromSearch="" />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
